// The real registry statically imports the actual migration scripts, which resolve
// NAME_PREFIX at module load time and crash outside a fully configured environment.
// Tests here always inject a fake registry, so stub it out to avoid that import chain.
jest.mock('../../../scripts/deploy-migrations/registry', () => ({ DEPLOY_MIGRATIONS: [] }));

import { ledgerParamName } from '../../../scripts/deploy-migrations/ledger';
import type { DeployMigration } from '../../../scripts/deploy-migrations/registry';
import { parseArgs, runDeployMigrations } from '../../../scripts/run-deploy-migrations';
import { SsmService } from '../../../src/app/services/ssm-service';

function buildSsmService(initialLedger: Record<string, { appliedAt: string }> = {}): jest.Mocked<SsmService> {
  let stored = JSON.stringify(initialLedger);
  return {
    getParameter: jest.fn().mockImplementation(async () => ({ Parameter: { Value: stored } })),
    putParameter: jest.fn().mockImplementation(async (input: any) => {
      stored = input.Value;
      return {};
    }),
    deleteParameter: jest.fn(),
  } as unknown as jest.Mocked<SsmService>;
}

function buildMigration(overrides: Partial<DeployMigration> & Pick<DeployMigration, 'id' | 'phase'>): DeployMigration {
  return { main: jest.fn().mockResolvedValue(undefined), ...overrides };
}

