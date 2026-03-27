const DEFAULT_RETENTION_MONTHS = 0;

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

export function getRetentionMonthsOrDefault(runRetentionMonths: number | undefined): number {
  if (runRetentionMonths == null) return DEFAULT_RETENTION_MONTHS;
  if (!Number.isFinite(runRetentionMonths) || runRetentionMonths < 0) return DEFAULT_RETENTION_MONTHS;
  return Math.floor(runRetentionMonths);
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
