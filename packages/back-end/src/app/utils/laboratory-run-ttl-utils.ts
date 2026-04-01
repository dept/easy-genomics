const DEFAULT_RETENTION_MONTHS = 6;

// Terminal workflow/run statuses for both supported backends:
// - AWS HealthOmics: COMPLETED, FAILED, CANCELLED, DELETED
// - Seqera NextFlow Tower: SUCCEEDED, FAILED, CANCELLED
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'DELETED',
  'ABORTED',
]);

export function isTerminalLaboratoryRunStatus(status: string | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status.toUpperCase());
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function calculateExpiresAtEpochSeconds(fromDate: Date, months: number = DEFAULT_RETENTION_MONTHS): number {
  const expiresDate = addMonths(fromDate, months);
  return Math.floor(expiresDate.getTime() / 1000); // DynamoDB TTL expects epoch seconds
}

export function parseIsoDateOrUndefined(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function getDefaultExpiresAtEpochSecondsForTerminalRun(run: {
  CreatedAt?: string;
  ModifiedAt?: string;
}): number {
  const terminalAt = parseIsoDateOrUndefined(run.ModifiedAt) ?? parseIsoDateOrUndefined(run.CreatedAt) ?? new Date();
  return calculateExpiresAtEpochSeconds(terminalAt, DEFAULT_RETENTION_MONTHS);
}

/**
 * Resolves the lab retention interval for TTL logic.
 * - `0` means never delete: callers should pair with {@link shouldExpireWithRetentionMonths}.
 * - Only `null`/`undefined` (missing policy) uses {@link DEFAULT_RETENTION_MONTHS}; numeric `0` is never treated as “falsy/missing”.
 * - Coerces numeric strings (e.g. JSON `"0"` / `"6"`) so `0` is not mistaken for invalid input.
 */
export function getRetentionMonthsOrDefault(runRetentionMonths: unknown): number {
  if (runRetentionMonths == null) return DEFAULT_RETENTION_MONTHS;
  if (runRetentionMonths === '') return DEFAULT_RETENTION_MONTHS;

  const n = typeof runRetentionMonths === 'number' ? runRetentionMonths : Number(runRetentionMonths);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_MONTHS;
  return Math.floor(n);
}

export function shouldExpireWithRetentionMonths(retentionMonths: number): boolean {
  // 0 means "never delete"
  return retentionMonths > 0;
}

export function getTerminalAtIsoString(
  existing: { TerminalAt?: string; ModifiedAt?: string; CreatedAt?: string },
  now: Date,
): string {
  const explicit = parseIsoDateOrUndefined(existing.TerminalAt);
  if (explicit) return explicit.toISOString();
  const inferred = parseIsoDateOrUndefined(existing.ModifiedAt) ?? parseIsoDateOrUndefined(existing.CreatedAt);
  return (inferred ?? now).toISOString();
}
