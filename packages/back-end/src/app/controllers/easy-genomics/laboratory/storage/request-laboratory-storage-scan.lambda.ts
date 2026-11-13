import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestLaboratorySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { LaboratoryStorageSummary } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  INTERACTIVE_SCAN_BUDGET_MS,
  LaboratoryStorageService,
} from '@BE/services/easy-genomics/laboratory-storage-service';
import { validateLaboratoryManagerAccess, validateOrganizationAdminAccess } from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const laboratoryStorageService = new LaboratoryStorageService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parseResult = RequestLaboratorySchema.safeParse(request);
    if (!parseResult.success) throw new InvalidRequestError();
    const { OrganizationId, LaboratoryId } = parseResult.data;

    if (
      !(
        validateOrganizationAdminAccess(event, OrganizationId) ||
        validateLaboratoryManagerAccess(event, OrganizationId, LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const laboratory = await laboratoryService.get(OrganizationId, LaboratoryId);
    const response: LaboratoryStorageSummary = await laboratoryStorageService.rescan(
      laboratory,
      INTERACTIVE_SCAN_BUDGET_MS,
    );
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
