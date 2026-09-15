import { applyToLedger, loadLedger } from './deploy-migrations/ledger';
import { DEPLOY_MIGRATIONS, DeployMigration, DeployMigrationPhase } from './deploy-migrations/registry';
import { loadDotEnvAndReconcileRegion } from './lib/load-env';
import { resolveNamePrefix } from './lib/resolve-name-prefix';
import { SsmService } from '../src/app/services/ssm-service';

export interface RunDeployMigrationsOptions {
  phase: DeployMigrationPhase;
  dryRun: boolean;
  forceId?: string;
  registry: DeployMigration[];
  ssmService: SsmService;
  namePrefix: string;
}

export async function runDeployMigrations(opts: RunDeployMigrationsOptions): Promise<void> {
  const { phase, dryRun, forceId, registry, ssmService, namePrefix } = opts;
  const phaseEntries = registry.filter((m) => m.phase === phase);

  if (forceId && !phaseEntries.some((m) => m.id === forceId)) {
    throw new Error(`--force id '${forceId}' is not registered for phase '${phase}'.`);
  }

  const ledger = await loadLedger(ssmService, namePrefix);
  const pending = forceId ? phaseEntries.filter((m) => m.id === forceId) : phaseEntries.filter((m) => !ledger[m.id]);

  if (!forceId) {
    const skipped = phaseEntries.filter((m) => !pending.includes(m));
    for (const entry of skipped) {
      console.log(`[run-deploy-migrations] skip (already applied): ${entry.id}`);
    }
  }

  if (dryRun) {
    for (const entry of pending) {
      console.log(`[run-deploy-migrations] [dry-run] would run: ${entry.id}`);
    }
    return;
  }

  for (const entry of pending) {
    console.log(`[run-deploy-migrations] running: ${entry.id}`);
    await entry.main();
    await applyToLedger(ssmService, namePrefix, entry.id);
    console.log(`[run-deploy-migrations] applied: ${entry.id}`);
  }
}

export function parseArgs(argv: string[]): { phase: DeployMigrationPhase; dryRun: boolean; forceId?: string } {
  const phaseArg = argv.find((a) => a.startsWith('--phase='))?.split('=')[1];
  if (phaseArg !== 'pre' && phaseArg !== 'post') {
    throw new Error('Missing or invalid --phase=pre|post');
  }
  const dryRun = argv.includes('--dry-run');
  const forceIndex = argv.indexOf('--force');
  let forceId: string | undefined;
  if (forceIndex >= 0) {
    const next = argv[forceIndex + 1];
    if (!next || next.startsWith('--')) {
      throw new Error('--force requires an id argument');
    }
    forceId = next;
  }
  return { phase: phaseArg, dryRun, forceId };
}

if (require.main === module) {
  // Must run before resolveNamePrefix()/SsmService: both the AWS SDK (AWS_REGION) and the
  // NAME_PREFIX fallback chain can depend on values that only .env.local provides locally.
  loadDotEnvAndReconcileRegion();
  const { phase, dryRun, forceId } = parseArgs(process.argv.slice(2));
  const namePrefix = resolveNamePrefix();
  process.env.NAME_PREFIX = namePrefix;

  runDeployMigrations({
    phase,
    dryRun,
    forceId,
    registry: DEPLOY_MIGRATIONS,
    ssmService: new SsmService(),
    namePrefix,
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
