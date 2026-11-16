import {
  RemoveLaboratoryStorageItemsMessage,
  RemoveLaboratoryStorageItemsMessageSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryStorageService } from '@BE/services/easy-genomics/laboratory-storage-service';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const laboratoryService = new LaboratoryService();
const laboratoryStorageService = new LaboratoryStorageService();

/**
 * Deletes selected lab-storage inventory items from S3 and cleans up FILE# rows.
 * Invoked by the laboratory-storage-removal FIFO queue so the HTTP remove route
 * never holds the API Gateway timeout while objects are deleted.
 */
export const handler: Handler = async (event: SQSEvent): Promise<void> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const raw = parseSqsJsonBody<unknown>(record.body);
    const parsed = RemoveLaboratoryStorageItemsMessageSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Invalid storage removal message; dropping', parsed.error.issues);
      continue;
    }
    const message: RemoveLaboratoryStorageItemsMessage = parsed.data;

    try {
      const laboratory = await laboratoryService.get(message.OrganizationId, message.LaboratoryId);
      const result = await laboratoryStorageService.removeItems(laboratory, message.ItemIds);
      console.log('Storage removal complete', {
        LaboratoryId: message.LaboratoryId,
        ItemIds: message.ItemIds,
        DeletedObjectCount: result.DeletedObjectCount,
        SkippedObjectCount: result.SkippedObjectCount,
      });
    } catch (err) {
      console.error(
        `Storage removal failed for lab ${message.LaboratoryId} items=${message.ItemIds.join(',')}:`,
        err,
      );
      throw err;
    }
  }
};
