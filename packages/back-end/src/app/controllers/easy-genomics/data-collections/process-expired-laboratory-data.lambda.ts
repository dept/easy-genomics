import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { Handler, ScheduledEvent } from 'aws-lambda';
import {
  LaboratoryDataTaggingService,
  permanentTagIdForLaboratory,
} from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import { normalizeS3Prefix, parseS3Uri } from '@BE/utils/s3-uri-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const dataTaggingService = new LaboratoryDataTaggingService();
const s3Service = new S3Service();

/** S3 `DeleteObjects` accepts at most 1000 keys per request. */
const S3_DELETE_BATCH_SIZE = 1000;

const METRIC_NAMESPACE = 'EasyGenomics/DataRetention';

/** Upload transaction ids (which double as run ids) are UUIDs; anything else is not a run folder. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches `buildSampleSheetFileName` output: `samplesheet.csv` or `samplesheet-{run name}.csv`. */
const SAMPLE_SHEET_PATTERN = /^samplesheet[^/]*\.csv$/i;

/** Run folders sit at `{org}/{lab}/{platform}/{runId}/`; older data may omit the platform level. */
const MAX_RUN_FOLDER_DEPTH = 2;

function parseMaxDeletesPerLabSweep(): number {
  const raw = process.env.MAX_DELETES_PER_LAB_SWEEP;
  if (raw == null || raw === '') return 25_000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 25_000;
  // `0` disables all per-lab deletes for this invocation (useful in emergencies).
  return n;
}

function parseNumericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * A run folder is only considered orphaned once every object in it has gone quiet for this long.
 * Uploads land in the folder *before* the run record exists, so without this a user who uploaded
 * files but has not launched their run yet would have their data scheduled for deletion.
 */
function orphanScanMinAgeDays(): number {
  return parseNumericEnv('ORPHAN_SCAN_MIN_AGE_DAYS', 30);
}

/** Caps how many previously-unseen run folders one invocation will inspect per lab. */
function maxOrphanFoldersPerLabSweep(): number {
  return parseNumericEnv('MAX_ORPHAN_FOLDERS_PER_LAB_SWEEP', 500);
}

/**
 * Scheduled (daily) Lambda that performs the S3 deletion half of the run-retention cascade
 * described in the "Permanent tag and S3 expiry" plan.
 *
 * Eligibility for deletion (per file row in the data tagging table):
 *   1. `LaboratoryRunUsages` is empty or absent
 *      (the DynamoDB-stream subscriber removes usages as their run rows TTL out).
 *   2. The file row carries at least one workflow tag id in `TagIds`
 *      — proves the file was once associated with a run; distinguishes "expired" from
 *      "never-used orphan" (orphans are intentionally NOT auto-deleted per the plan).
 *   3. The file row does NOT carry the laboratory's singleton permanent tag id.
 *
 * Run outputs are handled separately from input files. Outputs and the generated sample sheet
 * live inside the run's own `{org}/{lab}/{platform}/{runId}/` folder and are owned by exactly one
 * run, so rather than being tracked per-file they are deleted by prefix from the RUNOUTPUT# rows
 * that `process-laboratory-run-stream` records when a run row is removed. A prefix is skipped
 * while any surviving run still points at it, which keeps HealthOmics retries that reuse an
 * `outdir` from deleting a live run's results.
 *
 * A reconciliation pass runs first and covers runs that expired *before* this cascade existed.
 * Those runs left no RUNOUTPUT# row — their record was deleted by TTL without anything capturing
 * where the outputs lived — so the only way to find their data is to walk the bucket and look for
 * run folders that no surviving run claims. Reconciliation writes the same RUNOUTPUT# rows, so
 * everything is deleted through the single audited path below. See `reconcileOrphanedRunFolders`
 * for the guards that keep it from touching in-flight uploads or shared input files.
 *
 * Honors a DRY_RUN env flag for safe initial deploys: only the literal value `false` enables
 * real S3 and tagging-table deletes (any other value, including unset, runs in dry-run mode).
 * Optional `MAX_DELETES_PER_LAB_SWEEP` caps how many objects a single invocation may delete per
 * lab (defense in depth), shared across input files and output objects. Emits CloudWatch EMF
 * metrics under `EasyGenomics/DataRetention`.
 *
 * Triggered by an EventBridge Scheduled Rule (see `easy-genomics-nested-stack.ts`).
 */
