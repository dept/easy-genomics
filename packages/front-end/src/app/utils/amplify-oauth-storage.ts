const UNUSED_COGNITO_KEY_SUFFIXES = ['.userData'];

/**
 * Remove Cognito localStorage keys Amplify Auth no longer reads. `.userData`
 * holds profile attributes that sign-out does not clear. Do not include
 * `.clockDrift` — Amplify still writes and reads that key to correct token
 * expiry on clock-skewed machines.
 */
export function clearUnusedCognitoStorageKeys(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) {
    return;
  }

  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key && UNUSED_COGNITO_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix))) {
      storage.removeItem(key);
    }
  }
}
