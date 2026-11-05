import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/laboratory/update-laboratory-run-limits.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '../../../../../src/app/utils/auth-utils';

describe('update-laboratory-run-limits.lambda', () => {
  const ORG_ID = '00000000-0000-0000-0000-000000000001';
  const LAB_ID = '00000000-0000-0000-0000-000000000002';
  const existing = { OrganizationId: ORG_ID, LaboratoryId: LAB_ID, Name: 'Lab', Status: 'Active' };
  const limits = { CostWarnAboveUsd: 150, CostBlockAboveUsd: 400, SamplesWarnAbove: 300, SamplesBlockAbove: 500 };

  const mockLabService = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
  const mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.Mock;
  const mockValidateSystemAdmin = validateSystemAdminAccess as jest.Mock;

  const createEvent = (id: string | undefined, body: string | undefined) =>
    ({
      body,
      isBase64Encoded: false,
      httpMethod: 'PUT',
      headers: {},
      requestContext: { authorizer: { claims: { 'cognito:username': 'admin-user' } } },
      pathParameters: id ? { id } : null,
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  const invoke = (id: string | undefined, body: string | undefined) =>
    handler(createEvent(id, body), {} as Context, () => {});

  beforeEach(() => {
    jest.clearAllMocks();
    mockLabService.prototype.queryByLaboratoryId = jest.fn().mockResolvedValue(existing);
    mockLabService.prototype.updateRunLimits = jest.fn().mockResolvedValue({ ...existing, RunLimits: limits });
    mockLabService.prototype.update = jest.fn();
    mockValidateOrgAdmin.mockReturnValue(true);
    mockValidateSystemAdmin.mockReturnValue(false);
  });

  it('saves the limits for an organization admin of the lab', async () => {
    const result = await invoke(LAB_ID, JSON.stringify(limits));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).RunLimits).toEqual(limits);
    expect(mockLabService.prototype.updateRunLimits).toHaveBeenCalledWith(existing, limits, 'admin-user');
    expect(mockLabService.prototype.update).not.toHaveBeenCalled();
  });

  it('saves the limits for a system admin', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateSystemAdmin.mockReturnValue(true);

    const result = await invoke(LAB_ID, JSON.stringify(limits));

    expect(result.statusCode).toBe(200);
  });

  it('returns 403 for a caller who is not an admin, such as a lab manager or technician', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await invoke(LAB_ID, JSON.stringify(limits));

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-103');
    expect(mockLabService.prototype.updateRunLimits).not.toHaveBeenCalled();
  });

  it('checks organization admin access against the stored lab OrganizationId', async () => {
    mockValidateOrgAdmin.mockReturnValue(false);

    const result = await invoke(LAB_ID, JSON.stringify(limits));

    expect(mockValidateOrgAdmin).toHaveBeenCalledWith(expect.anything(), ORG_ID);
    expect(result.statusCode).toBe(403);
  });

  it('returns 400 with the refine message when block is not above warn', async () => {
    const result = await invoke(LAB_ID, JSON.stringify({ CostWarnAboveUsd: 400, CostBlockAboveUsd: 400 }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toContain('higher than');
    expect(mockLabService.prototype.updateRunLimits).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing body', undefined],
    ['a null body', 'null'],
    ['a string amount', JSON.stringify({ CostWarnAboveUsd: '150' })],
    ['a negative amount', JSON.stringify({ SamplesBlockAbove: -1 })],
  ])('returns 400 for %s and writes nothing', async (_label, body) => {
    const result = await invoke(LAB_ID, body);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).ErrorCode).toBe('EG-102');
    expect(mockLabService.prototype.updateRunLimits).not.toHaveBeenCalled();
  });

  it('returns 400 when the path id is missing', async () => {
    const result = await invoke(undefined, JSON.stringify(limits));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).Error).toBe('Required id is missing');
  });

  it('clears every limit when the body is empty', async () => {
    const result = await invoke(LAB_ID, '{}');

    expect(result.statusCode).toBe(200);
    expect(mockLabService.prototype.updateRunLimits).toHaveBeenCalledWith(existing, {}, 'admin-user');
  });
});
