process.env.NAME_PREFIX = 'unit-test';

import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-storage-service', () => ({
  LaboratoryStorageService: jest.fn().mockImplementation(() => ({ getOrScanSummary: mockGetOrScan })),
}));

const mockGetOrScan = jest.fn();
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(() => false),
  validateLaboratoryManagerAccess: jest.fn(() => true),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/storage/list-laboratory-storage.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateLaboratoryManagerAccess } from '../../../../../../src/app/utils/auth-utils';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';

const createEvent = (query: Record<string, string> | null) =>
  ({
    body: null,
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: {} } },
    queryStringParameters: query,
  }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

describe('list-laboratory-storage.lambda', () => {
  const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: 'bucket' };
  beforeEach(() => {
    jest.clearAllMocks();
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(true);
    (LaboratoryService.prototype.get as jest.Mock) = jest.fn().mockResolvedValue(laboratory);
    mockGetOrScan.mockResolvedValue({ LaboratoryId: LAB_ID, Items: [] });
  });

  it('returns the lab storage snapshot', async () => {
    const result = await handler(createEvent({ organizationId: ORG_ID, laboratoryId: LAB_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ LaboratoryId: LAB_ID, Items: [] });
    expect(mockGetOrScan).toHaveBeenCalledWith(laboratory);
  });

  it('rejects callers without org admin or lab manager access', async () => {
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(createEvent({ organizationId: ORG_ID, laboratoryId: LAB_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(403);
  });

  it('rejects a request without a laboratory id', async () => {
    const result = await handler(createEvent({ organizationId: ORG_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(400);
  });
});
