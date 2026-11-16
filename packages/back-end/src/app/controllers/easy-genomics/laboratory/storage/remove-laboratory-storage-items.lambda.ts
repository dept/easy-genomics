import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RemoveLaboratoryStorageItemsMessage,
  RemoveLaboratoryStorageItemsResponse,
  RemoveLaboratoryStorageItemsSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SqsService } from '@BE/services/sqs-service';
import {
  validateLaboratoryManagerAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const sqsService = new SqsService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    const parseResult = RemoveLaboratoryStorageItemsSchema.safeParse(request);
    if (!parseResult.success) throw new InvalidRequestError();
    const { OrganizationId, LaboratoryId, ItemIds } = parseResult.data;

    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, OrganizationId) ||
        validateLaboratoryManagerAccess(event, OrganizationId, LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const laboratory = await laboratoryService.get(OrganizationId, LaboratoryId);
    if (!laboratory.S3Bucket) throw new InvalidRequestError('This lab has no default S3 bucket.');

    const queueUrl = process.env.SQS_LABORATORY_STORAGE_REMOVAL_QUEUE_URL || '';
    if (!queueUrl) throw new InvalidRequestError('Storage removal queue is not configured.');

    const message: RemoveLaboratoryStorageItemsMessage = { OrganizationId, LaboratoryId, ItemIds };
    await sqsService.sendMessage({
      QueueUrl: queueUrl,
      MessageGroupId: LaboratoryId,
      MessageDeduplicationId: uuidv4(),
      MessageBody: JSON.stringify(message),
    });

    const response: RemoveLaboratoryStorageItemsResponse = { Status: 'Queued' };
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
