/**
 * Calculate HealthOmics private-workflow compute cost from ListRunTasks data
 * using AWS list prices for the deployment region. Follows AWS billing rules:
 * - per-second billing with a 60-second minimum per task
 * - cache hits are free
 * - every task that ran is billed, whatever its final status: AWS bills failed
 *   and cancelled runs "for any resources that were used up until the point of
 *   cancellation or failure" (https://aws.amazon.com/healthomics/pricing/).
 *   A task with no start or stop time never ran and costs nothing.
 *
 * Callers may pass a region's rates directly (the deployment's refreshed rates).
 * Otherwise rates come from `healthomics-rates.generated.ts`, regenerated from AWS's
 * public price list by `pnpm run generate:healthomics-rates`. A region missing from it
 * falls back to us-east-1 rates, and an instance type missing from it adds $0;
 * both are logged. Enterprise discounts are not reflected.
 */
import { HealthOmicsRegionRates } from './healthomics-price-list';
import { HEALTHOMICS_RATES_BY_REGION } from './healthomics-rates.generated';

export type OmicsRunTaskLike = {
  instanceType?: string | null;
  startTime?: Date | string | null;
  stopTime?: Date | string | null;
  status?: string | null;
  cacheHit?: boolean | null;
  cpus?: number | null;
  memory?: number | null;
  gpus?: number | null;
};

export type OmicsRunStorageLike = {
  storageType?: 'STATIC' | 'DYNAMIC' | string | null;
  storageCapacity?: number | null; // GiB
  startTime?: Date | string | null;
  stopTime?: Date | string | null;
};

const DEFAULT_REGION = 'us-east-1';
const MIN_BILLABLE_SECONDS = 60;

function toMs(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : undefined;
}

function billableSeconds(start: Date | string | null | undefined, stop: Date | string | null | undefined): number {
  const startMs = toMs(start);
  const stopMs = toMs(stop);
  if (startMs == null || stopMs == null || stopMs < startMs) return 0;
  const elapsed = Math.round((stopMs - startMs) / 1000);
  return Math.max(elapsed, MIN_BILLABLE_SECONDS);
}

function resolveRegionRates(region: string, runId: string | undefined): HealthOmicsRegionRates {
  const regional = HEALTHOMICS_RATES_BY_REGION[region];
  if (regional) return regional;
  console.warn(
    `No HealthOmics rates for region ${region}; pricing RunId=${runId ?? 'unknown'} at ${DEFAULT_REGION} rates`,
  );
  return HEALTHOMICS_RATES_BY_REGION[DEFAULT_REGION];
}

/**
 * Sum compute cost across ListRunTasks items.
 */
export function calculateHealthOmicsComputeCostUsd(
  tasks: OmicsRunTaskLike[],
  region: string = DEFAULT_REGION,
  runId?: string,
  regionRates?: HealthOmicsRegionRates,
): number {
  const rates = regionRates ?? resolveRegionRates(region, runId);
  const unpricedTaskCounts = new Map<string, number>();
  let total = 0;
  for (const task of tasks) {
    if (task.cacheHit) continue;
    const instanceType = task.instanceType?.trim();
    if (!instanceType) continue;
    const seconds = billableSeconds(task.startTime, task.stopTime);
    if (seconds <= 0) continue;
    const hourly = rates.instanceHourlyUsd[instanceType];
    if (hourly == null) {
      unpricedTaskCounts.set(instanceType, (unpricedTaskCounts.get(instanceType) ?? 0) + 1);
      continue;
    }
    total += (hourly * seconds) / 3600;
  }
  for (const [instanceType, taskCount] of unpricedTaskCounts) {
    console.warn(
      `No HealthOmics rate for instance type ${instanceType} in ${region}; ${taskCount} tasks of RunId=${runId ?? 'unknown'} added $0`,
    );
  }
  return Math.round(total * 10000) / 10000;
}

/**
 * Estimate HealthOmics run storage cost from GetRun fields.
 * STATIC: provisioned GiB × wall-clock hours × static rate
 * DYNAMIC: max GiB × wall-clock hours × ½ × dynamic rate (linear-growth approx)
 */
export function calculateHealthOmicsStorageCostUsd(
  run: OmicsRunStorageLike,
  region: string = DEFAULT_REGION,
  runId?: string,
  regionRates?: HealthOmicsRegionRates,
): number | undefined {
  const capacity = run.storageCapacity;
  if (capacity == null || capacity <= 0) return undefined;
  const startMs = toMs(run.startTime);
  const stopMs = toMs(run.stopTime);
  if (startMs == null || stopMs == null || stopMs < startMs) return undefined;

  const hours = (stopMs - startMs) / (1000 * 3600);
  if (hours <= 0) return undefined;

  const rates = (regionRates ?? resolveRegionRates(region, runId)).runStorageGbHourUsd;
  const storageType = (run.storageType || 'DYNAMIC').toUpperCase();

  let cost: number;
  if (storageType === 'STATIC') {
    cost = capacity * hours * rates.STATIC;
  } else {
    // Linear-growth approximation: average usage ≈ peak/2
    cost = capacity * hours * 0.5 * rates.DYNAMIC;
  }
  return Math.round(cost * 10000) / 10000;
}