export const handler: Handler<ScheduledEvent, void> = async (event: ScheduledEvent): Promise<void> => {
  const dryRun = process.env.DRY_RUN !== 'false';
  const maxDeletesPerLab = parseMaxDeletesPerLabSweep();
  console.log(`Starting expired laboratory data sweep (dryRun=${dryRun}, maxDeletesPerLab=${maxDeletesPerLab})`, {
    eventId: event?.id,
    time: event?.time,
  });

  let totalEligible = 0;
  let totalDeleted = 0;
  let totalPermanentProtected = 0;
  let totalErrors = 0;
  let totalLabsHitDeleteCap = 0;
  let totalOutputPrefixesDeleted = 0;
  let totalOutputObjectsDeleted = 0;
  let totalSampleSheetsDeleted = 0;
  let totalOutputPrefixesSkippedInUse = 0;
  let totalOrphanFoldersRecorded = 0;
  let totalOrphanFoldersScanned = 0;

  const laboratories = await laboratoryService.listAllLaboratories();
  for (const lab of laboratories) {
    try {
      const stats = await sweepLaboratory(lab, dryRun, maxDeletesPerLab);
      totalEligible += stats.eligible;
      totalDeleted += stats.deleted;
      totalPermanentProtected += stats.permanentProtected;
      totalErrors += stats.errors;

      // Discover pre-cascade orphans first so anything found is deleted in this same invocation.
      const orphanStats = await reconcileOrphanedRunFolders(lab, dryRun);
      totalOrphanFoldersRecorded += orphanStats.recorded;
      totalOrphanFoldersScanned += orphanStats.scanned;
      totalErrors += orphanStats.errors;

      // Outputs share the per-lab delete budget with input files so the cap still bounds the
      // total blast radius of a single invocation.
      const outputStats = await sweepLaboratoryRunOutputs(lab, dryRun, Math.max(0, maxDeletesPerLab - stats.deleted));
      totalOutputPrefixesDeleted += outputStats.prefixesDeleted;
      totalOutputObjectsDeleted += outputStats.objectsDeleted;
      totalSampleSheetsDeleted += outputStats.sampleSheetsDeleted;
      totalOutputPrefixesSkippedInUse += outputStats.skippedInUse;
      totalErrors += outputStats.errors;
      totalLabsHitDeleteCap += stats.hitDeleteCap || outputStats.hitDeleteCap ? 1 : 0;
    } catch (err) {
      console.error(`Sweep failed for lab ${lab.LaboratoryId} (continuing):`, err);
      totalErrors++;
    }
  }

  console.log('Expired laboratory data sweep summary:', {
    dryRun,
    laboratories: laboratories.length,
    eligible: totalEligible,
    deleted: totalDeleted,
    permanentProtected: totalPermanentProtected,
    outputPrefixesDeleted: totalOutputPrefixesDeleted,
    outputObjectsDeleted: totalOutputObjectsDeleted,
    sampleSheetsDeleted: totalSampleSheetsDeleted,
    outputPrefixesSkippedInUse: totalOutputPrefixesSkippedInUse,
    orphanFoldersScanned: totalOrphanFoldersScanned,
    orphanFoldersRecorded: totalOrphanFoldersRecorded,
    errors: totalErrors,
    labsHitDeleteCap: totalLabsHitDeleteCap,
  });

  emitEmfMetrics({
    Eligible: totalEligible,
    Deleted: totalDeleted,
    PermanentProtected: totalPermanentProtected,
    OutputPrefixesDeleted: totalOutputPrefixesDeleted,
    OutputObjectsDeleted: totalOutputObjectsDeleted,
    SampleSheetsDeleted: totalSampleSheetsDeleted,
    OutputPrefixesSkippedInUse: totalOutputPrefixesSkippedInUse,
    OrphanFoldersScanned: totalOrphanFoldersScanned,
    OrphanFoldersRecorded: totalOrphanFoldersRecorded,
    Errors: totalErrors,
    LabsHitDeleteCap: totalLabsHitDeleteCap,
  });
};

