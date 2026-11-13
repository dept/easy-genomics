process.env.NAME_PREFIX = 'unit-test';

import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-storage-service', () => ({
  LaboratoryStorageService: jest.fn().mockImplementation(() => ({ setProtection: mockSetProtection })),
}));

const mockSetProtection = jest.fn();
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateOrganizationAdminAccess: jest.fn(() => true),
  validateLaboratoryManagerAccess: jest.fn(() => false),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/storage/edit-laboratory-storage-protection.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess } from '../../../../../../src/app/utils/auth-utils';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';

const createEvent = (body: object) =>
  ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { 'cognito:username': 'user-1' } } },
    queryStringParameters: null,
  }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

describe('edit-laboratory-storage-protection.lambda', () => {
  const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: 'bucket' };
  beforeEach(() => {
    jest.clearAllMocks();
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(true);
    (LaboratoryService.prototype.get as jest.Mock) = jest.fn().mockResolvedValue(laboratory);
    mockSetProtection.mockResolvedValue({ Items: [] });
  });

  it('protects the selected items as the calling user', async () => {
    const result = await handler(
      createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, ItemIds: ['InputData#r1'], Protected: true }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(mockSetProtection).toHaveBeenCalledWith(laboratory, ['InputData#r1'], true, 'user-1');
  });

  it('rejects callers without org admin or lab manager access', async () => {
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, ItemIds: ['InputData#r1'], Protected: true }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockSetProtection).not.toHaveBeenCalled();
  });

  it('rejects a request without the Protected flag', async () => {
    const result = await handler(
      createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, ItemIds: ['InputData#r1'] }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(400);
  });
});
