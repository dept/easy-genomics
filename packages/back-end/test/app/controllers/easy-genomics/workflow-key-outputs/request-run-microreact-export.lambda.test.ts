import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/workflow-key-outputs/request-run-microreact-export.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/microreact-export-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { MicroreactExportService } from '../../../../../src/app/services/easy-genomics/microreact-export-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

const ORG_ID = '44444444-4444-4444-8444-444444444444';
const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const REQUEST = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, RunId: 'run-1' };

describe('request-run-microreact-export Lambda', () => {
  let mockRequestExport: jest.Mock;

  const createMockEvent = (body: unknown): APIGatewayProxyWithCognitoAuthorizerEvent =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      httpMethod: 'POST',
      path: '/workflow-key-outputs/request-run-microreact-export',
      headers: {},
      requestContext: {
        requestId: 'request-id',
        authorizer: { claims: { 'cognito:username': 'user-1', 'email': 'test@example.com' } },
      } as any,
      resource: '',
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: {},
    }) as APIGatewayProxyWithCognitoAuthorizerEvent;

  const context = { getRemainingTimeInMillis: () => 30000 } as unknown as Context;

  beforeEach(() => {
    jest.clearAllMocks();
    (validateSystemAdminAccess as jest.Mock).mockReturnValue(false);
    (validateOrganizationAdminAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryManagerAccess as jest.Mock).mockReturnValue(false);
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(true);
    mockRequestExport = jest.fn().mockResolvedValue({ RunId: 'run-1', MicroreactStatus: 'Queued' });
    (MicroreactExportService as jest.MockedClass<typeof MicroreactExportService>).prototype.requestExport =
      mockRequestExport;
  });

  it('lets a lab technician queue a send', async () => {
    const result = await handler(createMockEvent(REQUEST), context, () => {});

    expect(result.statusCode).toEqual(200);
    expect(JSON.parse(result.body)).toEqual({ RunId: 'run-1', MicroreactStatus: 'Queued' });
    expect(validateLaboratoryTechnicianAccess).toHaveBeenCalledWith(expect.anything(), ORG_ID, LAB_ID);
    expect(mockRequestExport).toHaveBeenCalledWith(REQUEST);
  });

  it('rejects a user without access to the laboratory', async () => {
    (validateLaboratoryTechnicianAccess as jest.Mock).mockReturnValue(false);

    const result = await handler(createMockEvent(REQUEST), context, () => {});

    expect(result.statusCode).toEqual(403);
    expect(mockRequestExport).not.toHaveBeenCalled();
  });

  it('rejects a request without the organization', async () => {
    const result = await handler(createMockEvent({ LaboratoryId: LAB_ID, RunId: 'run-1' }), context, () => {});

    expect(result.statusCode).toEqual(400);
    expect(mockRequestExport).not.toHaveBeenCalled();
  });

  it('returns the reason a send cannot be queued', async () => {
    mockRequestExport.mockRejectedValue(
      new InvalidRequestError('Choose a Microreact metadata key output on the delivery page first'),
    );

    const result = await handler(createMockEvent(REQUEST), context, () => {});

    expect(result.statusCode).toEqual(400);
    expect(result.body).toContain('Choose a Microreact metadata key output on the delivery page first');
  });
});
