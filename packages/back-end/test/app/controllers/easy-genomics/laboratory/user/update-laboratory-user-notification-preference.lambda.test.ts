import { LaboratoryUserNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/user/update-laboratory-user-notification-preference.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/laboratory-user-service');

import { LaboratoryUserService } from '../../../../../../src/app/services/easy-genomics/laboratory-user-service';

describe('update-laboratory-user-notification-preference.lambda', () => {
  const LAB_ID = '00000000-0000-0000-0000-000000000002';

  const createEvent = (
    body: any,
    pathParameters: Record<string, string> | null = { id: LAB_ID },
    claims: Record<string, string> = { 'cognito:username': 'user-1', 'email': 'user@example.com' },
  ) =>
    ({
      body: JSON.stringify(body),
      isBase64Encoded: false,
      pathParameters,
      requestContext: {
        authorizer: { claims },
      },
    }) as unknown as APIGatewayProxyWithCognitoAuthorizerEvent;

  const createContext = (): Context => ({ functionName: 'update-laboratory-user-notification-preference' }) as any;

  let mockGet: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGet = jest.fn().mockResolvedValue({
      LaboratoryId: LAB_ID,
      UserId: 'user-1',
      OrganizationId: 'org-1',
      Status: 'Active',
      LabManager: false,
      LabTechnician: true,
    });
    mockUpdate = jest.fn().mockImplementation((laboratoryUser) => Promise.resolve(laboratoryUser));
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.get = mockGet;
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.update = mockUpdate;
  });

  it("updates only NotifyOnLabRuns on the caller's own LaboratoryUser row", async () => {
    const event = createEvent({ NotifyOnLabRuns: true });

    const result = await handler(event, createContext(), () => {});

    expect(mockGet).toHaveBeenCalledWith(LAB_ID, 'user-1');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ NotifyOnLabRuns: true, LabManager: false }));
    expect(JSON.parse(result.body).NotifyOnLabRuns).toBe(true);
  });

  it('rejects a request missing the laboratory id path parameter', async () => {
    const event = createEvent({ NotifyOnLabRuns: true }, null);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).not.toBe(200);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('rejects a request from a caller who is not a member of the laboratory', async () => {
    mockGet.mockRejectedValue(new LaboratoryUserNotFoundError(LAB_ID, 'user-1'));
    const event = createEvent({ NotifyOnLabRuns: true });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an invalid request body', async () => {
    const event = createEvent({ NotifyOnLabRuns: 'yes' });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).not.toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("looks up the row by the internal 'UserId' claim, not the raw Cognito username, when they differ", async () => {
    const event = createEvent(
      { NotifyOnLabRuns: true },
      { id: LAB_ID },
      {
        'cognito:username': 'cognito-sub-1',
        'UserId': 'internal-user-1',
        'email': 'user@example.com',
      },
    );

    await handler(event, createContext(), () => {});

    expect(mockGet).toHaveBeenCalledWith(LAB_ID, 'internal-user-1');
    // Audit field still records the raw Cognito identity, matching the rest of the codebase.
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ ModifiedBy: 'cognito-sub-1' }));
  });

  it('sets NotifyOnLabRunsAdditionalEmails when provided', async () => {
    const event = createEvent({ NotifyOnLabRuns: true, NotifyOnLabRunsAdditionalEmails: ['a@example.com'] });

    await handler(event, createContext(), () => {});

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ NotifyOnLabRunsAdditionalEmails: ['a@example.com'] }),
    );
  });

  it('leaves the existing NotifyOnLabRunsAdditionalEmails untouched when the field is omitted', async () => {
    mockGet.mockResolvedValue({
      LaboratoryId: LAB_ID,
      UserId: 'user-1',
      OrganizationId: 'org-1',
      Status: 'Active',
      LabManager: false,
      LabTechnician: true,
      NotifyOnLabRunsAdditionalEmails: ['existing@example.com'],
    });
    const event = createEvent({ NotifyOnLabRuns: false });

    await handler(event, createContext(), () => {});

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ NotifyOnLabRunsAdditionalEmails: ['existing@example.com'] }),
    );
  });

  it('rejects a request with an invalid email in NotifyOnLabRunsAdditionalEmails', async () => {
    const event = createEvent({ NotifyOnLabRuns: true, NotifyOnLabRunsAdditionalEmails: ['not-an-email'] });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).not.toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a request with more than 10 additional emails', async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `person${i}@example.com`);
    const event = createEvent({ NotifyOnLabRuns: true, NotifyOnLabRunsAdditionalEmails: tooMany });

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).not.toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
