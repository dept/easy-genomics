import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RemoveLaboratoryUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { PlatformUserService } from '@BE/services/easy-genomics/platform-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { validateLaboratoryManagerAccess, validateOrganizationAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const laboratoryUserService = new LaboratoryUserService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    // Post Request Body
    const request: LaboratoryUser = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!RemoveLaboratoryUserSchema.safeParse(request).success) throw new InvalidRequestError();

    // Verify User has access to the Laboratory - throws error if not found
    const laboratoryUser: LaboratoryUser = await laboratoryUserService.get(request.LaboratoryId, request.UserId);

    // Retrieve Laboratory & User objects for necessary details to perform update/delete transaction
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);
    const existingUser: User = await userService.get(request.UserId);

    // Only Organisation Admins and Laboratory Managers are allowed to remove a Laboratory-User mapping
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const response: boolean = await platformUserService.removeExistingUserFromLaboratory(
      {
        ...existingUser,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: currentUserId,
      },
      laboratoryUser,
    );
    if (response) {
      return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
