process.env.NAME_PREFIX = 'unit-test';

import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import { UsageDailyTotal } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';

const mockQueryRange = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/usage-totals-service', () => ({
  UsageTotalsService: jest.fn().mockImplementation(() => ({
    queryRange: (...args: unknown[]) => mockQueryRange(...args),
  })),
}));
const mockQueryByOrganizationId = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/laboratory-service', () => ({
  LaboratoryService: jest.fn().mockImplementation(() => ({
    queryByOrganizationId: (...args: unknown[]) => mockQueryByOrganizationId(...args),
  })),
}));

const mockListAllRunsForLaboratory = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/laboratory-run-service', () => ({
  LaboratoryRunService: jest.fn().mockImplementation(() => ({
    listAllRunsForLaboratory: (...args: unknown[]) => mockListAllRunsForLaboratory(...args),
  })),
}));

import {
  buildRunCostsReport,
  resolveRunCostsPeriods,
  RunCostsReportService,
} from '../../../../src/app/services/easy-genomics/run-costs-report-service';

const ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';
const LAB_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const LAB_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const DELETED_LAB = 'dddddddd-0000-0000-0000-00000000000d';

const PERIODS = {
  Period: { Start: '2026-03-01', End: '2026-03-31' },
  PreviousPeriod: { Start: '2026-02-01', End: '2026-02-28' },
};

function total(
  overrides: Partial<UsageDailyTotal> & { LaboratoryId: string; WorkflowExternalId: string },
): UsageDailyTotal {
  const day = overrides.Day ?? '2026-03-10';
  const platform: RunType = overrides.Platform ?? 'AWS HealthOmics';
  return {
    OrganizationId: ORGANIZATION_ID,
    DayLabWorkflow: `${day}#${overrides.LaboratoryId}#${platform}#${overrides.WorkflowExternalId}`,
    Day: day,
    Platform: platform,
    ComputeCostUsd: 0,
    StorageCostUsd: 0,
    FinishedRuns: 0,
    WarnedRuns: 0,
    BlockedLaunches: 0,
    ModifiedAt: '2026-03-10T00:00:00.000Z',
    ...overrides,
  };
}

const labNames = new Map([
  [LAB_A, 'Alpha Lab'],
  [LAB_B, 'Beta Lab'],
]);

describe('resolveRunCostsPeriods', () => {
  const today = new Date('2026-11-10T23:59:00.000Z');

  it('covers a calendar month, compared with the whole previous month', () => {
    expect(
      resolveRunCostsPeriods({ organizationId: ORGANIZATION_ID, period: 'month', month: '2026-03' }, today),
    ).toEqual({
      Period: { Start: '2026-03-01', End: '2026-03-31' },
      PreviousPeriod: { Start: '2026-02-01', End: '2026-02-28' },
    });
  });

  it('compares March of a leap year with a 29-day February', () => {
    expect(
      resolveRunCostsPeriods({ organizationId: ORGANIZATION_ID, period: 'month', month: '2024-03' }, today)
        .PreviousPeriod,
    ).toEqual({ Start: '2024-02-01', End: '2024-02-29' });
  });

  it('compares January with the previous December', () => {
    expect(
      resolveRunCostsPeriods({ organizationId: ORGANIZATION_ID, period: 'month', month: '2026-01' }, today),
    ).toEqual({
      Period: { Start: '2026-01-01', End: '2026-01-31' },
      PreviousPeriod: { Start: '2025-12-01', End: '2025-12-31' },
    });
  });

  it('ends a rolling 30 days on today, inclusive, compared with the 30 days before', () => {
    expect(resolveRunCostsPeriods({ organizationId: ORGANIZATION_ID, period: '30d' }, today)).toEqual({
      Period: { Start: '2026-10-12', End: '2026-11-10' },
      PreviousPeriod: { Start: '2026-09-12', End: '2026-10-11' },
    });
  });

  it('crosses a year boundary for 90 days', () => {
    expect(
      resolveRunCostsPeriods({ organizationId: ORGANIZATION_ID, period: '90d' }, new Date('2026-02-15T00:00:00.000Z')),
    ).toEqual({
      Period: { Start: '2025-11-18', End: '2026-02-15' },
      PreviousPeriod: { Start: '2025-08-20', End: '2025-11-17' },
    });
  });

  it('uses the UTC day, not the local one', () => {
    expect(
      resolveRunCostsPeriods({ organizationId: ORGANIZATION_ID, period: '60d' }, new Date('2026-11-10T00:30:00.000Z'))
        .Period.End,
    ).toBe('2026-11-10');
  });
});

