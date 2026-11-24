import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockGetReport = jest.fn();
jest.mock('../../../../../src/app/services/easy-genomics/run-costs-report-service', () => ({
  RunCostsReportService: jest.fn().mockImplementation(() => ({
    getReport: (...args: unknown[]) => mockGetReport(...args),
  })),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/usage/list-run-costs.lambda';

describe('list-run-costs.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000009';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const report = {
    Period: { Start: '2026-10-12', End: '2026-11-10' },
    PreviousPeriod: { Start: '2026-09-12', End: '2026-10-11' },
    Totals: { EstimatedCostUsd: 0, FinishedRuns: 0, WarnedRuns: 0, BlockedLaunches: 0 },
    PreviousTotals: { EstimatedCostUsd: 0, FinishedRuns: 0, WarnedRuns: 0, BlockedLaunches: 0 },
    Labs: [],
  };

  const organizationAdminOf = (organizationId: string) => ({
    OrganizationAccess: JSON.stringify({
      [organizationId]: { Status: 'Active', OrganizationAdmin: true, LaboratoryAccess: {} },
    }),
  });
  const labMemberOf = (role: 'LabManager' | 'LabTechnician') => ({
    OrganizationAccess: JSON.stringify({
      [ORG_ID]: {
        Status: 'Active',
        OrganizationAdmin: false,
        LaboratoryAccess: {
          [LAB_ID]: { Status: 'Active', LabManager: role === 'LabManager', LabTechnician: role === 'LabTechnician' },
        },
      },
    }),
  });
  const systemAdmin = { 'cognito:groups': 'SystemAdmin' };

  const invoke = (queryStringParameters: Record<string, string> | null, claims: Record<string, unknown>) =>
    handler(
      {
        httpMethod: 'GET',
        headers: {},
        queryStringParameters,
        requestContext: { authorizer: { claims: { 'cognito:username': 'user-1', ...claims } } },
      } as unknown as APIGatewayProxyWithCognitoAuthorizerEvent,
      {} as Context,
      () => {},
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetReport.mockResolvedValue(report);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the report to an organization admin, for the parsed query and today', async () => {
    const before = Date.now();

    const result = await invoke({ organizationId: ORG_ID, period: '30d' }, organizationAdminOf(ORG_ID));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(report);
    expect(mockGetReport).toHaveBeenCalledWith({ organizationId: ORG_ID, period: '30d' }, expect.any(Date));
    expect(mockGetReport.mock.calls[0][1].getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns a calendar month to a system admin', async () => {
    const result = await invoke({ organizationId: ORG_ID, period: 'month', month: '2026-03' }, systemAdmin);

    expect(result.statusCode).toBe(200);
    expect(mockGetReport).toHaveBeenCalledWith(
      { organizationId: ORG_ID, period: 'month', month: '2026-03' },
      expect.any(Date),
    );
  });

  it.each([
    ['an organization admin of another organization', organizationAdminOf(OTHER_ORG_ID)],
    ['a lab manager', labMemberOf('LabManager')],
    ['a lab technician', labMemberOf('LabTechnician')],
  ])('returns 403 to %s', async (_caller, claims) => {
    const result = await invoke({ organizationId: ORG_ID, period: '30d' }, claims);

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-103');
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it.each([
    ['no query at all', null],
    ['a missing organizationId', { period: '30d' }],
    ['a month period without its month', { organizationId: ORG_ID, period: 'month' }],
    ['an unsupported period', { organizationId: ORG_ID, period: '7d' }],
  ])('returns 400 for %s, before checking access', async (_case, query) => {
    const result = await invoke(query, organizationAdminOf(OTHER_ORG_ID));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toBeTruthy();
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it('names the failing field in the 400', async () => {
    const result = await invoke({ organizationId: 'not-a-uuid', period: '30d' }, systemAdmin);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toContain('organizationId');
  });

  it('returns the mapped error when the report cannot be built', async () => {
    mockGetReport.mockRejectedValue(new Error('ProvisionedThroughputExceededException'));

    const result = await invoke({ organizationId: ORG_ID, period: '90d' }, systemAdmin);

    // buildErrorResponse maps an unclassified error to 400 with EG-100.
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      Error: 'ProvisionedThroughputExceededException',
      ErrorCode: 'EG-100',
    });
  });
});
