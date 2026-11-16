import {
  EditLaboratoryStorageProtectionMessage,
  EditLaboratoryStorageProtectionMessageSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { Handler } from 'aws-lambda';
import { SQSEvent } from 'aws-lambda/trigger/sqs';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryStorageService } from '@BE/services/easy-genomics/laboratory-storage-service';
import { parseSqsJsonBody } from '@BE/utils/sqs-json-body';

const laboratoryService = new LaboratoryService();
const laboratoryStorageService = new LaboratoryStorageService();

/**
 * Applies or removes the Permanent tag on selected storage inventory items.
 * Invoked by the laboratory-storage-protection FIFO queue so the HTTP edit route
 * never holds the API Gateway timeout while tags are written.
 */
export const handler: Handler = async (event: SQSEvent): Promise<void> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const raw = parseSqsJsonBody<unknown>(record.body);
    const parsed = EditLaboratoryStorageProtectionMessageSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Invalid storage protection message; dropping', parsed.error.issues);
      continue;
    }
    const message: EditLaboratoryStorageProtectionMessage = parsed.data;

    try {
      const laboratory = await laboratoryService.get(message.OrganizationId, message.LaboratoryId);
      await laboratoryStorageService.setProtection(laboratory, message.ItemIds, message.Protected, message.UserId);
      console.log('Storage protection complete', {
        LaboratoryId: message.LaboratoryId,
        ItemIds: message.ItemIds,
        Protected: message.Protected,
      });
    } catch (err) {
      console.error(
        `Storage protection failed for lab ${message.LaboratoryId} items=${message.ItemIds.join(',')}:`,
        err,
      );
      throw err;
    }
  }
};
