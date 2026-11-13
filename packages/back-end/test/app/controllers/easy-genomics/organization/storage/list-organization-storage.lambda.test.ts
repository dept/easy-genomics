process.env.NAME_PREFIX = 'unit-test';

import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-storage-service', () => ({
  LaboratoryStorageService: jest.fn().mockImplementation(() => ({ getTotals: mockGetTotals })),
}));

const mockGetTotals = jest.fn();
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(() => true),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/organization/storage/list-organization-storage.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess } from '../../../../../../src/app/utils/auth-utils';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_A = '00000000-0000-0000-0000-00000000000a';
const LAB_B = '00000000-0000-0000-0000-00000000000b';

const createEvent = (query: Record<string, string> | null) =>
  ({
    body: null,
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: {} } },
    queryStringParameters: query,
  }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

describe('list-organization-storage.lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (LaboratoryService.prototype.queryByOrganizationId as jest.Mock) = jest.fn().mockResolvedValue([
      { OrganizationId: ORG_ID, LaboratoryId: LAB_A, Name: 'Pollitzio', S3Bucket: 'a', RunRetentionMonths: 3 },
      { OrganizationId: ORG_ID, LaboratoryId: LAB_B, Name: 'Training', S3Bucket: 'b' },
    ]);
    mockGetTotals.mockImplementation(async (labId: string) => (labId === LAB_A ? { TotalBytes: 10 } : null));
  });

  it('returns one row per lab with its snapshot totals, if scanned', async () => {
    const result = await handler(createEvent({ organizationId: ORG_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual([
      { LaboratoryId: LAB_A, Name: 'Pollitzio', S3Bucket: 'a', RunRetentionMonths: 3, Storage: { TotalBytes: 10 } },
      { LaboratoryId: LAB_B, Name: 'Training', S3Bucket: 'b' },
    ]);
  });

  it('is limited to organization admins', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(createEvent({ organizationId: ORG_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(403);
    expect(validateOrganizationAdminAccess).toHaveBeenCalledWith(expect.anything(), ORG_ID);
  });

  it('rejects a request without an organization id', async () => {
    const result = await handler(createEvent(null), {} as any, () => {});

    expect(result.statusCode).toBe(400);
  });
});
