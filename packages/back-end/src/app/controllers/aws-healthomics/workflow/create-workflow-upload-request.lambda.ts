import { randomUUID } from 'crypto';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const MAX_UPLOAD_SIZE_BYTES = 5 * Math.pow(1024, 3);

type CreateWorkflowUploadRequest = {
  fileName: string;
  size: number;
  requestId?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCreateWorkflowUploadRequest(request: unknown): request is CreateWorkflowUploadRequest {
  if (!isObject(request)) return false;

  const allowedKeys = new Set(['fileName', 'size', 'requestId']);
  const keys = Object.keys(request);
  if (keys.some((key) => !allowedKeys.has(key))) return false;

  const { fileName, size, requestId } = request;
  if (typeof fileName !== 'string' || fileName.trim().length < 1 || fileName.length > 255) return false;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_SIZE_BYTES) return false;
  if (
    requestId !== undefined &&
    (typeof requestId !== 'string' || requestId.trim().length < 1 || requestId.length > 127)
  ) {
    return false;
  }

  return true;
}

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

/**
 * POST /aws-healthomics/workflow/create-workflow-upload-request?laboratoryId={LaboratoryId}
 * Creates a pre-signed S3 upload URL for a workflow definition ZIP file.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    const request = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!isValidCreateWorkflowUploadRequest(request)) throw new InvalidRequestError();

    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new UnauthorizedAccessError('Laboratory does not have AWS HealthOmics enabled');
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

    const { fileName, size } = request;
    if (!fileName.toLowerCase().endsWith('.zip')) {
      throw new InvalidRequestError();
    }

    const workflowUploadBucket = process.env.OMICS_WORKFLOW_UPLOAD_BUCKET;
    if (!workflowUploadBucket) {
      throw new Error('OMICS_WORKFLOW_UPLOAD_BUCKET is not configured');
    }

    const requestId = request.requestId || randomUUID();
    const key = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/workflow-definitions/${requestId}/${fileName}`;
    const uploadUrl = await s3Service.getPreSignedUploadUrl({
      Bucket: workflowUploadBucket,
      Key: key,
      ContentLength: size,
      ContentType: 'application/zip',
    });

    return buildResponse(
      200,
      JSON.stringify({
        requestId,
        bucket: workflowUploadBucket,
        key,
        s3Uri: `s3://${workflowUploadBucket}/${key}`,
        uploadUrl,
      }),
      event,
    );
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
