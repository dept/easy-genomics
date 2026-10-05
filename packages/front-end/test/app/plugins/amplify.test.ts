import { Amplify } from 'aws-amplify';
import { buildAmplifyAuthConfig } from '@FE/utils/amplify-auth-config';
import { clearUnusedCognitoStorageKeys } from '@FE/utils/amplify-oauth-storage';

(global as { defineNuxtPlugin?: (plugin: () => void) => () => void }).defineNuxtPlugin = (plugin) => plugin;

jest.mock('aws-amplify', () => ({
  Amplify: {
    configure: jest.fn(() => {
      (globalThis as { __amplifySeq?: number; __configureSeq?: number }).__amplifySeq =
        ((globalThis as { __amplifySeq?: number }).__amplifySeq ?? 0) + 1;
      (globalThis as { __configureSeq?: number }).__configureSeq = (
        globalThis as { __amplifySeq?: number }
      ).__amplifySeq;
    }),
  },
}));

jest.mock('aws-amplify/auth/enable-oauth-listener', () => {
  (globalThis as { __amplifySeq?: number; __listenerSeq?: number }).__amplifySeq =
    ((globalThis as { __amplifySeq?: number }).__amplifySeq ?? 0) + 1;
  (globalThis as { __listenerSeq?: number }).__listenerSeq = (globalThis as { __amplifySeq?: number }).__amplifySeq;
  return {};
});

jest.mock('nuxt/app', () => ({
  useRuntimeConfig: () => ({
    public: {
      AWS_REGION: 'ap-southeast-2',
      AWS_USER_POOL_ID: 'ap-southeast-2_abc',
      AWS_CLIENT_ID: 'client-id',
    },
  }),
}));

jest.mock('@FE/utils/amplify-auth-config', () => ({
  buildAmplifyAuthConfig: jest.fn((config: unknown) => ({ Auth: { Cognito: config } })),
}));

jest.mock('@FE/utils/amplify-oauth-storage', () => ({
  clearUnusedCognitoStorageKeys: jest.fn(),
}));

const mockConfigure = Amplify.configure as jest.Mock;
const mockBuildConfig = buildAmplifyAuthConfig as jest.Mock;
const mockClearUnused = clearUnusedCognitoStorageKeys as jest.Mock;

describe('amplify plugin', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(global, 'window');
  let amplifyPlugin: () => void;

  beforeAll(async () => {
    amplifyPlugin = (await import('../../../src/app/plugins/amplify')).default;
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(global, 'window', originalWindowDescriptor);
    } else {
      delete (global as { window?: unknown }).window;
    }
    mockConfigure.mockClear();
    mockClearUnused.mockClear();
    mockBuildConfig.mockClear();
  });

  it('loads the OAuth listener before Amplify.configure and applies the built config', () => {
    Object.defineProperty(global, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });
    const listenerSeq = (globalThis as { __listenerSeq?: number }).__listenerSeq;
    expect(listenerSeq).toEqual(expect.any(Number));

    amplifyPlugin();

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(listenerSeq).toBeLessThan((globalThis as { __configureSeq?: number }).__configureSeq as number);
    expect(mockBuildConfig).toHaveBeenCalledWith({
      AWS_REGION: 'ap-southeast-2',
      AWS_USER_POOL_ID: 'ap-southeast-2_abc',
      AWS_CLIENT_ID: 'client-id',
    });
    expect(mockConfigure).toHaveBeenCalledWith({
      Auth: {
        Cognito: {
          AWS_REGION: 'ap-southeast-2',
          AWS_USER_POOL_ID: 'ap-southeast-2_abc',
          AWS_CLIENT_ID: 'client-id',
        },
      },
    });
    expect(mockClearUnused).toHaveBeenCalledTimes(1);
  });

  it('skips unused-key cleanup when window is undefined', () => {
    Object.defineProperty(global, 'window', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    amplifyPlugin();

    expect(mockClearUnused).not.toHaveBeenCalled();
    expect(mockConfigure).toHaveBeenCalledTimes(1);
  });
});