describe('buildRunCostsReport', () => {
  it('sums compute cost and counts across days, per lab and per workflow, and reports the periods', () => {
    const current = [
      total({
        LaboratoryId: LAB_A,
        WorkflowExternalId: 'wf-1',
        WorkflowName: 'viralrecon',
        Day: '2026-03-01',
        ComputeCostUsd: 10,
        StorageCostUsd: 99,
        FinishedRuns: 2,
        WarnedRuns: 1,
      }),
      total({
        LaboratoryId: LAB_A,
        WorkflowExternalId: 'wf-1',
        WorkflowName: 'viralrecon',
        Day: '2026-03-02',
        ComputeCostUsd: 5,
        FinishedRuns: 1,
        BlockedLaunches: 2,
      }),
    ];

    const report = buildRunCostsReport(current, [], labNames, PERIODS);

    expect(report.Period).toEqual(PERIODS.Period);
    expect(report.PreviousPeriod).toEqual(PERIODS.PreviousPeriod);
    expect(report.Totals).toEqual({ EstimatedCostUsd: 15, FinishedRuns: 3, WarnedRuns: 1, BlockedLaunches: 2 });
    expect(report.PreviousTotals).toEqual({ EstimatedCostUsd: 0, FinishedRuns: 0, WarnedRuns: 0, BlockedLaunches: 0 });
    expect(report.Labs).toEqual([
      {
        LaboratoryId: LAB_A,
        LaboratoryName: 'Alpha Lab',
        EstimatedCostUsd: 15,
        FinishedRuns: 3,
        WarnedRuns: 1,
        BlockedLaunches: 2,
        PreviousEstimatedCostUsd: 0,
        ChangePercent: null,
        SharePercent: 100,
        Workflows: [
          {
            Platform: 'AWS HealthOmics',
            WorkflowExternalId: 'wf-1',
            WorkflowName: 'viralrecon',
            EstimatedCostUsd: 15,
            FinishedRuns: 3,
            WarnedRuns: 1,
            BlockedLaunches: 2,
            PreviousEstimatedCostUsd: 0,
            ChangePercent: null,
            SharePercent: 100,
          },
        ],
      },
    ]);
  });

  it('sorts labs and workflows by current cost, highest first, breaking ties by name', () => {
    const current = [
      total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-z', WorkflowName: 'zeta', ComputeCostUsd: 10 }),
      total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-a', WorkflowName: 'alpha', ComputeCostUsd: 10 }),
      total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-big', WorkflowName: 'big', ComputeCostUsd: 30 }),
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', WorkflowName: 'one', ComputeCostUsd: 50 }),
    ];

    const report = buildRunCostsReport(current, [], labNames, PERIODS);

    expect(report.Labs.map((lab) => lab.LaboratoryName)).toEqual(['Alpha Lab', 'Beta Lab']);
    expect(report.Labs[1].Workflows.map((workflow) => workflow.WorkflowName)).toEqual(['big', 'alpha', 'zeta']);

    const tied = buildRunCostsReport(
      [
        total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-1', ComputeCostUsd: 5 }),
        total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', ComputeCostUsd: 5 }),
      ],
      [],
      labNames,
      PERIODS,
    );
    expect(tied.Labs.map((lab) => lab.LaboratoryName)).toEqual(['Alpha Lab', 'Beta Lab']);
  });

  it("gives each row's share of the organization's cost, and its change from the previous period", () => {
    const current = [
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', ComputeCostUsd: 30 }),
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-2', ComputeCostUsd: 10 }),
      total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-3', ComputeCostUsd: 60 }),
    ];
    const previous = [
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', Day: '2026-02-10', ComputeCostUsd: 20 }),
      total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-3', Day: '2026-02-10', ComputeCostUsd: 80 }),
    ];

    const report = buildRunCostsReport(current, previous, labNames, PERIODS);

    const [labB, labA] = report.Labs;
    expect(labB).toMatchObject({ SharePercent: 60, PreviousEstimatedCostUsd: 80, ChangePercent: -25 });
    expect(labA).toMatchObject({ SharePercent: 40, PreviousEstimatedCostUsd: 20, ChangePercent: 100 });
    expect(labA.Workflows).toEqual([
      expect.objectContaining({ WorkflowExternalId: 'wf-1', SharePercent: 30, ChangePercent: 50 }),
      expect.objectContaining({ WorkflowExternalId: 'wf-2', SharePercent: 10, ChangePercent: null }),
    ]);
    expect(report.PreviousTotals.EstimatedCostUsd).toBe(100);
  });

  it('gives every row a 0% share when the organization spent nothing', () => {
    const report = buildRunCostsReport(
      [total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', BlockedLaunches: 1 })],
      [],
      labNames,
      PERIODS,
    );

    expect(report.Labs[0].SharePercent).toBe(0);
    expect(report.Labs[0].Workflows[0].SharePercent).toBe(0);
  });

  it('still lists a lab and workflow that only ran in the previous period, at zero, so the drop is visible', () => {
    const previous = [
      total({
        LaboratoryId: LAB_B,
        WorkflowExternalId: 'wf-old',
        WorkflowName: 'old',
        Day: '2026-02-03',
        ComputeCostUsd: 40,
        FinishedRuns: 4,
      }),
    ];

    const report = buildRunCostsReport([], previous, labNames, PERIODS);

    expect(report.Labs).toEqual([
      expect.objectContaining({
        LaboratoryId: LAB_B,
        EstimatedCostUsd: 0,
        FinishedRuns: 0,
        PreviousEstimatedCostUsd: 40,
        ChangePercent: -100,
        Workflows: [
          expect.objectContaining({
            WorkflowName: 'old',
            EstimatedCostUsd: 0,
            PreviousEstimatedCostUsd: 40,
            ChangePercent: -100,
          }),
        ],
      }),
    ]);
    expect(report.PreviousTotals).toEqual({ EstimatedCostUsd: 40, FinishedRuns: 4, WarnedRuns: 0, BlockedLaunches: 0 });
  });

  it('names a deleted lab from its id instead of failing', () => {
    const report = buildRunCostsReport(
      [total({ LaboratoryId: DELETED_LAB, WorkflowExternalId: 'wf-1', ComputeCostUsd: 1 })],
      [],
      labNames,
      PERIODS,
    );

    expect(report.Labs[0].LaboratoryName).toBe('Deleted lab (dddddddd)');
  });

  it("takes a workflow's name from any row for it, and falls back to its external id", () => {
    const current = [
      // Written only by a blocked launch, which carries no name.
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', Day: '2026-03-01', BlockedLaunches: 1 }),
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-2', BlockedLaunches: 1 }),
    ];
    const previous = [
      total({ LaboratoryId: LAB_B, WorkflowExternalId: 'wf-1', WorkflowName: 'viralrecon', Day: '2026-02-01' }),
    ];

    const report = buildRunCostsReport(current, previous, labNames, PERIODS);

    const labA = report.Labs.find((lab) => lab.LaboratoryId === LAB_A)!;
    expect(labA.Workflows.map((workflow) => workflow.WorkflowName).sort()).toEqual(['viralrecon', 'wf-2']);
  });

  it('keeps the same external id on two platforms as two workflows', () => {
    const report = buildRunCostsReport(
      [
        total({ LaboratoryId: LAB_A, WorkflowExternalId: '42', Platform: 'AWS HealthOmics', ComputeCostUsd: 2 }),
        total({ LaboratoryId: LAB_A, WorkflowExternalId: '42', Platform: 'Seqera Cloud', ComputeCostUsd: 1 }),
      ],
      [],
      labNames,
      PERIODS,
    );

    expect(report.Labs[0].Workflows.map((workflow) => workflow.Platform)).toEqual(['AWS HealthOmics', 'Seqera Cloud']);
  });

  it('makes the totals the sum of the lab rows', () => {
    const current = [
      total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', ComputeCostUsd: 12.5, FinishedRuns: 1, WarnedRuns: 1 }),
      total({
        LaboratoryId: LAB_B,
        WorkflowExternalId: 'wf-2',
        ComputeCostUsd: 7.5,
        FinishedRuns: 2,
        BlockedLaunches: 3,
      }),
    ];

    const report = buildRunCostsReport(current, [], labNames, PERIODS);

    const summed = report.Labs.reduce(
      (sum, lab) => ({
        EstimatedCostUsd: sum.EstimatedCostUsd + lab.EstimatedCostUsd,
        FinishedRuns: sum.FinishedRuns + lab.FinishedRuns,
        WarnedRuns: sum.WarnedRuns + lab.WarnedRuns,
        BlockedLaunches: sum.BlockedLaunches + lab.BlockedLaunches,
      }),
      { EstimatedCostUsd: 0, FinishedRuns: 0, WarnedRuns: 0, BlockedLaunches: 0 },
    );
    expect(report.Totals).toEqual(summed);
    expect(report.Totals).toEqual({ EstimatedCostUsd: 20, FinishedRuns: 3, WarnedRuns: 1, BlockedLaunches: 3 });
  });
});

describe('buildRunCostsReport fallback workflow names', () => {
  const launchOnly = total({ LaboratoryId: LAB_A, WorkflowExternalId: '4995724', BlockedLaunches: 1 });
  const fallbackKey = `${LAB_A}#AWS HealthOmics#4995724`;

  it('names a workflow from the fallback map when no totals row has its name', () => {
    const report = buildRunCostsReport([launchOnly], [], labNames, PERIODS, new Map([[fallbackKey, 'Workshop main']]));

    expect(report.Labs[0].Workflows[0].WorkflowName).toBe('Workshop main');
  });

  it('prefers a totals row name over the fallback map', () => {
    const named = total({ LaboratoryId: LAB_A, WorkflowExternalId: '4995724', WorkflowName: 'From totals' });
    const report = buildRunCostsReport(
      [launchOnly, named],
      [],
      labNames,
      PERIODS,
      new Map([[fallbackKey, 'Workshop main']]),
    );

    expect(report.Labs[0].Workflows[0].WorkflowName).toBe('From totals');
  });
});

describe('RunCostsReportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAllRunsForLaboratory.mockResolvedValue([]);
  });

  it("reads both periods and the organization's labs, then builds the report", async () => {
    mockQueryRange.mockImplementation(async (_organizationId: string, start: string) =>
      start === '2026-03-01'
        ? [total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', ComputeCostUsd: 30 })]
        : [total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', Day: '2026-02-10', ComputeCostUsd: 20 })],
    );
    mockQueryByOrganizationId.mockResolvedValue([
      { OrganizationId: ORGANIZATION_ID, LaboratoryId: LAB_A, Name: 'Alpha Lab' },
    ]);

    const report = await new RunCostsReportService().getReport(
      { organizationId: ORGANIZATION_ID, period: 'month', month: '2026-03' },
      new Date('2026-11-10T00:00:00.000Z'),
    );

    expect(mockQueryRange).toHaveBeenCalledTimes(2);
    expect(mockQueryRange).toHaveBeenCalledWith(ORGANIZATION_ID, '2026-03-01', '2026-03-31');
    expect(mockQueryRange).toHaveBeenCalledWith(ORGANIZATION_ID, '2026-02-01', '2026-02-28');
    expect(mockQueryByOrganizationId).toHaveBeenCalledTimes(1);
    expect(mockQueryByOrganizationId).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(report.Labs[0]).toMatchObject({ LaboratoryName: 'Alpha Lab', EstimatedCostUsd: 30, ChangePercent: 50 });
  });

  describe('naming workflows that only have launch counts', () => {
    const launchOnlyTotals = (laboratoryId: string, workflowExternalId = '4995724') => [
      total({ LaboratoryId: laboratoryId, WorkflowExternalId: workflowExternalId, BlockedLaunches: 2 }),
    ];
    const getReport = () =>
      new RunCostsReportService().getReport(
        { organizationId: ORGANIZATION_ID, period: 'month', month: '2026-03' },
        new Date('2026-11-10T00:00:00.000Z'),
      );
    const givenTotals = (rows: UsageDailyTotal[]) =>
      mockQueryRange.mockImplementation(async (_organizationId: string, start: string) =>
        start === '2026-03-01' ? rows : [],
      );
    const lab = (laboratoryId: string, name: string, workflowRunLimits?: Record<string, unknown>) => ({
      OrganizationId: ORGANIZATION_ID,
      LaboratoryId: laboratoryId,
      Name: name,
      WorkflowRunLimits: workflowRunLimits,
    });

    it("names a workflow with only launch counts from the lab's latest named run", async () => {
      givenTotals(launchOnlyTotals(LAB_A));
      mockQueryByOrganizationId.mockResolvedValue([lab(LAB_A, 'Alpha Lab')]);
      mockListAllRunsForLaboratory.mockResolvedValue([
        {
          WorkflowExternalId: '4995724',
          Platform: 'AWS HealthOmics',
          WorkflowName: 'Old name',
          CreatedAt: '2026-01-01',
        },
        {
          WorkflowExternalId: '4995724',
          Platform: 'AWS HealthOmics',
          WorkflowName: 'Latest name',
          CreatedAt: '2026-03-01',
        },
        { WorkflowExternalId: '4995724', Platform: 'AWS HealthOmics', WorkflowName: '', CreatedAt: '2026-03-05' },
        { WorkflowExternalId: 'other', Platform: 'AWS HealthOmics', WorkflowName: 'Other', CreatedAt: '2026-03-06' },
      ]);

      const report = await getReport();

      expect(mockListAllRunsForLaboratory).toHaveBeenCalledWith(LAB_A, [
        'WorkflowExternalId',
        'Platform',
        'WorkflowName',
        'CreatedAt',
      ]);
      expect(report.Labs[0].Workflows[0].WorkflowName).toBe('Latest name');
    });

    it('falls back to the workflow limit name, then the ID', async () => {
      givenTotals([...launchOnlyTotals(LAB_A, 'wf-limit'), ...launchOnlyTotals(LAB_A, 'wf-bare')]);
      mockQueryByOrganizationId.mockResolvedValue([
        lab(LAB_A, 'Alpha Lab', { 'HEALTH_OMICS#wf-limit': { WorkflowName: 'Limit name' } }),
      ]);
      mockListAllRunsForLaboratory.mockResolvedValue([]);

      const report = await getReport();

      const names = Object.fromEntries(
        report.Labs[0].Workflows.map((row) => [row.WorkflowExternalId, row.WorkflowName]),
      );
      expect(names).toEqual({ 'wf-limit': 'Limit name', 'wf-bare': 'wf-bare' });
    });

    it('does not read runs for a lab whose workflows are all named', async () => {
      givenTotals([total({ LaboratoryId: LAB_A, WorkflowExternalId: 'wf-1', WorkflowName: 'Named', FinishedRuns: 1 })]);
      mockQueryByOrganizationId.mockResolvedValue([lab(LAB_A, 'Alpha Lab')]);

      await getReport();

      expect(mockListAllRunsForLaboratory).not.toHaveBeenCalled();
    });

    it('does not read runs for a deleted lab', async () => {
      givenTotals(launchOnlyTotals(DELETED_LAB));
      mockQueryByOrganizationId.mockResolvedValue([lab(LAB_A, 'Alpha Lab')]);

      const report = await getReport();

      expect(mockListAllRunsForLaboratory).not.toHaveBeenCalled();
      expect(report.Labs[0].Workflows[0].WorkflowName).toBe('4995724');
    });

    it("keeps the ID and logs when a lab's runs cannot be read", async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      givenTotals([...launchOnlyTotals(LAB_A), ...launchOnlyTotals(LAB_B)]);
      mockQueryByOrganizationId.mockResolvedValue([lab(LAB_A, 'Alpha Lab'), lab(LAB_B, 'Beta Lab')]);
      mockListAllRunsForLaboratory.mockImplementation(async (laboratoryId: string) => {
        if (laboratoryId === LAB_A) throw new Error('throttled');
        return [
          {
            WorkflowExternalId: '4995724',
            Platform: 'AWS HealthOmics',
            WorkflowName: 'Beta name',
            CreatedAt: '2026-03-01',
          },
        ];
      });

      const report = await getReport();

      const nameIn = (name: string) =>
        report.Labs.find((row) => row.LaboratoryName === name)!.Workflows[0].WorkflowName;
      expect(nameIn('Alpha Lab')).toBe('4995724');
      expect(nameIn('Beta Lab')).toBe('Beta name');
      expect(consoleError).toHaveBeenCalledWith(
        `Run costs: could not read runs for LaboratoryId=${LAB_A} to name its workflows`,
        expect.any(Error),
      );
      consoleError.mockRestore();
    });
  });
});
