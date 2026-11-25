import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { buildLaboratoryWorkflowCostRows } from '../../../../src/app/services/easy-genomics/laboratory-workflow-cost-rows';

const now = new Date('2026-11-19T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

let runCounter = 0;
function run(overrides: Partial<LaboratoryRun> & { cost?: number | null } = {}): LaboratoryRun {
  const { cost = 100, ...rest } = overrides;
  runCounter += 1;
  return {
    LaboratoryId: 'lab-1',
    RunId: `run-${runCounter}`,
    UserId: 'user-1',
    OrganizationId: 'org-1',
    RunName: `run ${runCounter}`,
    Owner: 'owner@example.com',
    Platform: 'AWS HealthOmics',
    WorkflowExternalId: '5734690',
    WorkflowName: 'nf-core/rnaseq',
    Status: 'COMPLETED',
    CreatedAt: daysAgo(11),
    TerminalAt: daysAgo(10),
    ...(cost === null
      ? {}
      : {
          RunCostOutcome: {
            ActualComputeCostUsd: cost,
            CostSource: 'HEALTHOMICS_TASKS',
            CostCapturedAt: daysAgo(10),
          },
        }),
    ...rest,
  } as LaboratoryRun;
}

describe('buildLaboratoryWorkflowCostRows', () => {
  it('takes the median of five successful runs', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [100, 120, 140, 160, 900].map((cost) => run({ cost })),
      undefined,
      now,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        Platform: 'HEALTH_OMICS',
        WorkflowId: '5734690',
        WorkflowName: 'nf-core/rnaseq',
        TypicalRunCostUsd: 140,
        CountedRunCount: 5,
      }),
    ]);
  });

  it('averages the middle two of an even count, to cents', () => {
    const [row] = buildLaboratoryWorkflowCostRows(
      [100, 101, 102, 104].map((cost) => run({ cost })),
      undefined,
      now,
    );
    expect(row.TypicalRunCostUsd).toBe(101.5);

    const [unevenRow] = buildLaboratoryWorkflowCostRows(
      [1.001, 1.002, 1.006, 2].map((cost) => run({ cost })),
      undefined,
      now,
    );
    expect(unevenRow.TypicalRunCostUsd).toBe(1);
  });

  it('gives no typical cost below 3 counted runs, never 0', () => {
    const [row] = buildLaboratoryWorkflowCostRows([run({ cost: 50 }), run({ cost: 60 })], undefined, now);
    expect(row.TypicalRunCostUsd).toBeUndefined();
    expect(row).not.toHaveProperty('TypicalRunCostUsd');
    expect(row.CountedRunCount).toBe(2);
  });

  it('lists but does not count failed runs, runs without a cost, and runs older than 180 days', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [
        run({ cost: 10 }),
        run({ cost: 20 }),
        run({ cost: 30 }),
        run({ cost: 1000, Status: 'FAILED' }),
        run({ cost: null }),
        run({ cost: 2000, TerminalAt: daysAgo(181) }),
      ],
      undefined,
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({ CountedRunCount: 3, TypicalRunCostUsd: 20 }));
  });

  it('lists a workflow whose only runs failed, with nothing counted', () => {
    const rows = buildLaboratoryWorkflowCostRows([run({ Status: 'FAILED' })], undefined, now);
    expect(rows).toEqual([expect.objectContaining({ WorkflowId: '5734690', CountedRunCount: 0 })]);
    expect(rows[0]).not.toHaveProperty('TypicalRunCostUsd');
  });

  it('counts lowercase succeeded', () => {
    const [row] = buildLaboratoryWorkflowCostRows(
      [run({ Status: 'succeeded' }), run({ Status: 'succeeded' }), run({ Status: 'succeeded' })],
      undefined,
      now,
    );
    expect(row.CountedRunCount).toBe(3);
  });

  it('makes one row per workflow across versions, with the latest version', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [
        run({ WorkflowVersionName: '3.14', CreatedAt: daysAgo(5), cost: 30 }),
        run({ WorkflowVersionName: '3.13', CreatedAt: daysAgo(50), cost: 10 }),
        run({ WorkflowVersionName: '3.13', CreatedAt: daysAgo(40), cost: 20 }),
      ],
      undefined,
      now,
    );
    expect(rows).toEqual([expect.objectContaining({ LatestVersionName: '3.14', CountedRunCount: 3 })]);
  });

  it('lists a workflow that has limits but no runs, from the stored entry', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [],
      { 'SEQERA#42': { WorkflowName: 'bactopia', CostBlockAboveUsd: 600 } },
      now,
    );
    expect(rows).toEqual([
      { Platform: 'SEQERA', WorkflowId: '42', WorkflowName: 'bactopia', CostBlockAboveUsd: 600, CountedRunCount: 0 },
    ]);
  });

  it("attaches the workflow's own amounts to its run row", () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [run()],
      { 'HEALTH_OMICS#5734690': { WorkflowName: 'nf-core/rnaseq', CostWarnAboveUsd: 200, CostBlockAboveUsd: 400 } },
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({ WorkflowId: '5734690', CostWarnAboveUsd: 200, CostBlockAboveUsd: 400 }),
    );
  });

  it('keeps the same workflow ID on two platforms apart', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [
        run({ WorkflowExternalId: '42', WorkflowName: 'a' }),
        run({ Platform: 'Seqera Cloud', WorkflowExternalId: '42', WorkflowName: 'b' }),
      ],
      undefined,
      now,
    );
    expect(rows.map((row) => [row.Platform, row.WorkflowId])).toEqual([
      ['HEALTH_OMICS', '42'],
      ['SEQERA', '42'],
    ]);
  });

  it('falls back to the stored name, then the ID, when runs have no WorkflowName', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [
        run({ WorkflowExternalId: '1', WorkflowName: undefined }),
        run({ WorkflowExternalId: '2', WorkflowName: undefined }),
      ],
      { 'HEALTH_OMICS#1': { WorkflowName: 'stored name', CostWarnAboveUsd: 10 } },
      now,
    );
    expect(rows.map((row) => [row.WorkflowId, row.WorkflowName])).toEqual([
      ['2', '2'],
      ['1', 'stored name'],
    ]);
  });

  it('sorts by workflow name, ignoring case, then by workflow ID', () => {
    const rows = buildLaboratoryWorkflowCostRows(
      [
        run({ WorkflowExternalId: '3', WorkflowName: 'beta' }),
        run({ WorkflowExternalId: '2', WorkflowName: 'Alpha' }),
        run({ WorkflowExternalId: '1', WorkflowName: 'alpha' }),
      ],
      undefined,
      now,
    );
    expect(rows.map((row) => row.WorkflowId)).toEqual(['1', '2', '3']);
  });

  it('skips runs with no WorkflowExternalId', () => {
    expect(buildLaboratoryWorkflowCostRows([run({ WorkflowExternalId: undefined })], undefined, now)).toEqual([]);
  });
});
