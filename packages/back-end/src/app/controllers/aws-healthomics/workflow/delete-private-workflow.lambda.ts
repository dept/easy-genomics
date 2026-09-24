import { ResourceNotFoundException } from '@aws-sdk/client-omics';
import { GetWorkflowCommandInput } from '@aws-sdk/client-omics/dist-types/commands/GetWorkflowCommand';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryNotFoundError,
  MissingAWSHealthOmicsAccessError,
  OmicsWorkflowNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import { validateOrganizationAdminOrLaboratoryManagerAccess } from '@BE/utils/auth-utils';
import { resolveSharedWorkflowOwnerId } from '@BE/utils/omics-shared-workflow-utils';
import { deletePrivateOmicsWorkflow } from '@BE/utils/private-workflow-delete-utils';
import {
  PRIVATE_WORKFLOW_OWNERSHIP_DENIED_MESSAGE,
  canDeleteOwnedPrivateWorkflow,
  creatorIdsFromAuthorizerClaims,
} from '@BE/utils/private-workflow-ownership-utils';

const laboratoryService = new LaboratoryService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();

/**
 * DELETE /aws-healthomics/workflow/delete-private-workflow/{id}?laboratoryId={LaboratoryId}
 *
 * Deletes a private HealthOmics workflow that the caller created through Easy Genomics.
 * Permission matches the Create Workflow UI: org admin or lab manager.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();

    if (
      !validateOrganizationAdminOrLaboratoryManagerAccess(
        event,
        laboratory.OrganizationId,
        laboratory.LaboratoryId,
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new MissingAWSHealthOmicsAccessError();
    }

    const userId =
      event.requestContext.authorizer.claims['cognito:username'] ??
      event.requestContext.authorizer.claims.sub ??
      'unknown-user';
    const omicsService = await createOmicsServiceForLab(
      laboratory.LaboratoryId,
      laboratory.OrganizationId,
      userId,
    );

    const sharedOwnerId = await resolveSharedWorkflowOwnerId(omicsService, id);
    if (sharedOwnerId) {
      throw new UnauthorizedAccessError('Shared workflows cannot be deleted from Easy Genomics.');
    }

    const workflow = await omicsService
      .getWorkflow(<GetWorkflowCommandInput>{
        type: 'PRIVATE',
        id,
      })
      .catch((error: unknown) => {
        if (error instanceof ResourceNotFoundException) {
          throw new OmicsWorkflowNotFoundError(id);
        }
        throw error;
      });

    if (
      !canDeleteOwnedPrivateWorkflow({
        tags: workflow.tags,
        laboratoryId: laboratory.LaboratoryId,
        organizationId: laboratory.OrganizationId,
        creatorIds: creatorIdsFromAuthorizerClaims(event.requestContext.authorizer?.claims),
      })
    ) {
      throw new UnauthorizedAccessError(PRIVATE_WORKFLOW_OWNERSHIP_DENIED_MESSAGE);
    }

    await deletePrivateOmicsWorkflow(omicsService, id);

    try {
      await laboratoryWorkflowAccessService.removeAllForWorkflow('HEALTH_OMICS', id);
    } catch (error) {
      // HealthOmics already deleted the workflow. Stale access grants only affect
      // catalog rows and must not fail the caller; list APIs already omit missing workflows.
      console.warn(`Failed to remove laboratory workflow access after deleting workflow ${id}`, error);
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
