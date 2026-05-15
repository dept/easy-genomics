import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { LaboratoryUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user-details';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const laboratoryUserService = new LaboratoryUserService();
const userService = new UserService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Get Query Parameter
    const organizationId: string | undefined = event.queryStringParameters?.organizationId;
    const laboratoryId: string | undefined = event.queryStringParameters?.laboratoryId;
    const userId: string | undefined = event.queryStringParameters?.userId;

    const laboratoryUsers: LaboratoryUser[] = await listLaboratoryUsers(organizationId, laboratoryId, userId);

    if (laboratoryUsers.length === 0) {
      return buildResponse(200, JSON.stringify([]), event);
    }

    // Retrieve User Details for the list of LaboratoryUsers for display
    const userIds: string[] = laboratoryUsers.map((labUser) => labUser.UserId);
    const users: User[] = await userService.listUsers(userIds);

    const response: LaboratoryUserDetails[] = laboratoryUsers.reduce((accumulator, labUser) => {
      const user: User | undefined = users.find((u) => u.UserId === labUser.UserId);
      if (user) {
        const details: LaboratoryUserDetails = {
          UserId: labUser.UserId,
          LaboratoryId: labUser.LaboratoryId,
          LabManager: labUser.LabManager,
          LabTechnician: labUser.LabTechnician,
          PreferredName: user.PreferredName,
          FirstName: user.FirstName,
          LastName: user.LastName,
          UserEmail: user.Email,
        };
        accumulator.push(details);
      }
      return accumulator;
    }, [] as LaboratoryUserDetails[]);

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

export const listLaboratoryUsers = (
  organizationId?: string,
  laboratoryId?: string,
  userId?: string,
): Promise<LaboratoryUser[]> => {
  if (organizationId && !laboratoryId && !userId) {
    return laboratoryUserService.queryByOrganizationId(organizationId);
  } else if (laboratoryId && !organizationId && !userId) {
    return laboratoryUserService.queryByLaboratoryId(laboratoryId);
  } else if (userId && !organizationId && !laboratoryId) {
    return laboratoryUserService.queryByUserId(userId);
  } else {
    throw new InvalidRequestError();
  }
};