/**
 * Lab-scoped sweep. Walks every FILE# row, evaluates eligibility, deletes the S3 object and
 * tagging-table rows when applicable. Per-lab errors are counted but do not abort the rest of
 * the sweep.
 */
async function sweepLaboratory(
  laboratory: Laboratory,
  dryRun: boolean,
  maxDeletesPerLab: number,
): Promise<{
  eligible: number;
  deleted: number;
  permanentProtected: number;
  errors: number;
  hitDeleteCap: boolean;
}> {
  let eligible = 0;
  let deleted = 0;
  let permanentProtected = 0;
  let errors = 0;
  let hitDeleteCap = false;
  let loggedDeleteCap = false;

  if (!laboratory.S3Bucket) {
    return { eligible, deleted, permanentProtected, errors, hitDeleteCap };
  }

  const labPermanentTagId = permanentTagIdForLaboratory(laboratory.LaboratoryId);
  const { batchTagIds, workflowTagIds } = await loadKindIndexedTagIds(laboratory.LaboratoryId);

  const rows = await dataTaggingService.listAllFileRowsForLab(laboratory.LaboratoryId);

  for (const row of rows) {
    const tagIds = new Set<string>(row.TagIds || []);
    const isPermanent = tagIds.has(labPermanentTagId);
    const hasUsages = !!row.LaboratoryRunUsages && Object.keys(row.LaboratoryRunUsages).length > 0;
    const hasWorkflowTag = [...tagIds].some((id) => workflowTagIds.has(id));

    if (!hasWorkflowTag) continue; // Never-used orphan: not in scope for auto-delete.
    if (hasUsages) continue; // At least one run still retains this file.
    if (isPermanent) {
      permanentProtected++;
      continue;
    }

    eligible++;

    const bucket = row.S3Bucket || laboratory.S3Bucket;
    const key = row.ObjectKey;
    if (!bucket || !key) continue;

    if (dryRun) {
      console.log(`  [dry-run] Would delete s3://${bucket}/${key} (lab=${laboratory.LaboratoryId})`);
      continue;
    }

    if (deleted >= maxDeletesPerLab) {
      hitDeleteCap = true;
      if (!loggedDeleteCap) {
        loggedDeleteCap = true;
        console.warn(
          `Lab ${laboratory.LaboratoryId} reached MAX_DELETES_PER_LAB_SWEEP=${maxDeletesPerLab}; remaining eligible rows left for a future run.`,
        );
      }
      continue;
    }

    try {
      await dataTaggingService.assertLaboratoryHasS3BucketAccess(laboratory, bucket);
      dataTaggingService.assertKeyUnderLabPrefix(laboratory, key);
    } catch (guardErr) {
      console.warn(
        `  Skip delete s3://${bucket}/${key} (lab=${laboratory.LaboratoryId}): bucket/key guard failed:`,
        guardErr,
      );
      errors++;
      continue;
    }

    try {
      await s3Service.deleteObject({ Bucket: bucket, Key: key });
      // Standard tag and batch tag refs are also gone with the FILE# row; their MAP# rows are
      // cleaned up inside `deleteFileRowAndAssociations`, which adjusts each TAG#'s FileCount.
      void batchTagIds; // keep lint happy; batch ids are not consulted here but loaded above
      await dataTaggingService.deleteFileRowAndAssociations(laboratory.LaboratoryId, row.Ref);
      deleted++;
    } catch (err) {
      console.warn(`  Error deleting s3://${bucket}/${key} (lab=${laboratory.LaboratoryId}):`, err);
      errors++;
    }
  }

  console.log(
    `Lab ${laboratory.LaboratoryId} sweep complete: eligible=${eligible} deleted=${deleted} permanentProtected=${permanentProtected} errors=${errors}`,
  );

  return { eligible, deleted, permanentProtected, errors, hitDeleteCap };
}

