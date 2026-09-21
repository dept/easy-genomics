import { ConflictException, ResourceNotFoundException } from '@aws-sdk/client-omics';
import { GetWorkflowCommandInput } from '@aws-sdk/client-omics/dist-types/commands/GetWorkflowCommand';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
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
import { OmicsService } from '@BE/services/omics-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { resolveSharedWorkflowOwnerId } from '@BE/utils/omics-shared-workflow-utils';
import { canDeleteOwnedPrivateWorkflow, creatorIdsFromAuthorizerClaims } from '@BE/utils/private-workflow-ownership';

const laboratoryService = new LaboratoryService();
const laboratoryWorkflowAccessService = new LaboratoryWorkflowAccessService();
const omicsService = new OmicsService();

function hasPrivateWorkflowCreateAccess(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  laboratory: Laboratory,
): boolean {
  return !!(
    validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
    validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
    validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
  );
}

async function deleteWorkflowVersions(workflowId: string): Promise<void> {
  let nextToken: string | undefined;
  do {
    const page = await omicsService.listWorkflowVersions({
      workflowId,
      type: 'PRIVATE',
      maxResults: 100,
      startingToken: nextToken,
    });
    for (const version of page.items ?? []) {
      if (!version.versionName) continue;
      try {
        await omicsService.deleteWorkflowVersion({
          workflowId,
          versionName: version.versionName,
        });
      } catch (error) {
        // The remaining default version is removed with DeleteWorkflow.
        if (!(error instanceof ConflictException) && !(error instanceof ResourceNotFoundException)) {
          throw error;
        }
      }
    }
    nextToken = page.nextToken;
  } while (nextToken);
}

async function deletePrivateWorkflow(workflowId: string): Promise<void> {
  try {
    await omicsService.deleteWorkflow({ id: workflowId });
    return;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      throw new OmicsWorkflowNotFoundError(workflowId);
    }
    if (!(error instanceof ConflictException)) {
      throw error;
    }
  }

  await deleteWorkflowVersions(workflowId);

  try {
    await omicsService.deleteWorkflow({ id: workflowId });
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return;
    }
    if (error instanceof ConflictException) {
      throw new InvalidRequestError('This workflow cannot be deleted while a run is using it.');
    }
    throw error;
  }
}

/**
 * DELETE /aws-healthomics/workflow/delete-private-workflow/{id}?laboratoryId={LaboratoryId}
 *
 * Deletes a private HealthOmics workflow that the caller created through Easy Genomics.
 * Permission matches create-private-workflow: org admin, lab manager, or lab technician.
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

    if (!hasPrivateWorkflowCreateAccess(event, laboratory)) {
      throw new UnauthorizedAccessError();
    }

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new MissingAWSHealthOmicsAccessError();
    }

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

    const ownership = canDeleteOwnedPrivateWorkflow({
      tags: workflow.tags,
      laboratoryId: laboratory.LaboratoryId,
      organizationId: laboratory.OrganizationId,
      creatorIds: creatorIdsFromAuthorizerClaims(event.requestContext.authorizer?.claims),
    });
    if (!ownership.allowed) {
      throw new UnauthorizedAccessError(ownership.reason);
    }

    await deletePrivateWorkflow(id);

    try {
      await laboratoryWorkflowAccessService.remove(laboratoryId, 'HEALTH_OMICS', id);
    } catch (error) {
      console.warn(`Failed to remove laboratory workflow access after deleting workflow ${id}`, error);
    }

    return buildResponse(200, JSON.stringify({ Status: 'Success' }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
