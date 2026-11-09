import type { AttributeValue as DDBAttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { DynamoDBRecord, DynamoDBStreamEvent, Handler } from 'aws-lambda';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  isBelowRunFolderRoot,
  isWithinRunFolder,
  normalizeS3Prefix,
  parseS3ObjectUri,
  runFolderPrefix,
} from '@BE/utils/s3-uri-utils';

const laboratoryService = new LaboratoryService();
const laboratoryDataTaggingService = new LaboratoryDataTaggingService();

/**
 * DynamoDB Stream subscriber for the `laboratory-run-table`. Triggered on every change record;
 * REMOVE events (manual delete or TTL expiry) drive the bookkeeping half of the S3 deletion
 * cascade described in the "Permanent tag and S3 expiry" plan:
 *
 *   1. Unmarshal the OLD image of the removed run row.
 *   2. Leave each input file's `LaboratoryRunUsages` entry in place until the sweep deletes the
 *      file. A usage whose run row is gone is how the sweep recognises an expired input that
 *      never received a workflow tag.
 *   3. Record the run's output directory and generated sample sheet as a RUNOUTPUT# row
 *      (via `recordExpiredRunOutput`). The run record is the only place those locations are
 *      stored, so they must be captured here before the OLD image is discarded.
 *   4. The scheduled `process-expired-laboratory-data` Lambda deletes eligible FILE# rows and
 *      the recorded output prefixes, skipping anything marked Permanent.
 *
 * Distinguishing TTL vs manual delete: TTL removals are recorded with
 * `userIdentity.principalId === 'dynamodb.amazonaws.com'`. We log the source but treat both
 * the same way — the bookkeeping is identical.
 *
 * Idempotent and safe to retry. The Lambda is wired with a DLQ at the event source so poison
 * records don't block the stream.
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

  // Usages are intentionally not removed. The sweep is what deletes the file, and it needs the
  // usage (or a workflow tag) to tell a run input from a never-used upload.
  await recordRunOutputsForCleanup(laboratory, runId, run);
}

/**
 * Hands the run folder to the scheduled sweep. The sweep deletes every object under
 * `{org}/{lab}/{platform}/{runId}/` except ones marked Permanent. `OutputPrefix` is still only
 * a subdirectory: `outdir` is a user-editable workflow parameter, and storing the run folder
 * root (or anything outside it) as that prefix would let a bad value widen the delete.
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

  const parsedInput = parseS3ObjectUri(run.InputS3Url);
  const folderCandidate =
    (outputPrefix && runFolderPrefix(outputPrefix, runId)) ||
    (sampleSheetKey && runFolderPrefix(sampleSheetKey, runId)) ||
    (parsedInput?.bucket === bucket ? runFolderPrefix(parsedInput.prefix, runId) : undefined);
  const folder =
    folderCandidate && isWithinRunFolder(folderCandidate, laboratory, runId) ? folderCandidate : undefined;

  if (!outputPrefix && !sampleSheetKey && !folder) return;

  await laboratoryDataTaggingService.recordExpiredRunOutput(laboratory.LaboratoryId, {
    RunId: runId,
    S3Bucket: bucket,
    ...(outputPrefix ? { OutputPrefix: outputPrefix } : {}),
    ...(sampleSheetKey ? { SampleSheetKeys: [sampleSheetKey] } : {}),
    ...(folder ? { RunFolderPrefix: folder } : {}),
    RecordedAt: new Date().toISOString(),
  });
}