/**
 * Deletes the output directories and generated sample sheets of runs that have already expired,
 * using the RUNOUTPUT# rows left behind by `process-laboratory-run-stream`. Everything under the
 * recorded prefix is removed, including the `results/` placeholder object itself when one exists.
 *
 * The marker row is only deleted once its objects are gone, so a sweep that stops early on the
 * delete budget resumes cleanly on the next run.
 */
async function sweepLaboratoryRunOutputs(
  laboratory: Laboratory,
  dryRun: boolean,
  deleteBudget: number,
): Promise<{
  prefixesDeleted: number;
  objectsDeleted: number;
  sampleSheetsDeleted: number;
  skippedInUse: number;
  errors: number;
  hitDeleteCap: boolean;
}> {
  let prefixesDeleted = 0;
  let objectsDeleted = 0;
  let sampleSheetsDeleted = 0;
  let skippedInUse = 0;
  let errors = 0;
  let hitDeleteCap = false;

  if (!laboratory.S3Bucket) {
    return { prefixesDeleted, objectsDeleted, sampleSheetsDeleted, skippedInUse, errors, hitDeleteCap };
  }

  const pending = (await dataTaggingService.listExpiredRunOutputsForLab(laboratory.LaboratoryId)).filter(
    (row) => !row.CompletedAt,
  );
  if (!pending.length) {
    return { prefixesDeleted, objectsDeleted, sampleSheetsDeleted, skippedInUse, errors, hitDeleteCap };
  }

  const livePrefixes = await loadLiveRunOutputPrefixes(laboratory.LaboratoryId);
  let remaining = deleteBudget;

  for (const row of pending) {
    const bucket = row.S3Bucket || laboratory.S3Bucket;

    try {
      await dataTaggingService.assertLaboratoryHasS3BucketAccess(laboratory, bucket);
      if (row.OutputPrefix) dataTaggingService.assertKeyUnderLabPrefix(laboratory, row.OutputPrefix);
      for (const sheetKey of row.SampleSheetKeys || []) {
        dataTaggingService.assertKeyUnderLabPrefix(laboratory, sheetKey);
      }
    } catch (guardErr) {
      console.warn(
        `  Skip output cleanup for RunId=${row.RunId} (lab=${laboratory.LaboratoryId}): bucket/key guard failed:`,
        guardErr,
      );
      errors++;
      continue;
    }

    if (row.OutputPrefix && isPrefixStillInUse(row.OutputPrefix, livePrefixes)) {
      // A surviving run (e.g. a HealthOmics retry that reused the same outdir) still publishes
      // here. Leave the marker in place; it is re-evaluated once that run expires too.
      skippedInUse++;
      continue;
    }

    if (remaining <= 0) {
      hitDeleteCap = true;
      break;
    }

    try {
      const keys = row.OutputPrefix ? await listAllKeysUnderPrefix(bucket, row.OutputPrefix) : [];
      keys.push(...(row.SampleSheetKeys || []));
      if (!keys.length) {
        if (!dryRun) await dataTaggingService.markExpiredRunOutputCompleted(laboratory.LaboratoryId, row.RunId);
        continue;
      }

      if (dryRun) {
        console.log(
          `  [dry-run] Would delete ${keys.length} object(s) for RunId=${row.RunId} under s3://${bucket}/${row.OutputPrefix ?? ''} (lab=${laboratory.LaboratoryId})`,
        );
        continue;
      }

      const batch = keys.slice(0, remaining);
      if (batch.length < keys.length) hitDeleteCap = true;

      const removed = await deleteKeysInBatches(bucket, batch);
      remaining -= removed;
      objectsDeleted += removed;
      sampleSheetsDeleted += (row.SampleSheetKeys || []).filter((k) => batch.includes(k)).length;

      // Only retire the marker when the whole prefix drained; otherwise the next sweep resumes.
      if (removed === keys.length) {
        if (row.OutputPrefix) prefixesDeleted++;
        await dataTaggingService.markExpiredRunOutputCompleted(laboratory.LaboratoryId, row.RunId);
      }
    } catch (err) {
      console.warn(`  Error deleting outputs for RunId=${row.RunId} (lab=${laboratory.LaboratoryId}):`, err);
      errors++;
    }
  }

  console.log(
    `Lab ${laboratory.LaboratoryId} output sweep complete: prefixesDeleted=${prefixesDeleted} objectsDeleted=${objectsDeleted} sampleSheetsDeleted=${sampleSheetsDeleted} skippedInUse=${skippedInUse} errors=${errors}`,
  );

  return { prefixesDeleted, objectsDeleted, sampleSheetsDeleted, skippedInUse, errors, hitDeleteCap };
}

