import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CfnTemplate } from '../../scripts/lib/dynamodb-gsi-waves';
import { runGsiWaves } from '../../scripts/lib/gsi-wave-orchestrator';

function gsi(name: string, key = name.replace(/_Index$/, '')) {
  return { IndexName: name, KeySchema: [{ AttributeName: key, KeyType: 'HASH' }] };
}

const ORIGINAL = [gsi('RunId_Index'), gsi('UserId_Index'), gsi('OrganizationId_Index')];
const DESIRED = [...ORIGINAL, gsi('PollStatus_Index'), gsi('WorkflowExternalId_Index')];

function writeDesiredCdkOut(): string {
  const cdkOut = mkdtempSync(join(tmpdir(), 'cdk-out-'));
  writeFileSync(
    join(cdkOut, 'manifest.json'),
    JSON.stringify({
      artifacts: {
        api: {
          type: 'aws:cloudformation:stack',
          properties: { templateFile: 'api.template.json' },
        },
      },
    }),
  );
  writeFileSync(
    join(cdkOut, 'api.template.json'),
    JSON.stringify({
      Resources: {
        Run: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            TableName: 'lab-run-table',
            AttributeDefinitions: [
              { AttributeName: 'RunId', AttributeType: 'S' },
              { AttributeName: 'UserId', AttributeType: 'S' },
              { AttributeName: 'OrganizationId', AttributeType: 'S' },
              { AttributeName: 'PollStatus', AttributeType: 'S' },
              { AttributeName: 'WorkflowExternalId', AttributeType: 'S' },
              { AttributeName: 'TerminalAt', AttributeType: 'S' },
            ],
            GlobalSecondaryIndexes: DESIRED,
          },
        },
      },
    }),
  );
  return cdkOut;
}

function liveStack(gsis = ORIGINAL): Map<string, CfnTemplate> {
  return new Map([
    [
      'api-stack',
      {
        Resources: {
          Run: {
            Type: 'AWS::DynamoDB::Table',
            Properties: { TableName: 'lab-run-table', GlobalSecondaryIndexes: gsis },
          },
          AppLambda: { Type: 'AWS::Lambda::Function', Properties: { Code: 'old' } },
        },
      },
    ],
  ]);
}

describe('runGsiWaves', () => {
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
  });

  it('is a no-op when at most one GSI mutation remains', async () => {
    const updateStack = jest.fn();
    const result = await runGsiWaves({
      cdkOut: writeDesiredCdkOut(),
      dryRun: false,
      deps: {
        loadCurrentStacks: async () => liveStack([...ORIGINAL, gsi('PollStatus_Index')]),
        updateStack,
        log: (m) => logs.push(m),
      },
    });
    expect(result.skippedReason).toBe('single-mutation');
    expect(updateStack).not.toHaveBeenCalled();
  });

  it('runs one infra-only update then leaves a single GSI for the final cdk deploy', async () => {
    const updateStack = jest.fn().mockResolvedValue(undefined);
    const stacks = liveStack();
    const result = await runGsiWaves({
      cdkOut: writeDesiredCdkOut(),
      dryRun: false,
      deps: {
        loadCurrentStacks: async () => stacks,
        updateStack,
        log: (m) => logs.push(m),
      },
    });

    expect(result.wavesRun).toBe(1);
    expect(result.remaining).toBe(1);
    expect(updateStack).toHaveBeenCalledTimes(1);
    const updated = updateStack.mock.calls[0][1] as CfnTemplate;
    expect(updated.Resources?.AppLambda?.Properties).toEqual({ Code: 'old' });
    expect(
      (updated.Resources?.Run.Properties?.GlobalSecondaryIndexes ?? []).map((g: { IndexName: string }) => g.IndexName),
    ).toEqual(['RunId_Index', 'UserId_Index', 'OrganizationId_Index', 'PollStatus_Index']);
  });

  it('does not advance when updateStack throws', async () => {
    const updateStack = jest.fn().mockRejectedValue(new Error('boom'));
    const stacks = liveStack();
    await expect(
      runGsiWaves({
        cdkOut: writeDesiredCdkOut(),
        dryRun: false,
        deps: {
          loadCurrentStacks: async () => stacks,
          updateStack,
          log: (m) => logs.push(m),
        },
      }),
    ).rejects.toThrow('boom');

    expect(updateStack).toHaveBeenCalledTimes(1);
    expect(
      (stacks.get('api-stack')!.Resources!.Run.Properties!.GlobalSecondaryIndexes ?? []).map(
        (g: { IndexName: string }) => g.IndexName,
      ),
    ).toEqual(ORIGINAL.map((g) => g.IndexName));
  });

  it('honours the MAX_WAVES guard', async () => {
    await expect(
      runGsiWaves({
        cdkOut: writeDesiredCdkOut(),
        dryRun: false,
        maxWaves: 0,
        deps: {
          loadCurrentStacks: async () => liveStack(),
          updateStack: async () => undefined,
          log: (m) => logs.push(m),
        },
      }),
    ).rejects.toThrow(/exceeded 0 intermediate updates/);
  });

  it('does not call updateStack during dry-run', async () => {
    const updateStack = jest.fn();
    const result = await runGsiWaves({
      cdkOut: writeDesiredCdkOut(),
      dryRun: true,
      deps: {
        loadCurrentStacks: async () => liveStack(),
        updateStack,
        log: (m) => logs.push(m),
      },
    });
    expect(result.wavesRun).toBe(1);
    expect(updateStack).not.toHaveBeenCalled();
  });
});
