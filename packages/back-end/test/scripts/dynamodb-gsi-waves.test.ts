import {
  applyWaveToCurrentTemplates,
  applyWaveToTemplates,
  advanceCurrentNames,
  collectKeyAttributeNames,
  formatWaveChange,
  gsiDiff,
  gsiMutationCount,
  listTableSnapshots,
  maxRemainingMutations,
  nextWaveIndexNames,
  planTableWave,
  pruneAttributeDefinitions,
  selectGsisByName,
  syncCurrentGsisFromTemplates,
  CfnGlobalSecondaryIndex,
  CfnTableProperties,
  CfnTemplate,
} from '../../scripts/lib/dynamodb-gsi-waves';

function gsi(name: string, key = name.replace(/_Index$/, '')): CfnGlobalSecondaryIndex {
  return {
    IndexName: name,
    KeySchema: [{ AttributeName: key, KeyType: 'HASH' }],
    Projection: { ProjectionType: 'ALL' },
  };
}

const ORIGINAL_GSIS = [
  gsi('RunId_Index', 'RunId'),
  gsi('UserId_Index', 'UserId'),
  gsi('OrganizationId_Index', 'OrganizationId'),
];
const POLL_GSI = gsi('PollStatus_Index', 'PollStatus');
const COST_GSI: CfnGlobalSecondaryIndex = {
  IndexName: 'WorkflowExternalId_Index',
  KeySchema: [
    { AttributeName: 'WorkflowExternalId', KeyType: 'HASH' },
    { AttributeName: 'TerminalAt', KeyType: 'RANGE' },
  ],
  Projection: { ProjectionType: 'ALL' },
};
const DESIRED_GSIS = [...ORIGINAL_GSIS, POLL_GSI, COST_GSI];

function laboratoryRunTableProps(gsis: CfnGlobalSecondaryIndex[]): CfnTableProperties {
  return {
    TableName: 'pre-prod-quality-laboratory-run-table',
    AttributeDefinitions: [
      { AttributeName: 'LaboratoryId', AttributeType: 'S' },
      { AttributeName: 'RunId', AttributeType: 'S' },
      { AttributeName: 'UserId', AttributeType: 'S' },
      { AttributeName: 'OrganizationId', AttributeType: 'S' },
      { AttributeName: 'CreatedAt', AttributeType: 'S' },
      { AttributeName: 'PollStatus', AttributeType: 'S' },
      { AttributeName: 'WorkflowExternalId', AttributeType: 'S' },
      { AttributeName: 'TerminalAt', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'LaboratoryId', KeyType: 'HASH' },
      { AttributeName: 'RunId', KeyType: 'RANGE' },
    ],
    LocalSecondaryIndexes: [
      { IndexName: 'CreatedAt_Index', KeySchema: [{ AttributeName: 'CreatedAt', KeyType: 'RANGE' }] },
    ],
    GlobalSecondaryIndexes: gsis,
  };
}

describe('gsiDiff / gsiMutationCount', () => {
  it('counts two new GSIs as two mutations (the UAT failure mode)', () => {
    const current = ORIGINAL_GSIS.map((g) => g.IndexName);
    const desired = DESIRED_GSIS.map((g) => g.IndexName);
    expect(gsiDiff(current, desired)).toEqual({
      toAdd: ['PollStatus_Index', 'WorkflowExternalId_Index'],
      toRemove: [],
    });
    expect(gsiMutationCount(current, desired)).toBe(2);
  });

  it('counts mixed add+delete as two mutations (also illegal in one UpdateTable)', () => {
    expect(gsiMutationCount(['A', 'B'], ['B', 'C'])).toBe(2);
  });

  it('returns zero when the index set is unchanged even if order differs', () => {
    expect(gsiMutationCount(['A', 'B'], ['B', 'A'])).toBe(0);
  });
});

