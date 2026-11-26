import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

const mockList = jest.fn();
jest.mock('../../../../../src/app/services/easy-genomics/run-limit-events-report-service', () => ({
  RunLimitEventsReportService: jest.fn().mockImplementation(() => ({
    list: (...args: unknown[]) => mockList(...args),
  })),
}));

import { handler } from '../../../../../src/app/controllers/easy-genomics/usage/list-run-limit-events.lambda';

describe('list-run-limit-events.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000009';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const response = { Events: [], Truncated: false };

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
    mockList.mockResolvedValue(response);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the events to an organization admin of that organization', async () => {
    const query = { organizationId: ORG_ID, period: '30d', kind: 'blocked' };

    const result = await invoke(query, organizationAdminOf(ORG_ID));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(response);
    expect(mockList).toHaveBeenCalledWith(query, expect.any(Date));
  });

  it('returns a calendar month to the system admin', async () => {
    const result = await invoke(
      { organizationId: ORG_ID, period: 'month', month: '2026-03', kind: 'warned' },
      systemAdmin,
    );

    expect(result.statusCode).toBe(200);
  });

  it.each([
    ['an organization admin of another organization', organizationAdminOf(OTHER_ORG_ID)],
    ['a lab manager', labMemberOf('LabManager')],
    ['a lab technician', labMemberOf('LabTechnician')],
  ])('returns 403 to %s', async (_caller, claims) => {
    const result = await invoke({ organizationId: ORG_ID, period: '30d', kind: 'blocked' }, claims);

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-103');
    expect(mockList).not.toHaveBeenCalled();
  });

  it.each([
    ['no query at all', null],
    ['a missing kind', { organizationId: ORG_ID, period: '30d' }],
    ['an unknown kind', { organizationId: ORG_ID, period: '30d', kind: 'other' }],
    ['a month period without its month', { organizationId: ORG_ID, period: 'month', kind: 'warned' }],
  ])('returns 400 for %s, before checking access', async (_case, query) => {
    const result = await invoke(query, organizationAdminOf(OTHER_ORG_ID));

    expect(result.statusCode).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('names the failing field in the 400', async () => {
    const result = await invoke({ organizationId: ORG_ID, period: '30d' }, systemAdmin);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toContain('kind');
  });

  it('returns the mapped error when the events cannot be listed', async () => {
    mockList.mockRejectedValue(new Error('ProvisionedThroughputExceededException'));

    const result = await invoke({ organizationId: ORG_ID, period: '90d', kind: 'blocked' }, systemAdmin);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-100');
  });
});
