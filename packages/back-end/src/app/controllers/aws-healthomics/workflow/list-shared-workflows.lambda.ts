import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryNotFoundError,
  MissingAWSHealthOmicsAccessError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { OmicsService } from '@BE/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { isWorkflowAccessAllowed } from '@BE/utils/laboratory-workflow-access-utils';
import { listAllSharedWorkflowSummaries } from '@BE/utils/omics-shared-workflow-utils';

const laboratoryService = new LaboratoryService();
const omicsService = new OmicsService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();

/**
 * GET /aws-healthomics/workflow/list-shared-workflows?laboratoryId={LaboratoryId}
 *
 * Returns ACTIVE cross-account shared HealthOmics workflows the lab may access,
 * after applying laboratory workflow-access grants (same semantics as
 * list-private-workflows). Fetches every ListShares page so grants beyond the
 * first page are not hidden.
 *
 * Response shape mirrors private listing for FE merge:
 *   { items: [{ id, name, ownerAccountId?, source: 'SHARED' }] }
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    if (!laboratory) {
      throw new LaboratoryNotFoundError();
    }

    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new MissingAWSHealthOmicsAccessError();
    }

    const nameFilter = event.queryStringParameters?.name?.trim().toLowerCase();
    const allShared = await listAllSharedWorkflowSummaries(omicsService);
    const accessRows = await laboratoryWorkflowAccessService.listByLaboratoryId(laboratoryId);

    const items = allShared
      .filter((w) => isWorkflowAccessAllowed(laboratory, accessRows, 'HEALTH_OMICS', w.id))
      .filter((w) => !nameFilter || w.name.toLowerCase().includes(nameFilter))
      .map((w) => ({
        id: w.id,
        name: w.name,
        source: 'SHARED' as const,
        ...(w.ownerAccountId ? { ownerAccountId: w.ownerAccountId } : {}),
      }));

    return buildResponse(200, JSON.stringify({ items }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
