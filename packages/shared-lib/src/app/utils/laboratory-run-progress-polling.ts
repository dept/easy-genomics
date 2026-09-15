export const DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS = 120;
export const MIN_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS = 30;
export const MAX_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS = 1800;

export const DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS = 30;
export const MIN_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS = 10;
export const MAX_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS = 300;

function getWholeNumberOrDefault(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (value == null || value === '') return defaultValue;

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;

  const whole = Math.floor(parsed);
  if (whole < minimum || whole > maximum) return defaultValue;

  return whole;
}

export function getRunListStatusPollIntervalSecondsOrDefault(value: unknown): number {
  return getWholeNumberOrDefault(
    value,
    DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
    MIN_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
    MAX_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
  );
}

export function getRunDetailProgressPollIntervalSecondsOrDefault(value: unknown): number {
  return getWholeNumberOrDefault(
    value,
    DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
    MIN_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
    MAX_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
  );
}

export function getRunListStatusPollIntervalMs(value: unknown): number {
  return getRunListStatusPollIntervalSecondsOrDefault(value) * 1000;
}

export function getRunDetailProgressPollIntervalMs(value: unknown): number {
  return getRunDetailProgressPollIntervalSecondsOrDefault(value) * 1000;
}
