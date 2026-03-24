import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/list-laboratory-runs.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-run-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/utils/auth-utils');
jest.mock('../../../../../../src/app/utils/rest-api-utils');

import { LaboratoryRunService } from '../../../../../../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';
import { getFilterResults, getFilters } from '../../../../../../src/app/utils/rest-api-utils';

describe('list-laboratory-runs.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';

  let mockRunService: jest.MockedClass<typeof LaboratoryRunService>;
  let mockLabService: jest.MockedClass<typeof LaboratoryService>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;

  let mockQueryByLaboratoryIdForLab: jest.Mock;
  let mockQueryByLaboratoryIdForRuns: jest.Mock;
  let mockQueryByLaboratoryIdPaginatedForRuns: jest.Mock;

  const createEvent = (
    query: Record<string, string | undefined>,
    overrides: Partial<APIGatewayProxyWithCognitoAuthorizerEvent> = {},
  ) =>
    ({
      body: null,
      isBase64Encoded: false,
      httpMethod: 'GET',
      path: '/laboratory/run/list',
      headers: {},
      requestContext: {
        authorizer: {
          claims: {
            email: 'user@example.com',
          },
        },
      },
      resource: '',
      queryStringParameters: query as any,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
      ...overrides,
    }) as any;

  const createContext = (): Context =>
    ({
      functionName: 'list-laboratory-runs',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:region:acct:function:list-laboratory-runs',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/list-laboratory-runs',
      logStreamName: '2026/03/11/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunService = LaboratoryRunService as jest.MockedClass<typeof LaboratoryRunService>;
    mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as any;
    mockValidateLabManager = validateLaboratoryManagerAccess as any;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as any;

    mockQueryByLaboratoryIdForLab = jest.fn();
    mockQueryByLaboratoryIdForRuns = jest.fn();
    mockQueryByLaboratoryIdPaginatedForRuns = jest.fn();
    mockLabService.prototype.queryByLaboratoryId = mockQueryByLaboratoryIdForLab;
    mockRunService.prototype.queryByLaboratoryId = mockQueryByLaboratoryIdForRuns;
    mockRunService.prototype.queryByLaboratoryIdPaginated = mockQueryByLaboratoryIdPaginatedForRuns;

    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    // Default filter behaviour: no-op and return original runs
    (getFilters as jest.Mock).mockReturnValue([]);
    (getFilterResults as jest.Mock).mockImplementation((runs: any[]) => runs);
  });

  afterEach(() => {
    delete process.env.ENV_TYPE;
    delete process.env.NODE_ENV;
  });

  it('returns 400 when LaboratoryId query parameter is missing', async () => {
    const result = await handler(createEvent({}), createContext(), () => {});

    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when laboratory is not found', async () => {
    mockQueryByLaboratoryIdForLab.mockResolvedValue(undefined);

    const result = await handler(createEvent({ LaboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(404);
  });

  it('denies access when caller is not org admin or lab manager/technician', async () => {
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const result = await handler(createEvent({ LaboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(403);
  });

  it('lists runs for owned laboratory without filters', async () => {
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });
    mockQueryByLaboratoryIdForRuns.mockResolvedValue([
      { RunId: 'run-1', LaboratoryId: LAB_ID, OrganizationId: 'org-1', Settings: '{}' },
    ]);

    const result = await handler(createEvent({ LaboratoryId: LAB_ID }), createContext(), () => {});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].RunId).toBe('run-1');
    expect(body[0].Settings).toEqual({});
  });

  it('applies filters from query parameters safely', async () => {
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });
    const runs = [
      { RunId: 'run-1', LaboratoryId: LAB_ID, OrganizationId: 'org-1', Status: 'RUNNING', Settings: '{}' },
      { RunId: 'run-2', LaboratoryId: LAB_ID, OrganizationId: 'org-1', Status: 'FAILED', Settings: '{}' },
    ];
    mockQueryByLaboratoryIdForRuns.mockResolvedValue(runs);

    // For this test, ensure filters are applied and results are returned without error
    (getFilters as jest.Mock).mockReturnValue([['Status', 'FAILED']]);
    (getFilterResults as jest.Mock).mockImplementation((allRuns: any[], filters: [string, string][]) =>
      allRuns.filter((r) => filters.some(([field, value]) => r[field] === value)),
    );

    const result = await handler(
      createEvent({
        LaboratoryId: LAB_ID,
        Status: 'FAILED',
        UnknownParam: 'ignored',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].Status).toBe('FAILED');
    expect(getFilters).toHaveBeenCalled();
    expect(getFilterResults).toHaveBeenCalled();
  });

  it('returns paginated payload in server mode for non-dev environments', async () => {
    process.env.ENV_TYPE = 'prod';
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });
    mockQueryByLaboratoryIdPaginatedForRuns.mockResolvedValue({
      items: [{ RunId: 'run-1', LaboratoryId: LAB_ID, OrganizationId: 'org-1', Settings: '{}' }],
      lastEvaluatedKey: { LaboratoryId: { S: LAB_ID }, RunId: { S: 'run-2' } },
    });

    const result = await handler(
      createEvent({
        LaboratoryId: LAB_ID,
        serverMode: 'true',
        limit: '10',
        sortBy: 'CreatedAt',
        sortDirection: 'desc',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(typeof body.nextToken).toBe('string');
    expect(mockQueryByLaboratoryIdPaginatedForRuns).toHaveBeenCalled();
  });

  it('returns 400 for unsupported server mode sortBy value', async () => {
    process.env.ENV_TYPE = 'prod';
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent({
        LaboratoryId: LAB_ID,
        serverMode: 'true',
        sortBy: 'Owner',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockQueryByLaboratoryIdPaginatedForRuns).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid server mode search field', async () => {
    process.env.ENV_TYPE = 'prod';
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });

    const result = await handler(
      createEvent({
        LaboratoryId: LAB_ID,
        serverMode: 'true',
        search: '"owner"=user@example.com',
      }),
      createContext(),
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockQueryByLaboratoryIdPaginatedForRuns).not.toHaveBeenCalled();
  });

  it('uses local/dev mock mode and paginates synthetic data', async () => {
    process.env.ENV_TYPE = 'dev';
    mockQueryByLaboratoryIdForLab.mockResolvedValue({
      OrganizationId: 'org-1',
      LaboratoryId: LAB_ID,
    });
    mockQueryByLaboratoryIdForRuns.mockResolvedValue([]);

    const firstPageResult = await handler(
      createEvent({
        LaboratoryId: LAB_ID,
        serverMode: 'true',
        limit: '10',
        sortBy: 'CreatedAt',
      }),
      createContext(),
      () => {},
    );

    expect(firstPageResult.statusCode).toBe(200);
    const firstPageBody = JSON.parse(firstPageResult.body);
    expect(firstPageBody.items).toHaveLength(10);
    expect(firstPageBody.hasMore).toBe(true);
    expect(typeof firstPageBody.nextToken).toBe('string');
    expect(mockQueryByLaboratoryIdPaginatedForRuns).not.toHaveBeenCalled();

    const omicsMock = firstPageBody.items.find((r: { Platform?: string }) => r.Platform === 'AWS HealthOmics');
    expect(omicsMock).toBeDefined();
    expect(omicsMock.WorkflowVersionName).toMatch(/^mock-omics-v\d+$/);

    const seqeraMock = firstPageBody.items.find((r: { Platform?: string }) => r.Platform === 'Seqera Cloud');
    expect(seqeraMock).toBeDefined();
    expect(seqeraMock.WorkflowVersionName).toBeUndefined();

    const secondPageResult = await handler(
      createEvent({
        LaboratoryId: LAB_ID,
        serverMode: 'true',
        limit: '10',
        sortBy: 'CreatedAt',
        nextToken: firstPageBody.nextToken,
      }),
      createContext(),
      () => {},
    );

    expect(secondPageResult.statusCode).toBe(200);
    const secondPageBody = JSON.parse(secondPageResult.body);
    expect(secondPageBody.items).toHaveLength(10);
    expect(secondPageBody.items[0].RunId).not.toBe(firstPageBody.items[0].RunId);
  });
});
