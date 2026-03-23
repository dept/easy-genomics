const mockCall = jest.fn();
const mockValidateApiResponse = jest.fn();

jest.mock(
  'nuxt/app',
  () => ({
    useRuntimeConfig: () => ({
      public: {
        BASE_API_URL: 'http://localhost:3001',
      },
    }),
  }),
  { virtual: true },
);

jest.mock(
  '@FE/repository/factory',
  () => {
    return {
      __esModule: true,
      default: class MockHttpFactory {
        call = mockCall;
      },
    };
  },
  { virtual: true },
);

jest.mock(
  '@FE/utils/api-utils',
  () => {
    return {
      validateApiResponse: mockValidateApiResponse,
    };
  },
  { virtual: true },
);

describe('LabsModule.listLabRunsPaginated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).useAuth = () => ({
      getToken: jest.fn().mockResolvedValue('token'),
      getRefreshedToken: jest.fn().mockResolvedValue('token'),
    });
  });

  it('builds paginated query string and returns response', async () => {
    const { default: LabsModule } = await import('../../../../src/app/repository/modules/labs');
    mockCall.mockResolvedValue({
      items: [],
      hasMore: true,
      nextToken: 'abc-token',
    });

    const module = new LabsModule();
    const response = await module.listLabRunsPaginated('lab-123', {
      limit: 10,
      nextToken: 'cursor-token',
      sortBy: 'CreatedAt',
      sortDirection: 'desc',
      filters: {
        UserId: 'user-1',
        search: '"status"=completed',
      },
    });

    expect(response.hasMore).toBe(true);
    expect(mockCall).toHaveBeenCalledWith('GET', expect.stringContaining('/laboratory/run/list-laboratory-runs?'));

    const calledUrl = mockCall.mock.calls[0][1] as string;
    expect(calledUrl).toContain('LaboratoryId=lab-123');
    expect(calledUrl).toContain('serverMode=true');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('nextToken=cursor-token');
    expect(calledUrl).toContain('sortBy=CreatedAt');
    expect(calledUrl).toContain('sortDirection=desc');
    expect(calledUrl).toContain('UserId=user-1');
    expect(calledUrl).toContain('search=%22status%22%3Dcompleted');
  });

  it('throws when API returns empty response', async () => {
    const { default: LabsModule } = await import('../../../../src/app/repository/modules/labs');
    mockCall.mockResolvedValue(undefined);

    const module = new LabsModule();
    await expect(module.listLabRunsPaginated('lab-123')).rejects.toThrow(
      'Failed to retrieve paginated Laboratory runs',
    );
  });
});
