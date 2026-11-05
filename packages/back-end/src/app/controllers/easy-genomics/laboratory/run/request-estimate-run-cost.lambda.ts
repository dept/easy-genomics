import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  EstimateRunCostRequest,
  EstimateRunCostRequestSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { RunCostEstimationService } from '@BE/services/easy-genomics/run-cost-estimation-service';
import { RunLimitCheckService } from '@BE/services/easy-genomics/run-limit-check-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const runCostEstimationService = new RunCostEstimationService();
const runLimitCheckService = new RunLimitCheckService();

/**
 * POST /easy-genomics/laboratory/run/request-estimate-run-cost?laboratoryId={id}
 *
 * Pre-run historical compute cost estimate. Read-only DynamoDB + optional S3
 * HeadObject/GetObject for input profile — never calls Cost Explorer.
 *
 * When the lab has run limits, the response also carries `limitVerdict`: the same verdict launch
 * reaches, from the same server-derived inputs. Client-sent sizes never feed it.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const laboratoryId = event.queryStringParameters?.laboratoryId || '';
    if (!laboratoryId) throw new RequiredIdNotFoundError('laboratoryId');

    const request: EstimateRunCostRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!EstimateRunCostRequestSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();

    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const { platform, workflowExternalId, workflowVersionName, sampleSheetS3Url, settings } = request;
    const [estimate, limitVerdict] = await Promise.all([
      runCostEstimationService.estimate(laboratory, request),
      runLimitCheckService.checkRunLimits(laboratory, {
        platform,
        workflowExternalId,
        workflowVersionName,
        sampleSheetS3Url,
        settings,
      }),
    ]);
    const response = limitVerdict ? { ...estimate, limitVerdict } : estimate;
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