/**
 * Finds run output data orphaned by runs that expired before this cascade existed, and records it
 * as RUNOUTPUT# rows for the sweep above to delete.
 *
 * Those runs' DynamoDB records were removed by TTL without anything capturing `OutputS3Url` /
 * `SampleSheetS3Url`, so their `results/` trees and sample sheets are still in the bucket —
 * invisible in the UI and still billing. With the run records gone, the only way to find that data
 * is to reconcile the bucket against the runs that survive: a UUID-named folder that no live run
 * claims belonged to a run that has since expired or been deleted.
 *
 * This only ever *records*; deletion stays on the single audited path in
 * `sweepLaboratoryRunOutputs`. Guards, cheapest first so the common cases cost no S3 calls:
 *   - the folder name must be a UUID (the upload transaction id, which is also the run id);
 *   - no surviving run may claim that run id;
 *   - a RUNOUTPUT# row must not already exist — including a completed one, which is how the pass
 *     remembers folders it has already handled instead of re-listing them every night;
 *   - every object in the folder must be older than `ORPHAN_SCAN_MIN_AGE_DAYS`, so an upload whose
 *     run has not been launched yet is never scheduled (these are deliberately left un-recorded so
 *     they are re-evaluated once they age);
 *   - only the `results/` subtree and root-level `samplesheet*.csv` files are recorded. Input files
 *     are left to the FILE#-row sweep, which owns their sharing and Permanent-tag rules;
 *   - any key tracked by a FILE# row is excluded, so tagged or still-shared data is left alone.
 */
