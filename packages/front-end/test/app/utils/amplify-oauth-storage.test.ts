import { clearUnusedCognitoStorageKeys } from '../../../src/app/utils/amplify-oauth-storage';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('clearUnusedCognitoStorageKeys', () => {
  it('removes leftover userData keys and leaves live Amplify token keys', () => {
    const storage = memoryStorage({
      'CognitoIdentityServiceProvider.abc.user-1.userData': '{}',
      'CognitoIdentityServiceProvider.abc.user-1.clockDrift': '12',
      'CognitoIdentityServiceProvider.abc.user-1.idToken': 'keep',
      'CognitoIdentityServiceProvider.abc.inflightOAuth': 'true',
    });

    clearUnusedCognitoStorageKeys(storage);

    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.userData')).toBeNull();
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.clockDrift')).toBe('12');
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.idToken')).toBe('keep');
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.inflightOAuth')).toBe('true');
  });

  it('returns without throwing when storage is missing', () => {
    expect(() => clearUnusedCognitoStorageKeys(undefined)).not.toThrow();
  });
});
