const INFLIGHT_SUFFIXES = ['.inflightOAuth', '.inflightOAuthDeadline'];
const V5_ONLY_SUFFIXES = ['.userData', '.clockDrift'];

function storageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

function removeKeysEndingWith(storage: Storage, suffixes: string[]): void {
  for (const key of storageKeys(storage)) {
    if (suffixes.some((suffix) => key.endsWith(suffix))) {
      storage.removeItem(key);
    }
  }
}

/**
 * Drop Amplify's inflight-OAuth marker so fetchAuthSession does not park for
 * OAUTH_INFLIGHT_TTL_MS (5 minutes) after an abandoned hosted-UI attempt.
 */
export function clearInflightOAuthStorage(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) {
    return;
  }
  removeKeysEndingWith(storage, INFLIGHT_SUFFIXES);
}

/**
 * Remove v5-only Cognito keys that v6 never reads. v6 sessions use different
 * storage entries; leftover v5 tokens otherwise sit in localStorage until the
 * refresh token expires (~30 days) even after sign-out.
 */
export function clearLegacyAmplifyV5Storage(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) {
    return;
  }
  removeKeysEndingWith(storage, V5_ONLY_SUFFIXES);
}

export function isOAuthReturnUrl(url: URL): boolean {
  return url.searchParams.has('code') && url.searchParams.has('state');
}

/**
 * If this navigation is not completing an OAuth redirect, drop the inflight
 * marker so the route guard cannot hang on waitForInflightOAuth.
 */
export function clearAbandonedOAuthInflight(url: URL, storage: Storage | undefined = globalThis.localStorage): void {
  if (isOAuthReturnUrl(url) || url.pathname === '/auth/callback') {
    return;
  }
  clearInflightOAuthStorage(storage);
}