describe('nextWaveIndexNames', () => {
  it('appends the first missing desired GSI and preserves current order', () => {
    expect(
      nextWaveIndexNames(
        ['RunId_Index', 'UserId_Index', 'OrganizationId_Index'],
        ['RunId_Index', 'UserId_Index', 'OrganizationId_Index', 'PollStatus_Index', 'WorkflowExternalId_Index'],
      ),
    ).toEqual(['RunId_Index', 'UserId_Index', 'OrganizationId_Index', 'PollStatus_Index']);
  });

  it('removes one extra GSI per wave, keeping current order of the rest', () => {
    expect(nextWaveIndexNames(['A', 'B', 'C'], ['A'])).toEqual(['A', 'C']);
  });

  it('prefers add over remove when both are pending', () => {
    expect(nextWaveIndexNames(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when current already matches desired', () => {
    expect(nextWaveIndexNames(['A', 'B'], ['A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('selectGsisByName', () => {
  it('uses the desired definition for newly added indexes', () => {
    const selected = selectGsisByName(ORIGINAL_GSIS, DESIRED_GSIS, [
      'RunId_Index',
      'UserId_Index',
      'OrganizationId_Index',
      'PollStatus_Index',
    ]);
    expect(selected.map((g) => g.IndexName)).toEqual([
      'RunId_Index',
      'UserId_Index',
      'OrganizationId_Index',
      'PollStatus_Index',
    ]);
    expect(selected[3].KeySchema).toEqual(POLL_GSI.KeySchema);
  });

  it('throws when an index has no definition on either side', () => {
    expect(() => selectGsisByName([], [], ['Missing_Index'])).toThrow('Missing_Index');
  });
});

describe('pruneAttributeDefinitions', () => {
  it('drops attributes that only exist for GSIs not in this wave', () => {
    const props = laboratoryRunTableProps([...ORIGINAL_GSIS, POLL_GSI]);
    pruneAttributeDefinitions(props);
    const names = (props.AttributeDefinitions ?? []).map((d) => d.AttributeName).sort();
    expect(names).toEqual(['CreatedAt', 'LaboratoryId', 'OrganizationId', 'PollStatus', 'RunId', 'UserId']);
  });

  it('keeps TerminalAt when the cost GSI is present', () => {
    const props = laboratoryRunTableProps(DESIRED_GSIS);
    pruneAttributeDefinitions(props);
    expect(collectKeyAttributeNames(props).has('TerminalAt')).toBe(true);
    expect(collectKeyAttributeNames(props).has('WorkflowExternalId')).toBe(true);
  });
});

describe('planTableWave', () => {
  it('leaves CREATE tables (no current snapshot) on the full desired GSI set', () => {
    const plan = planTableWave(undefined, DESIRED_GSIS);
    expect(plan.skip).toBe(true);
    expect(plan.gsis).toBe(DESIRED_GSIS);
  });

  it('leaves a single remaining mutation for the final unpatched deploy', () => {
    const plan = planTableWave([...ORIGINAL_GSIS, POLL_GSI], DESIRED_GSIS);
    expect(plan.skip).toBe(true);
  });

  it('plans a one-GSI step when two indexes are missing', () => {
    const plan = planTableWave(ORIGINAL_GSIS, DESIRED_GSIS);
    expect(plan.skip).toBe(false);
    expect(plan.gsis.map((g) => g.IndexName)).toEqual([
      'RunId_Index',
      'UserId_Index',
      'OrganizationId_Index',
      'PollStatus_Index',
    ]);
    expect(plan.change?.add).toBe('PollStatus_Index');
  });
});

describe('applyWaveToTemplates', () => {
  function desiredAssembly(): Map<string, CfnTemplate> {
    return new Map([
      [
        'api',
        {
          Resources: {
            LaboratoryRunTable: {
              Type: 'AWS::DynamoDB::Table',
              Properties: laboratoryRunTableProps(DESIRED_GSIS),
            },
            NewTaggingTable: {
              Type: 'AWS::DynamoDB::Table',
              Properties: {
                TableName: 'pre-prod-quality-laboratory-data-tagging-table',
                AttributeDefinitions: [
                  { AttributeName: 'LaboratoryId', AttributeType: 'S' },
                  { AttributeName: 'Sk', AttributeType: 'S' },
                  { AttributeName: 'Gsi1Pk', AttributeType: 'S' },
                ],
                KeySchema: [{ AttributeName: 'LaboratoryId', KeyType: 'HASH' }],
                GlobalSecondaryIndexes: [gsi('Gsi1Pk_Index', 'Gsi1Pk')],
              },
            },
          },
        },
      ],
    ]);
  }

  it('patches only the existing table that would otherwise add two GSIs', () => {
    const templates = desiredAssembly();
    const current = new Map<string, CfnGlobalSecondaryIndex[]>([
      ['pre-prod-quality-laboratory-run-table', ORIGINAL_GSIS],
    ]);

    const changes = applyWaveToTemplates(templates, current);

    expect(changes).toHaveLength(1);
    expect(formatWaveChange(changes[0])).toContain('add PollStatus_Index');

    const runTable = templates.get('api')!.Resources!.LaboratoryRunTable.Properties!;
    expect(
      gsiDiff(
        ORIGINAL_GSIS.map((g) => g.IndexName),
        (runTable.GlobalSecondaryIndexes ?? []).map((g) => g.IndexName),
      ),
    ).toEqual({ toAdd: ['PollStatus_Index'], toRemove: [] });
    expect((runTable.AttributeDefinitions ?? []).map((d) => d.AttributeName)).not.toContain('WorkflowExternalId');
    expect((runTable.AttributeDefinitions ?? []).map((d) => d.AttributeName)).not.toContain('TerminalAt');

    // Brand-new tables keep every GSI — CreateTable allows multiple indexes.
    const tagging = templates.get('api')!.Resources!.NewTaggingTable.Properties!;
    expect((tagging.GlobalSecondaryIndexes ?? []).map((g) => g.IndexName)).toEqual(['Gsi1Pk_Index']);
  });

  it('returns no changes when every existing table is already within one mutation', () => {
    const templates = desiredAssembly();
    const current = new Map<string, CfnGlobalSecondaryIndex[]>([
      ['pre-prod-quality-laboratory-run-table', [...ORIGINAL_GSIS, POLL_GSI]],
    ]);
    expect(applyWaveToTemplates(templates, current)).toEqual([]);
  });

  it('returns no changes when the live stack already has the desired GSIs (quality env)', () => {
    const templates = desiredAssembly();
    const current = new Map<string, CfnGlobalSecondaryIndex[]>([
      ['pre-prod-quality-laboratory-run-table', DESIRED_GSIS],
    ]);
    expect(applyWaveToTemplates(templates, current)).toEqual([]);
  });
});

describe('maxRemainingMutations / advanceCurrentNames', () => {
  it('drives two missing GSIs to a single remaining mutation after one wave', () => {
    const desired = new Map([['run', DESIRED_GSIS.map((g) => g.IndexName)]]);
    let current = new Map([['run', ORIGINAL_GSIS.map((g) => g.IndexName)]]);
    expect(maxRemainingMutations(desired, current)).toBe(2);

    const templates = new Map<string, CfnTemplate>([
      [
        'api',
        {
          Resources: {
            Run: {
              Type: 'AWS::DynamoDB::Table',
              Properties: { TableName: 'run', GlobalSecondaryIndexes: DESIRED_GSIS },
            },
          },
        },
      ],
    ]);
    const currentGsis = new Map<string, CfnGlobalSecondaryIndex[]>([['run', ORIGINAL_GSIS]]);
    const changes = applyWaveToTemplates(templates, currentGsis);
    current = advanceCurrentNames(current, changes);

    expect(maxRemainingMutations(desired, current)).toBe(1);
    expect(current.get('run')).toEqual(['RunId_Index', 'UserId_Index', 'OrganizationId_Index', 'PollStatus_Index']);
  });

  it('syncCurrentGsisFromTemplates feeds the next wave the indexes just planned', () => {
    const currentGsis = new Map<string, CfnGlobalSecondaryIndex[]>([['run', ORIGINAL_GSIS]]);
    const templates = new Map<string, CfnTemplate>([
      [
        'api',
        {
          Resources: {
            Run: {
              Type: 'AWS::DynamoDB::Table',
              Properties: { TableName: 'run', GlobalSecondaryIndexes: DESIRED_GSIS },
            },
          },
        },
      ],
    ]);
    const changes = applyWaveToTemplates(templates, currentGsis);
    syncCurrentGsisFromTemplates(currentGsis, templates, changes);
    expect(currentGsis.get('run')?.map((g) => g.IndexName)).toEqual([
      'RunId_Index',
      'UserId_Index',
      'OrganizationId_Index',
      'PollStatus_Index',
    ]);

    const second = new Map<string, CfnTemplate>([
      [
        'api',
        {
          Resources: {
            Run: {
              Type: 'AWS::DynamoDB::Table',
              Properties: { TableName: 'run', GlobalSecondaryIndexes: DESIRED_GSIS },
            },
          },
        },
      ],
    ]);
    expect(applyWaveToTemplates(second, currentGsis)).toEqual([]);
  });
});

describe('applyWaveToCurrentTemplates', () => {
  it('adds one GSI and its attributes on the live template without touching other resources', () => {
    const current = new Map<string, CfnTemplate>([
      [
        'api-stack',
        {
          Resources: {
            Run: {
              Type: 'AWS::DynamoDB::Table',
              Properties: {
                TableName: 'pre-prod-quality-laboratory-run-table',
                AttributeDefinitions: [
                  { AttributeName: 'LaboratoryId', AttributeType: 'S' },
                  { AttributeName: 'RunId', AttributeType: 'S' },
                  { AttributeName: 'UserId', AttributeType: 'S' },
                  { AttributeName: 'OrganizationId', AttributeType: 'S' },
                  { AttributeName: 'CreatedAt', AttributeType: 'S' },
                ],
                KeySchema: [
                  { AttributeName: 'LaboratoryId', KeyType: 'HASH' },
                  { AttributeName: 'RunId', KeyType: 'RANGE' },
                ],
                LocalSecondaryIndexes: [
                  { IndexName: 'CreatedAt_Index', KeySchema: [{ AttributeName: 'CreatedAt', KeyType: 'RANGE' }] },
                ],
                GlobalSecondaryIndexes: ORIGINAL_GSIS,
              },
            },
            SomeLambda: { Type: 'AWS::Lambda::Function', Properties: { Runtime: 'nodejs20.x' } },
          },
        },
      ],
    ]);
    const desired = new Map([
      [
        'pre-prod-quality-laboratory-run-table',
        { gsis: DESIRED_GSIS, attributeDefinitions: laboratoryRunTableProps(DESIRED_GSIS).AttributeDefinitions! },
      ],
    ]);

    const changes = applyWaveToCurrentTemplates(current, desired);
    expect(changes).toHaveLength(1);
    expect(changes[0].add).toBe('PollStatus_Index');

    const props = current.get('api-stack')!.Resources!.Run.Properties!;
    expect((props.GlobalSecondaryIndexes ?? []).map((g) => g.IndexName)).toEqual([
      'RunId_Index',
      'UserId_Index',
      'OrganizationId_Index',
      'PollStatus_Index',
    ]);
    expect((props.AttributeDefinitions ?? []).map((d) => d.AttributeName)).toContain('PollStatus');
    expect((props.AttributeDefinitions ?? []).map((d) => d.AttributeName)).not.toContain('WorkflowExternalId');
    expect(current.get('api-stack')!.Resources!.SomeLambda.Properties).toEqual({ Runtime: 'nodejs20.x' });
  });
});

describe('listTableSnapshots', () => {
  it('skips non-table resources and tables without a fixed TableName', () => {
    const snapshots = listTableSnapshots({
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
        AnonymousTable: { Type: 'AWS::DynamoDB::Table', Properties: {} },
        NamedTable: {
          Type: 'AWS::DynamoDB::Table',
          Properties: { TableName: 'named', GlobalSecondaryIndexes: [gsi('A_Index', 'A')] },
        },
      },
    });
    expect(snapshots.map((s) => s.tableName)).toEqual(['named']);
    expect(snapshots[0].logicalId).toBe('NamedTable');
  });
});
