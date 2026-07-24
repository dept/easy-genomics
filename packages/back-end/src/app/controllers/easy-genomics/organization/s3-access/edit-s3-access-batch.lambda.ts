import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { BatchUpdateLaboratoryS3AccessRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-s3-access';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  BatchUpdateLaboratoryS3AccessRequest,
  ClearedLaboratoryDefaultBucket,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const accessService = new LaboratoryS3AccessService();

/**
 * POST /easy-genomics/organization/s3-access/edit-s3-access-batch?organizationId=
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const organizationId: string = event.queryStringParameters?.organizationId || '';
    if (organizationId === '') throw new RequiredIdNotFoundError('organizationId');

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const userId: string = event.requestContext.authorizer.claims['cognito:username'];

    const rawBody = event.isBase64Encoded ? atob(event.body!) : event.body!;
    const parsed: unknown = JSON.parse(rawBody || '{}');
    if (!BatchUpdateLaboratoryS3AccessRequestSchema.safeParse(parsed).success) {
      throw new InvalidRequestError();
    }
    const body = parsed as BatchUpdateLaboratoryS3AccessRequest;

    const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);
    const labById = new Map(laboratories.map((l) => [l.LaboratoryId, l]));

    for (const change of body.assignments) {
      const lab = labById.get(change.laboratoryId);
      if (!lab || lab.OrganizationId !== organizationId) {
        throw new InvalidRequestError('laboratoryId does not belong to organization');
      }
    }

    const clearedDefaults: ClearedLaboratoryDefaultBucket[] = [];

    for (const change of body.assignments) {
      const lab = labById.get(change.laboratoryId)!;
      const defaultOn = lab.EnableNewBucketsByDefault === true;
      if (change.granted) {
        if (defaultOn) {
          await accessService.remove(change.laboratoryId, change.bucketName);
        } else {
          await accessService.upsert({
            LaboratoryId: change.laboratoryId,
            BucketName: change.bucketName,
            OrganizationId: organizationId,
            Effect: 'ALLOW',
          });
        }
      } else {
        if (defaultOn) {
          await accessService.upsert({
            LaboratoryId: change.laboratoryId,
            BucketName: change.bucketName,
            OrganizationId: organizationId,
            Effect: 'DENY',
          });
        } else {
          await accessService.remove(change.laboratoryId, change.bucketName);
        }

        // Revoking access to a lab's configured default bucket leaves a stale default
        // that fails later with 403 (EG-333). Clear it here so the lab reflects reality.
        if (lab.S3Bucket && lab.S3Bucket === change.bucketName) {
          const updated: Laboratory = {
            ...lab,
            S3Bucket: undefined,
            ModifiedAt: new Date().toISOString(),
            ModifiedBy: userId,
          };
          await laboratoryService.update(updated, lab);
          // Keep the in-memory lab consistent in case the same lab appears again in the batch.
          lab.S3Bucket = undefined;
          clearedDefaults.push({ laboratoryId: change.laboratoryId, bucketName: change.bucketName });
        }
      }
    }

    return buildResponse(200, JSON.stringify({ ok: true, clearedDefaults }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
