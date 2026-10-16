const mockGetToken = jest.fn();
const mockGetRefreshedToken = jest.fn();
const mockSetCurrentUserDataFromToken = jest.fn();
const mockIncrementRemountAppKey = jest.fn();

(global as { useAuth?: () => unknown }).useAuth = () => ({
  getToken: mockGetToken,
  getRefreshedToken: mockGetRefreshedToken,
});
(global as { useUser?: () => unknown }).useUser = () => ({
  setCurrentUserDataFromToken: mockSetCurrentUserDataFromToken,
});
(global as { useUiStore?: () => unknown }).useUiStore = () => ({
  incrementRemountAppKey: mockIncrementRemountAppKey,
});

jest.mock('nuxt/app', () => ({
  useRuntimeConfig: () => ({
    public: {
      BASE_API_URL: 'https://api.example.com',
      EASY_GENOMICS_API_URL: '',
    },
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function eg110Response(): Response {
  return jsonResponse({ Error: 'token expired', ErrorCode: 'EG-110' }, 401);
}

function authHeader(call: [unknown, RequestInit]): string | null {
  return (call[1].headers as Headers).get('Authorization');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('timed out waiting for condition');
}

describe('HttpFactory EG-110 refresh', () => {
  let HttpFactory: typeof import('../../../src/app/repository/factory').default;
  let factoryA: InstanceType<typeof HttpFactory>;
  let factoryB: InstanceType<typeof HttpFactory>;

  beforeAll(async () => {
    HttpFactory = (await import('../../../src/app/repository/factory')).default;
  });

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetToken.mockReset().mockResolvedValue('stale-jwt');
    mockGetRefreshedToken.mockReset().mockResolvedValue('fresh-jwt');
    mockSetCurrentUserDataFromToken.mockReset().mockResolvedValue(undefined);
    mockIncrementRemountAppKey.mockReset();
    factoryA = new HttpFactory();
    factoryB = new HttpFactory();
  });

  it('retries once with a refreshed token after EG-110', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(eg110Response())
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    global.fetch = fetchMock;

    await expect(factoryA.call('GET', '/widgets')).resolves.toEqual({ ok: true });

    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetRefreshedToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(fetchMock.mock.calls[0] as [unknown, RequestInit])).toBe('Bearer stale-jwt');
    expect(authHeader(fetchMock.mock.calls[1] as [unknown, RequestInit])).toBe('Bearer fresh-jwt');
  });

  it('shares one refresh across concurrent EG-110 retries from different factory instances', async () => {
    let releaseRefresh: (token: string) => void = () => undefined;
    mockGetRefreshedToken.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          releaseRefresh = resolve;
        }),
    );

    const fetchMock = jest.fn().mockImplementation(async (_url: string, settings: RequestInit) => {
      const auth = (settings.headers as Headers).get('Authorization');
      if (auth === 'Bearer stale-jwt') {
        return eg110Response();
      }
      return jsonResponse({ ok: true });
    });
    global.fetch = fetchMock;

    const first = factoryA.call('GET', '/a');
    const second = factoryB.call('GET', '/b');

    await waitFor(() => mockGetRefreshedToken.mock.calls.length === 1);
    expect(mockGetRefreshedToken).toHaveBeenCalledTimes(1);

    releaseRefresh('fresh-jwt');

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(mockGetRefreshedToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map((call) => authHeader(call as [unknown, RequestInit]))).toEqual([
      'Bearer stale-jwt',
      'Bearer stale-jwt',
      'Bearer fresh-jwt',
      'Bearer fresh-jwt',
    ]);
  });

  it('propagates a rejected refresh instead of retrying forever', async () => {
    mockGetRefreshedToken.mockRejectedValue(new Error('No ID token after refresh'));
    global.fetch = jest.fn().mockResolvedValue(eg110Response());

    await expect(factoryA.call('GET', '/widgets')).rejects.toThrow('No ID token after refresh');
    expect(mockGetRefreshedToken).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
