import { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  RunCostsFigures,
  RunCostsLabRow,
  RunCostsReport,
  RunCostsWorkflowRow,
  UsageDailyTotal,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
import { workflowRunLimitsKeyForRun } from '@easy-genomics/shared-lib/src/app/utils/workflow-run-limits';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
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

export function workflowNameFallbackKey(laboratoryId: string, platform: RunType, workflowExternalId: string): string {
  return `${laboratoryId}#${platform}#${workflowExternalId}`;
}

type LabTally = { tally: Tally; workflows: Map<string, { platform: RunType; externalId: string; tally: Tally }> };

/**
 * Sums the daily totals into lab rows, then workflow rows. A lab or workflow that only appears in the previous period
 * is still listed at zero, so a drop is visible. A row written only by a blocked launch has no workflow name, so the
 * name comes from any row for the same workflow, then from `fallbackWorkflowNames` (keyed by `workflowNameFallbackKey`),
 * and otherwise is the external id.
 */
export function buildRunCostsReport(
  current: UsageDailyTotal[],
  previous: UsageDailyTotal[],
  labNames: Map<string, string>,
  periods: RunCostsPeriods,
  fallbackWorkflowNames: Map<string, string> = new Map(),
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
      WorkflowName:
        workflowNames.get(key) ??
        fallbackWorkflowNames.get(workflowNameFallbackKey(laboratoryId, workflow.platform, workflow.externalId)) ??
        workflow.externalId,
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
  private readonly laboratoryRunService = new LaboratoryRunService();

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
    const report = buildRunCostsReport(current, previous, labNames, periods);
    const fallbackWorkflowNames = await this.findFallbackWorkflowNames(report, laboratories);
    return fallbackWorkflowNames.size === 0
      ? report
      : buildRunCostsReport(current, previous, labNames, periods, fallbackWorkflowNames);
  };

  /**
   * Only labs that still show a workflow by its id are read, so a report whose workflows are all named costs no run
   * reads. A lab whose runs cannot be read keeps the limit names, or the ids, rather than failing the report.
   */
  private findFallbackWorkflowNames = async (
    report: RunCostsReport,
    laboratories: Laboratory[],
  ): Promise<Map<string, string>> => {
    const laboratoriesById = new Map(laboratories.map((laboratory) => [laboratory.LaboratoryId, laboratory]));
    const namesByLab = await Promise.all(
      report.Labs.map(async (lab) => {
        const laboratory = laboratoriesById.get(lab.LaboratoryId);
        const unnamed = lab.Workflows.filter((workflow) => workflow.WorkflowName === workflow.WorkflowExternalId);
        return laboratory && unnamed.length > 0 ? this.workflowNamesForLaboratory(laboratory, unnamed) : new Map();
      }),
    );
    return new Map(namesByLab.flatMap((names) => [...names]));
  };

  private workflowNamesForLaboratory = async (
    laboratory: Laboratory,
    unnamedWorkflows: RunCostsWorkflowRow[],
  ): Promise<Map<string, string>> => {
    const latestRunNames = await this.latestRunNames(laboratory.LaboratoryId);
    const names = new Map<string, string>();
    for (const { Platform, WorkflowExternalId } of unnamedWorkflows) {
      const key = workflowNameFallbackKey(laboratory.LaboratoryId, Platform, WorkflowExternalId);
      const limitsName =
        laboratory.WorkflowRunLimits?.[workflowRunLimitsKeyForRun(Platform, WorkflowExternalId)]?.WorkflowName;
      const name = latestRunNames.get(key) ?? limitsName;
      if (name) names.set(key, name);
    }
    return names;
  };

  private latestRunNames = async (laboratoryId: string): Promise<Map<string, string>> => {
    const names = new Map<string, string>();
    try {
      const runs = await this.laboratoryRunService.listAllRunsForLaboratory(laboratoryId, [
        'WorkflowExternalId',
        'Platform',
        'WorkflowName',
        'CreatedAt',
      ]);
      const newestFirst = [...runs].sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
      for (const run of newestFirst) {
        if (!run.WorkflowName || !run.WorkflowExternalId) continue;
        const key = workflowNameFallbackKey(laboratoryId, run.Platform, run.WorkflowExternalId);
        if (!names.has(key)) names.set(key, run.WorkflowName);
      }
    } catch (error) {
      console.error(`Run costs: could not read runs for LaboratoryId=${laboratoryId} to name its workflows`, error);
    }
    return names;
  };
}
