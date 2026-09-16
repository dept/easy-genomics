import { resolveUnlinkedScanAction } from '../../../src/app/utils/data-collections-unlinked-scan';

describe('resolveUnlinkedScanAction', () => {
  it('joins an in-flight request even when a rescan is forced', () => {
    expect(resolveUnlinkedScanAction({ hasCache: false, isStale: true, force: true, requestInFlight: true })).toBe(
      'await-in-flight',
    );
    expect(resolveUnlinkedScanAction({ hasCache: true, isStale: false, force: false, requestInFlight: true })).toBe(
      'await-in-flight',
    );
  });

  it('blocks on a forced rescan when nothing is in flight', () => {
    expect(resolveUnlinkedScanAction({ hasCache: true, isStale: false, force: true, requestInFlight: false })).toBe(
      'fetch-blocking',
    );
  });

  it('reuses a fresh cache', () => {
    expect(resolveUnlinkedScanAction({ hasCache: true, isStale: false, force: false, requestInFlight: false })).toBe(
      'use-cache',
    );
  });

  it('refreshes a stale cache in the background', () => {
    expect(resolveUnlinkedScanAction({ hasCache: true, isStale: true, force: false, requestInFlight: false })).toBe(
      'fetch-background',
    );
  });

  it('blocks when there is no cache', () => {
    expect(resolveUnlinkedScanAction({ hasCache: false, isStale: true, force: false, requestInFlight: false })).toBe(
      'fetch-blocking',
    );
  });
});
