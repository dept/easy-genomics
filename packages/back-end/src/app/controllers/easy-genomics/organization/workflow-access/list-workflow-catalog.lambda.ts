import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { ListUnifiedWorkflowCatalogResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { buildUnifiedWorkflowCatalogForOrganization } from '@BE/services/easy-genomics/unified-workflow-catalog-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

/**
 * GET /easy-genomics/organization/workflow-access/list-workflow-catalog?organizationId=
 *
 * Unified HealthOmics + Seqera workflows for admin assignment UI (full catalog).
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const organizationId: string = event.queryStringParameters?.organizationId || '';
    if (organizationId === '') throw new RequiredIdNotFoundError('organizationId');

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const workflows = await buildUnifiedWorkflowCatalogForOrganization(organizationId);

    const body: ListUnifiedWorkflowCatalogResponse = { workflows };
    return buildResponse(200, JSON.stringify(body), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
