import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryUserAlreadyExistsError,
  LaboratoryUserNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { AddLaboratoryUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { OrganizationUserService } from '@BE/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { validateLaboratoryManagerAccess, validateOrganizationAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const laboratoryUserService = new LaboratoryUserService();
const organizationUserService = new OrganizationUserService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Post Request Body
    const request: LaboratoryUser = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!AddLaboratoryUserSchema.safeParse(request).success) throw new InvalidRequestError();

    // Retrieve existing Laboratory and User record details
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    const existingUser: User = await userService.get(request.UserId);

    // Only Organisation Admins and Laboratory Managers are allowed to add a Laboratory-User mapping
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    // Verify User has access to the Organization - throws error if not found
    await organizationUserService.get(laboratory.OrganizationId, existingUser.UserId);

    // Verify User does not have an existing LaboratoryUser access mapping
    const laboratoryUser: LaboratoryUser | void = await laboratoryUserService
      .get(laboratory.LaboratoryId, existingUser.UserId)
      .catch((error: unknown) => {
        if (error instanceof LaboratoryUserNotFoundError) {
          // Do nothing - allow new Laboratory-User access mapping to proceed.
        } else {
          throw error;
        }
      });
    if (laboratoryUser) {
      throw new LaboratoryUserAlreadyExistsError();
    }

    const response = await platformUserService
      .addExistingUserToLaboratory(
        {
          ...existingUser,
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: currentUserId,
        },
        {
          ...request,
          OrganizationId: laboratory.OrganizationId,
          CreatedAt: new Date().toISOString(),
          CreatedBy: currentUserId,
        },
      )
      .catch((error: any) => {
        if (error instanceof ConditionalCheckFailedException) {
          throw new LaboratoryUserAlreadyExistsError();
        } else {
          throw error;
        }
      });

    if (response) {
      return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
    } else {
      throw new Error('Unable to add Laboratory User');
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
