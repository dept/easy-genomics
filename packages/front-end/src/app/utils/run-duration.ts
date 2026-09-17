const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/**
 * Renders a run's wall-clock duration for display, e.g. `6m 27s` or `1h 5m`.
 *
 * Seconds are dropped once the run reaches an hour: at that scale they are
 * noise, and the run list needs the value to stay narrow enough to scan.
 *
 * Returns null when the run has no recorded duration — runs that terminated
 * before the field existed, and runs still in flight — so callers can choose
 * their own empty state rather than showing a misleading `0s`.
 */
export function formatRunDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  const total = Math.round(seconds);

  if (total < SECONDS_PER_MINUTE) return `${total}s`;

  if (total < SECONDS_PER_HOUR) {
    const minutes = Math.floor(total / SECONDS_PER_MINUTE);
    const remainder = total % SECONDS_PER_MINUTE;
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  }

  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