describe('runDeployMigrations', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs only entries matching the given phase, in registry order', async () => {
    const calls: string[] = [];
    const registry: DeployMigration[] = [
      buildMigration({
        id: 'pre-a',
        phase: 'pre',
        main: jest.fn().mockImplementation(async () => {
          calls.push('pre-a');
        }),
      }),
      buildMigration({
        id: 'post-a',
        phase: 'post',
        main: jest.fn().mockImplementation(async () => {
          calls.push('post-a');
        }),
      }),
      buildMigration({
        id: 'pre-b',
        phase: 'pre',
        main: jest.fn().mockImplementation(async () => {
          calls.push('pre-b');
        }),
      }),
    ];
    const ssmService = buildSsmService();

    await runDeployMigrations({ phase: 'pre', dryRun: false, registry, ssmService, namePrefix: 'dev-mylab' });

    expect(calls).toEqual(['pre-a', 'pre-b']);
    expect(registry.find((m) => m.id === 'post-a')!.main).not.toHaveBeenCalled();
  });

  it('skips ids already present in the ledger', async () => {
    const registry: DeployMigration[] = [buildMigration({ id: 'pre-a', phase: 'pre' })];
    const ssmService = buildSsmService({ 'pre-a': { appliedAt: '2026-01-01T00:00:00.000Z' } });

    await runDeployMigrations({ phase: 'pre', dryRun: false, registry, ssmService, namePrefix: 'dev-mylab' });

    expect(registry[0].main).not.toHaveBeenCalled();
  });

  it('writes the ledger only after a successful run', async () => {
    const registry: DeployMigration[] = [buildMigration({ id: 'pre-a', phase: 'pre' })];
    const ssmService = buildSsmService();

    await runDeployMigrations({ phase: 'pre', dryRun: false, registry, ssmService, namePrefix: 'dev-mylab' });

    const written = ssmService.putParameter.mock.calls[0][0];
    expect(written.Name).toBe(ledgerParamName('dev-mylab'));
    expect(JSON.parse(written.Value!)).toHaveProperty('pre-a.appliedAt');
  });

  it('does not mark an id applied and rethrows when its main() fails', async () => {
    const registry: DeployMigration[] = [
      buildMigration({ id: 'pre-a', phase: 'pre', main: jest.fn().mockRejectedValue(new Error('boom')) }),
      buildMigration({ id: 'pre-b', phase: 'pre' }),
    ];
    const ssmService = buildSsmService();

    await expect(
      runDeployMigrations({ phase: 'pre', dryRun: false, registry, ssmService, namePrefix: 'dev-mylab' }),
    ).rejects.toThrow('boom');

    expect(registry[1].main).not.toHaveBeenCalled(); // fail-fast: pre-b never attempted
    expect(ssmService.putParameter).not.toHaveBeenCalled();
  });

  it('--dry-run calls no main() and writes nothing', async () => {
    const registry: DeployMigration[] = [buildMigration({ id: 'pre-a', phase: 'pre' })];
    const ssmService = buildSsmService();

    await runDeployMigrations({ phase: 'pre', dryRun: true, registry, ssmService, namePrefix: 'dev-mylab' });

    expect(registry[0].main).not.toHaveBeenCalled();
    expect(ssmService.putParameter).not.toHaveBeenCalled();
  });

  it('--force re-runs an already-applied id and updates the ledger', async () => {
    const registry: DeployMigration[] = [buildMigration({ id: 'pre-a', phase: 'pre' })];
    const ssmService = buildSsmService({ 'pre-a': { appliedAt: '2020-01-01T00:00:00.000Z' } });

    await runDeployMigrations({
      phase: 'pre',
      dryRun: false,
      forceId: 'pre-a',
      registry,
      ssmService,
      namePrefix: 'dev-mylab',
    });

    expect(registry[0].main).toHaveBeenCalledTimes(1);
    const written = JSON.parse(ssmService.putParameter.mock.calls[0][0].Value!);
    expect(written['pre-a'].appliedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('--force with an id not in the given phase throws before running anything', async () => {
    const registry: DeployMigration[] = [buildMigration({ id: 'post-a', phase: 'post' })];
    const ssmService = buildSsmService();

    await expect(
      runDeployMigrations({
        phase: 'pre',
        dryRun: false,
        forceId: 'post-a',
        registry,
        ssmService,
        namePrefix: 'dev-mylab',
      }),
    ).rejects.toThrow("'post-a' is not registered for phase 'pre'");

    expect(registry[0].main).not.toHaveBeenCalled();
  });

  it('--force skip-logging: only logs "already applied" for entries that were never selected as forced/pending, and never for the forced run itself', async () => {
    const registry: DeployMigration[] = [
      buildMigration({ id: 'pre-a', phase: 'pre' }),
      buildMigration({ id: 'pre-b', phase: 'pre' }),
    ];
    const ssmService = buildSsmService({ 'pre-a': { appliedAt: '2020-01-01T00:00:00.000Z' } });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await runDeployMigrations({
      phase: 'pre',
      dryRun: false,
      forceId: 'pre-a',
      registry,
      ssmService,
      namePrefix: 'dev-mylab',
    });

    const alreadyAppliedLogs = logSpy.mock.calls.filter((call) => String(call[0]).includes('already applied'));
    expect(alreadyAppliedLogs).toHaveLength(0);
  });
});

describe('parseArgs', () => {
  it('parses a valid --phase=pre', () => {
    expect(parseArgs(['--phase=pre'])).toEqual({ phase: 'pre', dryRun: false, forceId: undefined });
  });

  it('parses a valid --phase=post', () => {
    expect(parseArgs(['--phase=post'])).toEqual({ phase: 'post', dryRun: false, forceId: undefined });
  });

  it('throws when --phase is missing', () => {
    expect(() => parseArgs([])).toThrow('Missing or invalid --phase=pre|post');
  });

  it('throws when --phase is invalid', () => {
    expect(() => parseArgs(['--phase=bogus'])).toThrow('Missing or invalid --phase=pre|post');
  });

  it('detects --dry-run', () => {
    expect(parseArgs(['--phase=pre', '--dry-run']).dryRun).toBe(true);
  });

  it('extracts the id following --force', () => {
    expect(parseArgs(['--phase=pre', '--force', 'my-migration-id']).forceId).toBe('my-migration-id');
  });

  it('throws when --force is the last argument', () => {
    expect(() => parseArgs(['--phase=pre', '--force'])).toThrow('--force requires an id argument');
  });

  it('throws when --force is immediately followed by another flag', () => {
    expect(() => parseArgs(['--phase=pre', '--force', '--dry-run'])).toThrow('--force requires an id argument');
  });
});
