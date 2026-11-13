import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  OrganizationStorageLab,
  RequestOrganizationStorageSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryStorageService } from '@BE/services/easy-genomics/laboratory-storage-service';
import { validateOrganizationAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const laboratoryStorageService = new LaboratoryStorageService();

/** Read-only roll-up of the nightly lab storage snapshots; never lists a bucket itself. */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const parseResult = RequestOrganizationStorageSchema.safeParse({
      OrganizationId: event.queryStringParameters?.organizationId,
    });
    if (!parseResult.success) throw new InvalidRequestError();
    const { OrganizationId } = parseResult.data;

    if (!validateOrganizationAdminAccess(event, OrganizationId)) {
      throw new UnauthorizedAccessError();
    }

    const laboratories = await laboratoryService.queryByOrganizationId(OrganizationId);
    const response: OrganizationStorageLab[] = await Promise.all(
      laboratories.map(async (laboratory) => ({
        LaboratoryId: laboratory.LaboratoryId,
        Name: laboratory.Name,
        S3Bucket: laboratory.S3Bucket,
        RunRetentionMonths: laboratory.RunRetentionMonths,
        Storage: (await laboratoryStorageService.getTotals(laboratory.LaboratoryId)) ?? undefined,
      })),
    );
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
