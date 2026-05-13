import type { AttributeValue as DDBAttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';

const laboratoryService = new LaboratoryService();
const laboratoryDataTaggingService = new LaboratoryDataTaggingService();

/**
 * DynamoDB Stream subscriber for the `laboratory-run-table`. Triggered on every change record;
 * REMOVE events (manual delete or TTL expiry) drive the bookkeeping half of the S3 deletion
 * cascade described in the "Permanent tag and S3 expiry" plan:
 *
 *   1. Unmarshal the OLD image of the removed run row.
 *   2. Remove the run id from every input file's `LaboratoryRunUsages` map in the data
 *      tagging table (via `removeLaboratoryRunUsageForRunIds`).
 *   3. The scheduled `process-expired-laboratory-data` Lambda later picks up FILE# rows
 *      that have been left with no remaining usages and deletes the underlying S3 object
 *      (skipping anything marked Permanent).
 *
 * Distinguishing TTL vs manual delete: TTL removals are recorded with
 * `userIdentity.principalId === 'dynamodb.amazonaws.com'`. We log the source but treat both
 * the same way — the bookkeeping is identical.
 *
 * Idempotent and safe to retry: `removeLaboratoryRunUsageForRunIds` is conditional and silently
 * no-ops when the run id is already absent. The Lambda is wired with a DLQ at the event source
 * so poison records don't block the stream.
 */
export const handler: Handler<DynamoDBStreamEvent, void> = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records || []) {
    try {
      await processRecord(record);
    } catch (err) {
      // Surface a structured log so CloudWatch alarms can target this path; rethrow so the
      // event source can retry / route to the DLQ rather than silently dropping the change.
      console.error('Failed to process laboratory-run stream record:', {
        eventID: record.eventID,
        eventName: record.eventName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
};

async function processRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== 'REMOVE') {
    // INSERT/MODIFY events don't need handling here; tagging-side bookkeeping for new runs
    // already happens synchronously from create-laboratory-run / update-laboratory-run.
    return;
  }

  const oldImage = record.dynamodb?.OldImage;
  if (!oldImage) {
    console.warn(`REMOVE record without OldImage; skipping. eventID=${record.eventID}`);
    return;
  }

  // The DynamoDB stream record's image uses the same attribute-value shape as the SDK, but
  // typed as the `aws-lambda` package's local type. Cast through the SDK type so `unmarshall`
  // accepts it without losing field-level safety.
  const run = unmarshall(oldImage as Record<string, DDBAttributeValue>) as Partial<LaboratoryRun>;
  const laboratoryId = run.LaboratoryId;
  const runId = run.RunId;
  const inputFileKeys = Array.isArray(run.InputFileKeys) ? run.InputFileKeys : [];

  if (!laboratoryId || !runId) {
    console.warn(`REMOVE record missing LaboratoryId/RunId; skipping. eventID=${record.eventID}`);
    return;
  }

  const isTtlRemoval = record.userIdentity?.principalId === 'dynamodb.amazonaws.com';
  console.log(
    `Processing run-row REMOVE (${isTtlRemoval ? 'TTL' : 'manual/cascade'}): laboratoryId=${laboratoryId}, runId=${runId}, inputs=${inputFileKeys.length}`,
  );

  if (!inputFileKeys.length) {
    // Nothing to unlink in the tagging table.
    return;
  }

  let laboratory: Laboratory | undefined;
  try {
    laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
  } catch (err) {
    console.warn(`Skip cascade for RunId=${runId}: failed to load Laboratory ${laboratoryId} (continuing):`, err);
    return;
  }
  if (!laboratory?.S3Bucket) {
    console.warn(`Skip cascade for RunId=${runId}: Laboratory ${laboratoryId} has no S3Bucket configured.`);
    return;
  }

  await laboratoryDataTaggingService.removeLaboratoryRunUsageForRunIds(
    laboratory,
    laboratory.S3Bucket,
    {
      [runId]: inputFileKeys.filter((k): k is string => typeof k === 'string' && k.length > 0),
    },
    // Keep the FILE# row even when it ends up with no usages and no tags. The scheduled
    // cleanup Lambda needs the row (S3Bucket + ObjectKey) to issue the s3:DeleteObject; we
    // can't reconstruct it once both tables forget the file.
    { preserveEmptyFileRow: true },
  );
}
