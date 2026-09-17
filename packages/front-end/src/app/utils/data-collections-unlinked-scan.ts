export type UnlinkedScanAction = 'use-cache' | 'await-in-flight' | 'fetch-blocking' | 'fetch-background';

/**
 * Decide whether to reuse a cached unlinked-file scan, join a request already
 * in flight, or start a new S3 walk. Callers must not start a second walk
 * while one is pending for the same lab — that is the scan this helper exists
 * to prevent.
 */
export function resolveUnlinkedScanAction(opts: {
  hasCache: boolean;
  isStale: boolean;
  force: boolean;
  requestInFlight: boolean;
}): UnlinkedScanAction {
  if (opts.requestInFlight) {
    return 'await-in-flight';
  }
  if (opts.force) {
    return 'fetch-blocking';
  }
  if (opts.hasCache && !opts.isStale) {
    return 'use-cache';
  }
  if (opts.hasCache && opts.isStale) {
    return 'fetch-background';
  }
  return 'fetch-blocking';
}
