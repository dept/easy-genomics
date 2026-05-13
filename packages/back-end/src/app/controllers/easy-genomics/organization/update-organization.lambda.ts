import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  OrganizationNameTakenError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { UpdateOrganizationSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const organizationService = new OrganizationService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    // Only System Admins or Organisation Admins allowed
    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, id))) {
      throw new UnauthorizedAccessError();
    }

    const userId = event.requestContext.authorizer.claims['cognito:username'];
    // Put Request Body
    const request: Organization = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!UpdateOrganizationSchema.safeParse(request).success) throw new InvalidRequestError();

    // Lookup by OrganizationId to confirm existence before updating
    const existing: Organization = await organizationService.get(id);
    const updated: Organization | void = await organizationService
      .update(
        {
          ...existing,
          ...request,
          NextFlowTowerApiBaseUrl: request.NextFlowTowerApiBaseUrl || process.env.SEQERA_API_BASE_URL,
          ModifiedAt: new Date().toISOString(),
          ModifiedBy: userId,
        },
        existing,
      )
      .catch((error: any) => {
        if (error instanceof TransactionCanceledException) {
          throw new OrganizationNameTakenError();
        } else {
          throw error;
        }
      });
    return buildResponse(200, JSON.stringify(updated), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
