process.env.NAME_PREFIX = 'unit-test';

import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-storage-service', () => ({
  INTERACTIVE_SCAN_BUDGET_MS: 20_000,
  LaboratoryStorageService: jest.fn().mockImplementation(() => ({ rescan: mockRescan })),
}));
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(() => true),
  validateLaboratoryManagerAccess: jest.fn(() => false),
}));

const mockRescan = jest.fn();

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/storage/request-laboratory-storage-scan.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess } from '../../../../../../src/app/utils/auth-utils';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';

const createEvent = (body: object) =>
  ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: {} } },
    queryStringParameters: null,
  }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

describe('request-laboratory-storage-scan.lambda', () => {
  const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: 'bucket' };

  beforeEach(() => {
    jest.clearAllMocks();
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (LaboratoryService.prototype.get as jest.Mock) = jest.fn().mockResolvedValue(laboratory);
    mockRescan.mockResolvedValue({ LaboratoryId: LAB_ID, Items: [] });
  });

  it('rescans within the interactive budget', async () => {
    const result = await handler(createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(200);
    expect(mockRescan).toHaveBeenCalledWith(laboratory, 20_000);
  });

  it('rejects callers without org admin or lab manager access', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID }), {} as any, () => {});

    expect(result.statusCode).toBe(403);
    expect(mockRescan).not.toHaveBeenCalled();
  });
});
