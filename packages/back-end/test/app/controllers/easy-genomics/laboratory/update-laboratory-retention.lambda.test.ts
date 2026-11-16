import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/update-laboratory-retention.lambda';
import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('update-laboratory-retention.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const existing = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, Name: 'Lab', Status: 'Active' };
  const retention = {
    RunRetentionMonths: 6,
    RetentionKeepInputData: true,
    RetentionIncludePrePolicyData: false,
  };

  const mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
  const mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.Mock;
  const mockValidateSystemAdmin = validateSystemAdminAccess as jest.Mock;
  const mockValidateLabManager = validateLaboratoryManagerAccess as jest.Mock;

  const createEvent = (id: string | undefined, body: string | undefined) =>
    ({
      body,
      isBase64Encoded: false,
      httpMethod: 'PUT',
      headers: {},
      requestContext: { authorizer: { claims: { 'cognito:username': 'manager-user' } } },
      pathParameters: id ? { id } : null,
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  const invoke = (id: string | undefined, body: string | undefined) =>
    handler(createEvent(id, body), {} as Context, () => {});

  beforeEach(() => {
    jest.clearAllMocks();
    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue(existing);
    mockLabService.prototype.updateRetention = jest.fn().mockResolvedValue({ ...existing, ...retention });
    mockLabService.prototype.update = jest.fn();
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(true);
  });

  it('saves retention for a laboratory manager', async () => {
    const result = await invoke(LAB_ID, JSON.stringify(retention));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(expect.objectContaining(retention));
    expect(mockLabService.prototype.updateRetention).toHaveBeenCalledWith(existing, retention, 'manager-user');
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
  });

  it('saves retention for a system admin', async () => {
    mockValidateLabManager.mockReturnValue(false);
    mockValidateSystemAdmin.mockReturnValue(true);

    const result = await invoke(LAB_ID, JSON.stringify(retention));

    expect(result.statusCode).toBe(200);
  });

  it('returns 403 for a lab technician', async () => {
    mockValidateLabManager.mockReturnValue(false);

    const result = await invoke(LAB_ID, JSON.stringify(retention));

    expect(result.statusCode).toBe(403);
    expect(mockLabService.prototype.updateRetention).not.toHaveBeenCalled();
  });

  it('returns 400 when RunRetentionMonths is missing', async () => {
    const result = await invoke(LAB_ID, JSON.stringify({ RetentionKeepInputData: true }));

    expect(result.statusCode).toBe(400);
    expect(mockLabService.prototype.updateRetention).not.toHaveBeenCalled();
  });
});
