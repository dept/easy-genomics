process.env.NAME_PREFIX = 'unit-test';
process.env.SQS_LABORATORY_STORAGE_REMOVAL_QUEUE_URL = 'https://sqs/storage-removal';

import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';

const mockSendMessage = jest.fn();

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../../src/app/services/sqs-service', () => ({
  SqsService: jest.fn().mockImplementation(() => ({ sendMessage: mockSendMessage })),
}));
jest.mock('../../../../../../src/app/utils/auth-utils', () => ({
  validateSystemAdminAccess: jest.fn(() => false),
  validateOrganizationAdminAccess: jest.fn(() => false),
  validateLaboratoryManagerAccess: jest.fn(() => true),
}));

import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/storage/remove-laboratory-storage-items.lambda';
import { LaboratoryService } from '../../../../../../src/app/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../../src/app/utils/auth-utils';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const LAB_ID = '00000000-0000-0000-0000-000000000002';

const createEvent = (body: object) =>
  ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { authorizer: { claims: { 'cognito:username': 'user-1' } } },
    queryStringParameters: null,
  }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

describe('remove-laboratory-storage-items.lambda', () => {
  const laboratory = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, S3Bucket: 'bucket' };
  beforeEach(() => {
    jest.clearAllMocks();
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(true);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (LaboratoryService.prototype.get as jest.Mock) = jest.fn().mockResolvedValue(laboratory);
    mockSendMessage.mockResolvedValue({});
  });

  it('enqueues the selected items for a lab manager', async () => {
    const result = await handler(
      createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, ItemIds: ['RunOutputs#r1'] }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ Status: 'Queued' });
    expect(validateLaboratoryManagerAccess).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        QueueUrl: 'https://sqs/storage-removal',
        MessageGroupId: LAB_ID,
        MessageBody: JSON.stringify({
          OrganizationId: ORG_ID,
          LaboratoryId: LAB_ID,
          ItemIds: ['RunOutputs#r1'],
        }),
      }),
    );
  });

  it('rejects a lab technician', async () => {
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(
      createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, ItemIds: ['RunOutputs#r1'] }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(403);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty selection', async () => {
    const result = await handler(
      createEvent({ OrganizationId: ORG_ID, LaboratoryId: LAB_ID, ItemIds: [] }),
      {} as any,
      () => {},
    );

    expect(result.statusCode).toBe(400);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
