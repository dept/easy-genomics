import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  LaboratoryNotFoundError,
  MissingAWSHealthOmicsAccessError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { ReadRunTasks } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { aggregateTaskProgress } from '@BE/utils/omics-run-progress-utils';

const laboratoryService = new LaboratoryService();

/**
 * This GET /aws-healthomics/run/read-run-tasks/{:id}?laboratoryId={LaboratoryId}
 * API lists HealthOmics run tasks for a specific run and returns an aggregated
 * progress snapshot plus the raw task list. It expects:
 *  - Required Path Parameter:
 *    - 'id': AWS HealthOmics Run Id
 *  - Required Query Parameter:
 *    - 'laboratoryId': Laboratory to verify access to AWS HealthOmics
 *
 * @param event
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

    const userId = event.requestContext.authorizer.claims['cognito:username'] as string;
    const omicsService = await createOmicsServiceForLab(laboratory.LaboratoryId, laboratory.OrganizationId, userId);
    const tasks = await omicsService.listRunTasks(id);
    const response: ReadRunTasks = {
      progress: aggregateTaskProgress(tasks),
      tasks,
    };
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
