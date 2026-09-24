import type { AttributeValue as DDBAttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { isBelowRunFolderRoot, isWithinRunFolder, normalizeS3Prefix, parseS3ObjectUri } from '@BE/utils/s3-uri-utils';

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
 *   3. Record the run's output directory and generated sample sheet as a RUNOUTPUT# row
 *      (via `recordExpiredRunOutput`). The run record is the only place those locations are
 *      stored, so they must be captured here before the OLD image is discarded.
 *   4. The scheduled `process-expired-laboratory-data` Lambda later picks up FILE# rows
 *      that have been left with no remaining usages and deletes the underlying S3 object
 *      (skipping anything marked Permanent), then deletes the recorded output prefixes.
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

  let laboratory: Laboratory | undefined;
  try {
    laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
  } catch (err) {
    if (err instanceof LaboratoryNotFoundError) {
      console.warn(
        `Skip cascade for RunId=${runId}: Laboratory ${laboratoryId} not found (run bookkeeping is a no-op).`,
      );
      return;
    }
    console.error(
      `Failed to load Laboratory ${laboratoryId} for RunId=${runId} cascade (will retry via stream/DLQ):`,
      err,
    );
    throw err;
  }
  if (!laboratory?.S3Bucket) {
    console.warn(`Skip cascade for RunId=${runId}: Laboratory ${laboratoryId} has no S3Bucket configured.`);
    return;
  }

  if (inputFileKeys.length) {
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

  await recordRunOutputsForCleanup(laboratory, runId, run);
}

/**
 * Hands the run's output directory and generated sample sheet to the scheduled sweep. Unlike
 * input files — which are shared between runs and tracked per-file in the tagging table — these
 * live inside the run's own `{org}/{lab}/{platform}/{runId}/` folder and are owned solely by it,
 * so they can be removed wholesale once the run expires.
 *
 * Locations are validated against the run's own folder before being recorded; a custom `outdir`
 * pointing elsewhere is skipped rather than scheduled for deletion. `outdir` is a user-editable
 * workflow parameter, so it must also point strictly *below* the run folder root: the root is
 * where the run's input files live, and prefix deletion is recursive.
 */
async function recordRunOutputsForCleanup(
  laboratory: Laboratory,
  runId: string,
  run: Partial<LaboratoryRun>,
): Promise<void> {
  const bucket = laboratory.S3Bucket!;

  const parsedOutput = parseS3ObjectUri(run.OutputS3Url);
  let outputPrefix: string | undefined;
  if (parsedOutput) {
    const candidate = normalizeS3Prefix(parsedOutput.prefix);
    if (parsedOutput.bucket !== bucket) {
      console.warn(`Skip output cleanup for RunId=${runId}: OutputS3Url bucket is not the laboratory bucket.`);
    } else if (!isBelowRunFolderRoot(candidate, laboratory, runId)) {
      console.warn(
        `Skip output cleanup for RunId=${runId}: OutputS3Url is not a subdirectory of the run's own folder.`,
      );
    } else {
      outputPrefix = candidate;
    }
  }

  const parsedSampleSheet = parseS3ObjectUri(run.SampleSheetS3Url);
  let sampleSheetKey: string | undefined;
  if (parsedSampleSheet) {
    if (parsedSampleSheet.bucket === bucket && isWithinRunFolder(parsedSampleSheet.prefix, laboratory, runId)) {
      sampleSheetKey = parsedSampleSheet.prefix;
    } else {
      console.warn(`Skip sample sheet cleanup for RunId=${runId}: not inside the run's own folder.`);
    }
  }

  if (!outputPrefix && !sampleSheetKey) return;

  await laboratoryDataTaggingService.recordExpiredRunOutput(laboratory.LaboratoryId, {
    RunId: runId,
    S3Bucket: bucket,
    ...(outputPrefix ? { OutputPrefix: outputPrefix } : {}),
    ...(sampleSheetKey ? { SampleSheetKeys: [sampleSheetKey] } : {}),
    RecordedAt: new Date().toISOString(),
  });
}
