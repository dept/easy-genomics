/**
 * One organization's usage for one lab and workflow on one UTC day, stored in the
 * usage-daily-total-table. OrganizationId is the partition key and DayLabWorkflow the sort key,
 * so an organization's date range is a single Query. Totals are kept apart from runs, so
 * deleting old runs never shrinks a period's figures.
 */
import { RunType } from '../base-entity';

export type UsageDailyTotal = {
  OrganizationId: string;
  DayLabWorkflow: string; // `${Day}#${LaboratoryId}#${Platform}#${WorkflowExternalId}`
  Day: string; // YYYY-MM-DD, UTC
  LaboratoryId: string;
  Platform: RunType;
  WorkflowExternalId: string;
  WorkflowName?: string;
  ComputeCostUsd: number;
  StorageCostUsd: number;
  FinishedRuns: number;
  WarnedRuns: number;
  BlockedLaunches: number;
  ModifiedAt: string;
};

export type RunCostsFigures = {
  EstimatedCostUsd: number;
  FinishedRuns: number;
  WarnedRuns: number;
  BlockedLaunches: number;
};

/** `ChangePercent` is null when the previous period's figure is 0. */
export type RunCostsWorkflowRow = RunCostsFigures & {
  Platform: RunType;
  WorkflowExternalId: string;
  WorkflowName: string;
  PreviousEstimatedCostUsd: number;
  ChangePercent: number | null;
  SharePercent: number;
};

export type RunCostsLabRow = RunCostsFigures & {
  LaboratoryId: string;
  LaboratoryName: string;
  PreviousEstimatedCostUsd: number;
  ChangePercent: number | null;
  SharePercent: number;
  Workflows: RunCostsWorkflowRow[];
};

export type RunCostsReport = {
  Period: { Start: string; End: string }; // inclusive UTC days
  PreviousPeriod: { Start: string; End: string };
  Totals: RunCostsFigures;
  PreviousTotals: RunCostsFigures;
  Labs: RunCostsLabRow[];
};
