import {
  clearAbandonedOAuthInflight,
  clearInflightOAuthStorage,
  clearLegacyAmplifyV5Storage,
} from '../../../src/app/utils/amplify-oauth-storage';

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

describe('amplify oauth storage helpers', () => {
  it('clears inflight OAuth markers', () => {
    const storage = memoryStorage({
      'CognitoIdentityServiceProvider.abc.inflightOAuth': 'true',
      'CognitoIdentityServiceProvider.abc.inflightOAuthDeadline': '123',
      'CognitoIdentityServiceProvider.abc.user-1.idToken': 'keep',
    });

    clearInflightOAuthStorage(storage);

    expect(storage.getItem('CognitoIdentityServiceProvider.abc.inflightOAuth')).toBeNull();
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.inflightOAuthDeadline')).toBeNull();
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.idToken')).toBe('keep');
  });

  it('does not clear inflight markers on an OAuth return URL', () => {
    const storage = memoryStorage({
      'CognitoIdentityServiceProvider.abc.inflightOAuth': 'true',
    });
    const url = new URL('https://app.example.com/auth/callback?code=x&state=y');

    clearAbandonedOAuthInflight(url, storage);

    expect(storage.getItem('CognitoIdentityServiceProvider.abc.inflightOAuth')).toBe('true');
  });

  it('clears inflight markers on /signin after an abandoned hosted-UI attempt', () => {
    const storage = memoryStorage({
      'CognitoIdentityServiceProvider.abc.inflightOAuth': 'true',
    });
    const url = new URL('https://app.example.com/signin');

    clearAbandonedOAuthInflight(url, storage);

    expect(storage.getItem('CognitoIdentityServiceProvider.abc.inflightOAuth')).toBeNull();
  });

  it('removes v5-only userData and clockDrift keys', () => {
    const storage = memoryStorage({
      'CognitoIdentityServiceProvider.abc.user-1.userData': '{}',
      'CognitoIdentityServiceProvider.abc.user-1.clockDrift': '0',
      'CognitoIdentityServiceProvider.abc.user-1.idToken': 'keep',
    });

    clearLegacyAmplifyV5Storage(storage);

    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.userData')).toBeNull();
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.clockDrift')).toBeNull();
    expect(storage.getItem('CognitoIdentityServiceProvider.abc.user-1.idToken')).toBe('keep');
  });
});
