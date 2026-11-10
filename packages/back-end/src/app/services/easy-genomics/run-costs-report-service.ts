import { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import {
  RunCostsFigures,
  RunCostsLabRow,
  RunCostsReport,
  RunCostsWorkflowRow,
  UsageDailyTotal,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { UsageTotalsService } from '@BE/services/easy-genomics/usage-totals-service';

type DayRange = { Start: string; End: string };
export type RunCostsPeriods = { Period: DayRange; PreviousPeriod: DayRange };

const ROLLING_PERIOD_DAYS: Record<'30d' | '60d' | '90d', number> = { '30d': 30, '60d': 60, '90d': 90 };

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDay(date);
}

/** Day 0 of the next month is the last day of this one. */
function calendarMonth(year: number, monthIndex: number): DayRange {
  return {
    Start: utcDay(new Date(Date.UTC(year, monthIndex, 1))),
    End: utcDay(new Date(Date.UTC(year, monthIndex + 1, 0))),
  };
}

/**
 * A month is compared with the whole previous month, whatever its length. A rolling period ends on today (UTC),
 * inclusive, and is compared with the same number of days before it.
 */
export function resolveRunCostsPeriods(query: RunCostsQuery, today: Date): RunCostsPeriods {
  if (query.period === 'month') {
    const [year, month] = query.month.split('-').map(Number);
    return { Period: calendarMonth(year, month - 1), PreviousPeriod: calendarMonth(year, month - 2) };
  }

  const days = ROLLING_PERIOD_DAYS[query.period];
  const end = utcDay(today);
  const start = addDays(end, -(days - 1));
  return {
    Period: { Start: start, End: end },
    PreviousPeriod: { Start: addDays(start, -days), End: addDays(start, -1) },
  };
}

type Tally = RunCostsFigures & { PreviousEstimatedCostUsd: number };

function emptyFigures(): RunCostsFigures {
  return { EstimatedCostUsd: 0, FinishedRuns: 0, WarnedRuns: 0, BlockedLaunches: 0 };
}

/** The reported cost is compute only; storage is stored separately and left out. */
function addTo(figures: RunCostsFigures, total: UsageDailyTotal): void {
  figures.EstimatedCostUsd += total.ComputeCostUsd ?? 0;
  figures.FinishedRuns += total.FinishedRuns ?? 0;
  figures.WarnedRuns += total.WarnedRuns ?? 0;
  figures.BlockedLaunches += total.BlockedLaunches ?? 0;
}

function workflowKey(platform: RunType, workflowExternalId: string): string {
  return `${platform}#${workflowExternalId}`;
}

function changePercent(current: number, previous: number): number | null {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}

function sharePercent(cost: number, organizationCost: number): number {
  return organizationCost === 0 ? 0 : (cost / organizationCost) * 100;
}

function byCostThenName<T extends { EstimatedCostUsd: number }>(nameOf: (row: T) => string) {
  return (a: T, b: T) => b.EstimatedCostUsd - a.EstimatedCostUsd || nameOf(a).localeCompare(nameOf(b));
}

function deletedLabName(laboratoryId: string): string {
  return `Deleted lab (${laboratoryId.slice(0, 8)})`;
}

type LabTally = { tally: Tally; workflows: Map<string, { platform: RunType; externalId: string; tally: Tally }> };

/**
 * Sums the daily totals into lab rows, then workflow rows. A lab or workflow that only appears in the previous period
 * is still listed at zero, so a drop is visible. A row written only by a blocked launch has no workflow name, so the
 * name comes from any row for the same workflow, and otherwise is the external id.
 */
export function buildRunCostsReport(
  current: UsageDailyTotal[],
  previous: UsageDailyTotal[],
  labNames: Map<string, string>,
  periods: RunCostsPeriods,
): RunCostsReport {
  const totals = emptyFigures();
  const previousTotals = emptyFigures();
  const labs = new Map<string, LabTally>();
  const workflowNames = new Map<string, string>();

  const tallyFor = (row: UsageDailyTotal) => {
    let lab = labs.get(row.LaboratoryId);
    if (!lab) {
      lab = { tally: { ...emptyFigures(), PreviousEstimatedCostUsd: 0 }, workflows: new Map() };
      labs.set(row.LaboratoryId, lab);
    }
    const key = workflowKey(row.Platform, row.WorkflowExternalId);
    let workflow = lab.workflows.get(key);
    if (!workflow) {
      workflow = {
        platform: row.Platform,
        externalId: row.WorkflowExternalId,
        tally: { ...emptyFigures(), PreviousEstimatedCostUsd: 0 },
      };
      lab.workflows.set(key, workflow);
    }
    if (row.WorkflowName && !workflowNames.has(key)) workflowNames.set(key, row.WorkflowName);
    return { lab: lab.tally, workflow: workflow.tally };
  };

  for (const row of current) {
    const { lab, workflow } = tallyFor(row);
    addTo(totals, row);
    addTo(lab, row);
    addTo(workflow, row);
  }
  for (const row of previous) {
    const { lab, workflow } = tallyFor(row);
    addTo(previousTotals, row);
    lab.PreviousEstimatedCostUsd += row.ComputeCostUsd ?? 0;
    workflow.PreviousEstimatedCostUsd += row.ComputeCostUsd ?? 0;
  }

  const comparison = (tally: Tally) => ({
    PreviousEstimatedCostUsd: tally.PreviousEstimatedCostUsd,
    ChangePercent: changePercent(tally.EstimatedCostUsd, tally.PreviousEstimatedCostUsd),
    SharePercent: sharePercent(tally.EstimatedCostUsd, totals.EstimatedCostUsd),
  });
  const figuresOf = (tally: Tally): RunCostsFigures => ({
    EstimatedCostUsd: tally.EstimatedCostUsd,
    FinishedRuns: tally.FinishedRuns,
    WarnedRuns: tally.WarnedRuns,
    BlockedLaunches: tally.BlockedLaunches,
  });

  const labRows: RunCostsLabRow[] = [...labs].map(([laboratoryId, lab]) => {
    const workflowRows: RunCostsWorkflowRow[] = [...lab.workflows].map(([key, workflow]) => ({
      Platform: workflow.platform,
      WorkflowExternalId: workflow.externalId,
      WorkflowName: workflowNames.get(key) ?? workflow.externalId,
      ...figuresOf(workflow.tally),
      ...comparison(workflow.tally),
    }));
    return {
      LaboratoryId: laboratoryId,
      LaboratoryName: labNames.get(laboratoryId) ?? deletedLabName(laboratoryId),
      ...figuresOf(lab.tally),
      ...comparison(lab.tally),
      Workflows: workflowRows.sort(byCostThenName((row) => row.WorkflowName)),
    };
  });

  return {
    Period: periods.Period,
    PreviousPeriod: periods.PreviousPeriod,
    Totals: totals,
    PreviousTotals: previousTotals,
    Labs: labRows.sort(byCostThenName((row) => row.LaboratoryName)),
  };
}

export class RunCostsReportService {
  private readonly usageTotalsService = new UsageTotalsService();
  private readonly laboratoryService = new LaboratoryService();

  /** `today` is passed in so the rolling periods are deterministic in tests. */
  public getReport = async (query: RunCostsQuery, today: Date): Promise<RunCostsReport> => {
    const periods = resolveRunCostsPeriods(query, today);
    const [current, previous, laboratories] = await Promise.all([
      this.usageTotalsService.queryRange(query.organizationId, periods.Period.Start, periods.Period.End),
      this.usageTotalsService.queryRange(
        query.organizationId,
        periods.PreviousPeriod.Start,
        periods.PreviousPeriod.End,
      ),
      this.laboratoryService.queryByOrganizationId(query.organizationId),
    ]);
    const labNames = new Map(laboratories.map((laboratory) => [laboratory.LaboratoryId, laboratory.Name]));
    return buildRunCostsReport(current, previous, labNames, periods);
  };
}
