import { createHash } from 'crypto';
import type { RunInputProfile } from '../schema/easy-genomics/laboratory-run-cost';

export type CostEstimateConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type HistoricalRunCostCandidate = {
  ActualComputeCostUsd: number;
  SampleCount?: number;
  InputBytesTotal?: number;
  WorkflowVersionName?: string;
  ParameterHash?: string;
  TerminalAt?: string;
};

export type CostEstimateBand = {
  estimateAvailable: boolean;
  confidence: CostEstimateConfidence;
  comparableRunCount: number;
  computeCostUsd?: { low: number; median: number; high: number };
};

const DEFAULT_EXCLUSIONS = ['S3', 'DATA_TRANSFER', 'RUN_STORAGE'];

/**
 * Canonical SHA-256 of Settings JSON for similarity matching.
 * Keys are sorted recursively so equivalent objects hash identically.
 */
export function hashRunSettings(settings: unknown): string {
  const canonical = canonicalizeJson(settings ?? {});
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`).join(',')}}`;
}

/**
 * Lower score = closer match. Weights from spike Addendum B.
 */
export function similarityScore(
  profile: Pick<RunInputProfile, 'SampleCount' | 'InputBytesTotal' | 'ParameterHash'> & {
    WorkflowVersionName?: string;
  },
  candidate: HistoricalRunCostCandidate,
): number {
  const sampleScore = logRatioScore(profile.SampleCount, candidate.SampleCount ?? 0) * 0.4;
  const bytesScore = logRatioScore(profile.InputBytesTotal, candidate.InputBytesTotal ?? 0) * 0.3;
  const versionScore = (profile.WorkflowVersionName || '') === (candidate.WorkflowVersionName || '') ? 0 : 1;
  const paramScore = parameterHashScore(profile.ParameterHash, candidate.ParameterHash);
  return sampleScore + bytesScore + versionScore * 0.2 + paramScore * 0.1;
}

function logRatioScore(a: number, b: number): number {
  const aa = Math.max(a, 1);
  const bb = Math.max(b, 1);
  return Math.min(Math.abs(Math.log2(aa / bb)), 2.0);
}

function parameterHashScore(a?: string, b?: string): number {
  if (!a || !b) return 1;
  if (a === b) return 0;
  return 0.5;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/**
 * k-NN percentile band estimator for pre-run compute cost.
 */
export function estimateComputeCostBand(
  profile: Pick<RunInputProfile, 'SampleCount' | 'InputBytesTotal' | 'ParameterHash'> & {
    WorkflowVersionName?: string;
  },
  candidates: HistoricalRunCostCandidate[],
  options?: { k?: number; maxScore?: number; maxAgeDays?: number },
): CostEstimateBand {
  const k = options?.k ?? 10;
  const maxScore = options?.maxScore ?? 1.5;
  const maxAgeDays = options?.maxAgeDays ?? 180;
  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;

  const scored = candidates
    .filter((c) => c.ActualComputeCostUsd != null && c.ActualComputeCostUsd >= 0)
    .filter((c) => {
      if (!c.TerminalAt) return true;
      const t = new Date(c.TerminalAt).getTime();
      return Number.isFinite(t) ? t >= cutoff : true;
    })
    .map((c) => ({ candidate: c, score: similarityScore(profile, c) }))
    .filter((s) => s.score <= maxScore)
    .sort((a, b) => a.score - b.score)
    .slice(0, k);

  const comparableRunCount = scored.length;
  if (comparableRunCount < 3) {
    return {
      estimateAvailable: false,
      confidence: 'NONE',
      comparableRunCount,
    };
  }

  const costs = scored.map((s) => s.candidate.ActualComputeCostUsd).sort((a, b) => a - b);
  const low = Math.round(percentile(costs, 25) * 100) / 100;
  const median = Math.round(percentile(costs, 50) * 100) / 100;
  const high = Math.round(percentile(costs, 75) * 100) / 100;
  const spread = median > 0 ? (high - low) / median : 1;
  const sameVersion =
    scored.filter((s) => (s.candidate.WorkflowVersionName || '') === (profile.WorkflowVersionName || '')).length ===
    scored.length;

  let confidence: CostEstimateConfidence;
  if (comparableRunCount >= 7 && spread <= 0.3 && sameVersion) {
    confidence = 'HIGH';
  } else if (comparableRunCount >= 3 && spread <= 0.5) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return {
    estimateAvailable: true,
    confidence,
    comparableRunCount,
    computeCostUsd: { low, median, high },
  };
}

export function defaultCostExclusions(): string[] {
  return [...DEFAULT_EXCLUSIONS];
}

/**
 * Count sample rows in a CSV sample sheet (excludes header).
 */
export function countSamplesInSampleSheetCsv(csv: string): number {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length <= 1) return 0;
  return lines.length - 1;
}
