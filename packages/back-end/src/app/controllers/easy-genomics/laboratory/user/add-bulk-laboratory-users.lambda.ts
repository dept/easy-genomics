import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryUserNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { AddBulkLaboratoryUsersSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
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

type BulkOutcome = 'Added' | 'Skipped' | 'Failed';
interface BulkResultItem {
  UserId: string;
  Outcome: BulkOutcome;
  Reason?: string;
}

const laboratoryService = new LaboratoryService();
const laboratoryUserService = new LaboratoryUserService();
const organizationUserService = new OrganizationUserService();
const platformUserService = new PlatformUserService();
const userService = new UserService();

async function addOneUserToLaboratory(
  laboratory: Laboratory,
  item: { UserId: string; LabManager: boolean; LabTechnician: boolean },
  currentUserId: string,
): Promise<BulkResultItem> {
  try {
    const existingUser: User = await userService.get(item.UserId);

    const isOrgMember = await organizationUserService
      .get(laboratory.OrganizationId, existingUser.UserId)
      .then(() => true)
      .catch(() => false);
    if (!isOrgMember) {
      return { UserId: item.UserId, Outcome: 'Skipped', Reason: 'Not a member of this organization' };
    }

    const existingLabUser: LaboratoryUser | void = await laboratoryUserService
      .get(laboratory.LaboratoryId, existingUser.UserId)
      .catch((error: unknown) => {
        if (!(error instanceof LaboratoryUserNotFoundError)) throw error;
      });
    if (existingLabUser) {
      return { UserId: item.UserId, Outcome: 'Skipped', Reason: 'Already a member of this lab' };
    }

    await platformUserService.addExistingUserToLaboratory(
      {
        ...existingUser,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: currentUserId,
      },
      {
        LaboratoryId: laboratory.LaboratoryId,
        UserId: item.UserId,
        OrganizationId: laboratory.OrganizationId,
        Status: 'Active',
        LabManager: item.LabManager,
        LabTechnician: item.LabTechnician,
        CreatedAt: new Date().toISOString(),
        CreatedBy: currentUserId,
      },
    );
    return { UserId: item.UserId, Outcome: 'Added' };
  } catch (error: any) {
    return { UserId: item.UserId, Outcome: 'Failed', Reason: error?.message || 'Unknown error' };
  }
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const currentUserId: string = event.requestContext.authorizer.claims['cognito:username'];
    const request = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!AddBulkLaboratoryUsersSchema.safeParse(request).success) throw new InvalidRequestError();

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(request.LaboratoryId);

    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const results: BulkResultItem[] = await Promise.all(
      request.Users.map((item: { UserId: string; LabManager: boolean; LabTechnician: boolean }) =>
        addOneUserToLaboratory(laboratory, item, currentUserId),
      ),
    );

    return buildResponse(200, JSON.stringify(results), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
