import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  UpdateUserLastAccessedInfo,
  UpdateUserLastAccessedInfoSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { UserService } from '@BE/services/easy-genomics/user-service';

const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    const userId = event.requestContext.authorizer.claims['cognito:username'];
    if (id !== userId) {
      throw new UnauthorizedAccessError();
    }

    // Only the current User can change their own User details
    const existing: User | undefined = (
      await userService.queryByEmail(event.requestContext.authorizer.claims.email)
    ).shift();

    if (!existing) {
      throw new UnauthorizedAccessError();
    }

    // Put Request Body
    const request: UpdateUserLastAccessedInfo = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    // Data validation safety check
    if (!UpdateUserLastAccessedInfoSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const organizationIdLastAccessed: string = request.OrganizationId || '';
    const laboratoryIdLastAccessed: string = request.LaboratoryId || '';

    if (
      existing.DefaultOrganization === organizationIdLastAccessed &&
      existing.DefaultLaboratory === laboratoryIdLastAccessed
    ) {
      return buildResponse(200, JSON.stringify({}), event); // No change
    }

    // Update existing User record in Easy-Genomics User table to track the last accessed OrganizationId / LaboratoryId
    await userService.update(
      {
        ...existing,
        DefaultOrganization: organizationIdLastAccessed,
        DefaultLaboratory: laboratoryIdLastAccessed,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: userId,
      },
      existing,
    );

    return buildResponse(200, JSON.stringify({}), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