async function reconcileOrphanedRunFolders(
  laboratory: Laboratory,
  dryRun: boolean,
): Promise<{ scanned: number; recorded: number; errors: number }> {
  let scanned = 0;
  let recorded = 0;
  let errors = 0;

  const bucket = laboratory.S3Bucket;
  if (!bucket) return { scanned, recorded, errors };

  const laboratoryPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  const cutoff = new Date(Date.now() - orphanScanMinAgeDays() * 24 * 60 * 60 * 1000);
  const folderBudget = maxOrphanFoldersPerLabSweep();
  if (folderBudget === 0) return { scanned, recorded, errors };

  let liveRunIds: Set<string>;
  let knownRunIds: Set<string>;
  let trackedKeys: Set<string>;
  try {
    liveRunIds = new Set((await laboratoryRunService.queryByLaboratoryId(laboratory.LaboratoryId)).map((r) => r.RunId));
    knownRunIds = new Set(
      (await dataTaggingService.listExpiredRunOutputsForLab(laboratory.LaboratoryId)).map((r) => r.RunId),
    );
    trackedKeys = new Set(
      (await dataTaggingService.listAllFileRowsForLab(laboratory.LaboratoryId)).map((row) => row.ObjectKey),
    );
  } catch (err) {
    console.warn(`  Orphan reconciliation skipped for lab ${laboratory.LaboratoryId} (state load failed):`, err);
    return { scanned, recorded, errors: errors + 1 };
  }

  const runFolders = await discoverRunFolders(bucket, laboratoryPrefix);

  for (const runFolder of runFolders) {
    const runId = lastPathSegment(runFolder);
    if (liveRunIds.has(runId) || knownRunIds.has(runId)) continue;
    if (scanned >= folderBudget) break;
    scanned++;

    try {
      const objects = await listObjectsWithMetadataUnderPrefix(bucket, runFolder);
      if (!objects.length) continue;

      const newest = objects.reduce<Date | undefined>(
        (acc, o) => (o.LastModified && (!acc || o.LastModified > acc) ? o.LastModified : acc),
        undefined,
      );
      // An unknown timestamp is treated as "too recent": a folder we cannot age is not one we
      // should schedule for deletion. Deliberately not recorded, so it is re-evaluated later.
      if (!newest || newest > cutoff) continue;

      const resultsPrefix = `${runFolder}results/`;
      const resultsObjects = objects.filter((o) => o.Key.startsWith(resultsPrefix));
      // If anything under results/ is a tracked file row it may be tagged or shared, so leave the
      // whole prefix to the FILE#-row sweep rather than blanket-deleting around it.
      const resultsAreTracked = resultsObjects.some((o) => trackedKeys.has(o.Key));
      const outputPrefix = resultsObjects.length && !resultsAreTracked ? resultsPrefix : undefined;

      const sampleSheetKeys = objects
        .map((o) => o.Key)
        .filter((key) => isSampleSheetKey(key, runFolder) && !trackedKeys.has(key));

      if (dryRun) {
        if (outputPrefix || sampleSheetKeys.length) {
          console.log(
            `  [dry-run] Would record orphaned RunId=${runId}: results=${outputPrefix ? resultsObjects.length : 0} sampleSheets=${sampleSheetKeys.length}`,
          );
          recorded++;
        }
        continue;
      }

      // Folders with nothing deletable still get a row (immediately completed) so this pass does
      // not re-list them on every subsequent night.
      const now = new Date().toISOString();
      const hasWork = !!outputPrefix || sampleSheetKeys.length > 0;
      await dataTaggingService.recordExpiredRunOutput(laboratory.LaboratoryId, {
        RunId: runId,
        S3Bucket: bucket,
        ...(outputPrefix ? { OutputPrefix: outputPrefix } : {}),
        ...(sampleSheetKeys.length ? { SampleSheetKeys: sampleSheetKeys } : {}),
        RecordedAt: now,
        ...(hasWork ? {} : { CompletedAt: now }),
      });
      if (hasWork) recorded++;
    } catch (err) {
      console.warn(`  Error reconciling ${runFolder} (lab=${laboratory.LaboratoryId}):`, err);
      errors++;
    }
  }

  if (scanned) {
    console.log(
      `Lab ${laboratory.LaboratoryId} orphan reconciliation: scanned=${scanned} recorded=${recorded} errors=${errors}`,
    );
  }

  return { scanned, recorded, errors };
}

