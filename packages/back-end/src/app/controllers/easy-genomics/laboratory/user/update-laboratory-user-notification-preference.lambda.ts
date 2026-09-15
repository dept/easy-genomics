import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, RequiredIdNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  UpdateLaboratoryUserNotificationPreference,
  UpdateLaboratoryUserNotificationPreferenceSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';

const laboratoryUserService = new LaboratoryUserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId: string = event.pathParameters?.id || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError();

    const claims = event.requestContext.authorizer.claims;
    const cognitoUsername: string = claims['cognito:username'];
    // LaboratoryUser rows are always keyed by the app's internal User.UserId (see
    // add-laboratory-user.lambda.ts), which is exposed as the custom 'UserId' claim by
    // process-pre-token-generation.lambda.ts. For normally-onboarded users this is the
    // same value as 'cognito:username', but they can diverge (e.g. seeded test accounts),
    // so the internal claim — not the raw Cognito username — is the correct lookup key.
    const currentUserId: string = claims.UserId || cognitoUsername;

    const request: UpdateLaboratoryUserNotificationPreference = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!UpdateLaboratoryUserNotificationPreferenceSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    // Self-service only: resolving the row by the caller's own UserId (from the auth token,
    // never the request body) both confirms membership and prevents setting this preference
    // for anyone else.
    const existing: LaboratoryUser = await laboratoryUserService.get(laboratoryId, currentUserId);

    const response: LaboratoryUser = await laboratoryUserService.update({
      ...existing,
      NotifyOnLabRuns: request.NotifyOnLabRuns,
      // Omitted (not just empty-array) means "leave the existing list alone".
      ...(request.NotifyOnLabRunsAdditionalEmails !== undefined
        ? { NotifyOnLabRunsAdditionalEmails: request.NotifyOnLabRunsAdditionalEmails }
        : {}),
      ModifiedAt: new Date().toISOString(),
      ModifiedBy: cognitoUsername,
    });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
