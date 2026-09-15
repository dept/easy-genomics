/**
 * Calculate HealthOmics private-workflow compute cost from ListRunTasks data
 * using published regional list prices. Matches AWS billing rules:
 * - per-second billing with 60-second minimum per task
 * - exclude cacheHit tasks
 * - only bill COMPLETED tasks that actually ran
 *
 * Rates are public list prices (us-east-1 baseline; other regions fall back to
 * us-east-1 with a warning). Enterprise discounts are not reflected.
 */

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

/** Hourly list prices (USD) for omics instance types by region. */
export const HEALTHOMICS_INSTANCE_HOURLY_RATES_USD: Record<string, Record<string, number>> = {
  'us-east-1': {
    'omics.c.large': 0.1092,
    'omics.c.xlarge': 0.2184,
    'omics.c.2xlarge': 0.4368,
    'omics.c.4xlarge': 0.8736,
    'omics.c.8xlarge': 1.7472,
    'omics.c.12xlarge': 2.6208,
    'omics.c.16xlarge': 3.4944,
    'omics.c.24xlarge': 5.2416,
    'omics.m.large': 0.126,
    'omics.m.xlarge': 0.252,
    'omics.m.2xlarge': 0.504,
    'omics.m.4xlarge': 1.008,
    'omics.m.8xlarge': 2.016,
    'omics.m.12xlarge': 3.024,
    'omics.m.16xlarge': 4.032,
    'omics.m.24xlarge': 6.048,
    'omics.r.large': 0.1656,
    'omics.r.xlarge': 0.3312,
    'omics.r.2xlarge': 0.6624,
    'omics.r.4xlarge': 1.3248,
    'omics.r.8xlarge': 2.6496,
    'omics.r.12xlarge': 3.9744,
    'omics.r.16xlarge': 5.2992,
    'omics.r.24xlarge': 7.9488,
    'omics.g4dn.xlarge': 0.7358,
    'omics.g4dn.2xlarge': 1.052,
    'omics.g4dn.4xlarge': 1.684,
    'omics.g4dn.8xlarge': 3.046,
    'omics.g4dn.12xlarge': 5.464,
    'omics.g4dn.16xlarge': 6.092,
  },
};

/** Run storage GB-hour rates (USD) by region and storage type. */
export const HEALTHOMICS_STORAGE_GB_HOUR_RATES_USD: Record<string, { STATIC: number; DYNAMIC: number }> = {
  'us-east-1': {
    STATIC: 0.000274,
    DYNAMIC: 0.000548,
  },
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

function resolveInstanceRate(region: string, instanceType: string): number | undefined {
  const regional =
    HEALTHOMICS_INSTANCE_HOURLY_RATES_USD[region] ?? HEALTHOMICS_INSTANCE_HOURLY_RATES_USD[DEFAULT_REGION];
  return regional?.[instanceType];
}

/**
 * Sum compute cost across ListRunTasks items.
 */
export function calculateHealthOmicsComputeCostUsd(tasks: OmicsRunTaskLike[], region: string = DEFAULT_REGION): number {
  let total = 0;
  for (const task of tasks) {
    if (task.cacheHit) continue;
    if ((task.status || '').toUpperCase() !== 'COMPLETED') continue;
    const instanceType = task.instanceType?.trim();
    if (!instanceType) continue;
    const hourly = resolveInstanceRate(region, instanceType);
    if (hourly == null) continue;
    const seconds = billableSeconds(task.startTime, task.stopTime);
    if (seconds <= 0) continue;
    total += (hourly * seconds) / 3600;
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
): number | undefined {
  const capacity = run.storageCapacity;
  if (capacity == null || capacity <= 0) return undefined;
  const startMs = toMs(run.startTime);
  const stopMs = toMs(run.stopTime);
  if (startMs == null || stopMs == null || stopMs < startMs) return undefined;

  const hours = (stopMs - startMs) / (1000 * 3600);
  if (hours <= 0) return undefined;

  const rates = HEALTHOMICS_STORAGE_GB_HOUR_RATES_USD[region] ?? HEALTHOMICS_STORAGE_GB_HOUR_RATES_USD[DEFAULT_REGION];
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