export function lastPathSegment(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

export function isRunFolderName(name: string): boolean {
  return UUID_PATTERN.test(name);
}

export function isSampleSheetKey(key: string, runFolderPrefix: string): boolean {
  if (!key.startsWith(runFolderPrefix)) return false;
  const relative = key.slice(runFolderPrefix.length);
  return !relative.includes('/') && SAMPLE_SHEET_PATTERN.test(relative);
}

/**
 * Walks down from the laboratory prefix collecting UUID-named folders. Descending by common
 * prefix rather than assuming `{platform}/{runId}` keeps this working for older data written
 * before the platform path segment existed.
 */
async function discoverRunFolders(bucket: string, laboratoryPrefix: string): Promise<string[]> {
  const runFolders: string[] = [];
  let frontier = [laboratoryPrefix];

  for (let depth = 0; depth < MAX_RUN_FOLDER_DEPTH && frontier.length; depth++) {
    const next: string[] = [];
    for (const prefix of frontier) {
      for (const child of await listChildPrefixes(bucket, prefix)) {
        if (isRunFolderName(lastPathSegment(child))) {
          runFolders.push(child);
        } else {
          next.push(child);
        }
      }
    }
    frontier = next;
  }

  return runFolders;
}

/** Lists the immediate "directories" under a prefix (S3 common prefixes), following pagination. */
async function listChildPrefixes(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let continuationToken: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await s3Service.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    for (const common of response.CommonPrefixes || []) {
      if (common.Prefix) out.push(common.Prefix);
    }
    isTruncated = !!response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  return out;
}

async function listObjectsWithMetadataUnderPrefix(
  bucket: string,
  prefix: string,
): Promise<Array<{ Key: string; LastModified?: Date }>> {
  const out: Array<{ Key: string; LastModified?: Date }> = [];
  let continuationToken: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await s3Service.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    for (const object of response.Contents || []) {
      if (object.Key) out.push({ Key: object.Key, LastModified: object.LastModified });
    }
    isTruncated = !!response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  return out;
}

/**
 * Output prefixes of runs that still exist. A RUNOUTPUT# row whose prefix overlaps one of these
 * must not be deleted — the run that owns it has not expired.
 */
async function loadLiveRunOutputPrefixes(laboratoryId: string): Promise<string[]> {
  const runs = await laboratoryRunService.queryByLaboratoryId(laboratoryId);
  const prefixes: string[] = [];
  for (const run of runs) {
    const parsed = parseS3Uri(run.OutputS3Url);
    if (parsed) prefixes.push(normalizeS3Prefix(parsed.prefix));
  }
  return prefixes;
}

function isPrefixStillInUse(candidate: string, livePrefixes: string[]): boolean {
  const normalized = normalizeS3Prefix(candidate);
  return livePrefixes.some((live) => live.startsWith(normalized) || normalized.startsWith(live));
}

async function listAllKeysUnderPrefix(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await s3Service.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    for (const object of response.Contents || []) {
      if (object.Key) keys.push(object.Key);
    }
    isTruncated = !!response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  return keys;
}

/** Returns the number of keys S3 confirmed deleted; per-key errors are logged and not counted. */
async function deleteKeysInBatches(bucket: string, keys: string[]): Promise<number> {
  let removed = 0;

  for (let i = 0; i < keys.length; i += S3_DELETE_BATCH_SIZE) {
    const chunk = keys.slice(i, i + S3_DELETE_BATCH_SIZE);
    const response = await s3Service.deleteObjects({
      Bucket: bucket,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    });
    for (const failure of response.Errors || []) {
      console.warn(`  Failed to delete s3://${bucket}/${failure.Key}: ${failure.Code} ${failure.Message}`);
    }
    removed += chunk.length - (response.Errors?.length ?? 0);
  }

  return removed;
}

/**
 * Loads the laboratory's batch + workflow tag id sets so the sweep can identify
 * workflow-tagged files without re-loading TAG# rows per file. Mirrors the partition logic in
 * `LaboratoryDataTaggingService.listFileTags`.
 */
async function loadKindIndexedTagIds(
  laboratoryId: string,
): Promise<{ batchTagIds: Set<string>; workflowTagIds: Set<string> }> {
  const { Tags } = await dataTaggingService.listTags(laboratoryId);
  const batchTagIds = new Set<string>();
  const workflowTagIds = new Set<string>();
  for (const t of Tags) {
    const kind = t.Kind ?? 'standard';
    if (kind === 'batch') batchTagIds.add(t.TagId);
    else if (kind === 'workflow' || !!(t.Platform && t.WorkflowExternalId)) workflowTagIds.add(t.TagId);
  }
  return { batchTagIds, workflowTagIds };
}

/**
 * Emit a CloudWatch Embedded Metric Format (EMF) record so the metrics show up in CloudWatch
 * without taking a runtime dependency on `@aws-sdk/client-cloudwatch`. EMF is just a JSON
 * shape on a single log line that the CloudWatch agent recognises.
 */
function emitEmfMetrics(metrics: Record<string, number>): void {
  const metricNames = Object.keys(metrics);
  if (metricNames.length === 0) return;
  const record = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [[]],
          Metrics: metricNames.map((name) => ({ Name: name, Unit: 'Count' as const })),
        },
      ],
    },
    ...metrics,
  };
  console.log(JSON.stringify(record));
}
