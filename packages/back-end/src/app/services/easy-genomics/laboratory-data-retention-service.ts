import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  LaboratoryDataTaggingService,
  permanentTagIdForLaboratory,
} from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { S3Service } from '@BE/services/s3-service';
import {
  isBelowRunFolderRoot,
  isRunFolderName,
  isSampleSheetKey,
  isWithinRunFolder,
  laboratoryPrefix,
  lastPathSegment,
  normalizeS3Prefix,
  parseS3ObjectUri,
} from '@BE/utils/s3-uri-utils';

/** S3 `DeleteObjects` accepts at most 1000 keys per request. */
const S3_DELETE_BATCH_SIZE = 1000;

/** Run folders sit at `{org}/{lab}/{platform}/{runId}/`; older data may omit the platform level. */
const MAX_RUN_FOLDER_DEPTH = 2;

/**
 * How long every object in a run folder must have been untouched before the folder is treated as
 * orphaned. Uploads land in the folder *before* the run record exists, so a shorter window would
 * let the reconciliation pass schedule a user's in-progress upload for deletion. This is a
 * correctness invariant of that pass rather than an operational dial, so it is not configurable.
 */
const ORPHAN_SCAN_MIN_AGE_DAYS = 30;

export type RetentionSweepOptions = {
  /** Only `false` enables real deletes; anything else audits. */
  dryRun: boolean;
  /** Caps objects deleted per lab per invocation, shared across input files and outputs. */
  maxDeletesPerLab: number;
  /** Caps previously-unseen run folders inspected per lab per invocation. */
  maxOrphanFoldersPerLab: number;
  /** Deletes run outputs / sample sheets recorded as RUNOUTPUT# rows. */
  outputDeletionEnabled: boolean;
  /** Discovers outputs orphaned by runs that expired before the cascade existed. */
  orphanReconciliationEnabled: boolean;
};

export type RetentionSweepStats = {
  eligible: number;
  deleted: number;
  permanentProtected: number;
  outputPrefixesDeleted: number;
  outputObjectsDeleted: number;
  outputObjectsProtected: number;
  sampleSheetsDeleted: number;
  outputPrefixesSkippedInUse: number;
  orphanFoldersScanned: number;
  orphanFoldersRecorded: number;
  errors: number;
  hitDeleteCap: boolean;
};

export function emptyRetentionSweepStats(): RetentionSweepStats {
  return {
    eligible: 0,
    deleted: 0,
    permanentProtected: 0,
    outputPrefixesDeleted: 0,
    outputObjectsDeleted: 0,
    outputObjectsProtected: 0,
    sampleSheetsDeleted: 0,
    outputPrefixesSkippedInUse: 0,
    orphanFoldersScanned: 0,
    orphanFoldersRecorded: 0,
    errors: 0,
    hitDeleteCap: false,
  };
}

/** Everything a surviving run still points at. Absence from these sets authorises deletion. */
type LiveRunReferences = {
  runIds: Set<string>;
  outputPrefixes: string[];
  sampleSheetKeys: Set<string>;
};

/** FILE#-row state for a lab, loaded once and shared by all three phases. */
type FileRowIndex = {
  rows: Awaited<ReturnType<LaboratoryDataTaggingService['listAllFileRowsForLab']>>;
  trackedKeys: Set<string>;
  permanentKeys: Set<string>;
  refByKey: Map<string, string>;
};

/**
 * Owns the S3 deletion half of the run-retention cascade. Extracted from the scheduled Lambda so
 * the handler stays a thin controller (see `docs/development/contributing.md`) and so this policy
 * — orphan discovery, live-reference arbitration, delete budgeting, marker lifecycle — is unit
 * testable without going through the handler.
 */
export class LaboratoryDataRetentionService {
  private readonly s3Service: S3Service;
  private readonly taggingService: LaboratoryDataTaggingService;
  private readonly runService: LaboratoryRunService;

  public constructor(deps?: {
    s3Service?: S3Service;
    taggingService?: LaboratoryDataTaggingService;
    runService?: LaboratoryRunService;
  }) {
    this.s3Service = deps?.s3Service ?? new S3Service();
    this.taggingService = deps?.taggingService ?? new LaboratoryDataTaggingService();
    this.runService = deps?.runService ?? new LaboratoryRunService();
  }

  /**
   * Runs all three retention phases for one laboratory: the FILE#-row input sweep, orphan
   * reconciliation, then the recorded-output sweep. Reconciliation runs before the output sweep so
   * anything it finds is deleted in the same invocation.
   */
  public async sweepLaboratory(laboratory: Laboratory, options: RetentionSweepOptions): Promise<RetentionSweepStats> {
    const stats = emptyRetentionSweepStats();
    if (!laboratory.S3Bucket) return stats;

    const fileRows = await this.loadFileRowIndex(laboratory);
    await this.sweepInputFiles(laboratory, options, fileRows, stats);

    if (!options.outputDeletionEnabled && !options.orphanReconciliationEnabled) return stats;

    // Fail closed: every output decision below is "no surviving run references this, so delete
    // it". Without a complete live set that inference is unsound, so a failed load skips the
    // destructive phases for this lab rather than proceeding on partial data.
    let liveReferences: LiveRunReferences;
    try {
      liveReferences = await this.loadLiveRunReferences(laboratory.LaboratoryId);
    } catch (err) {
      console.error(
        `  Skipping output retention for lab ${laboratory.LaboratoryId}: could not establish the set of surviving runs:`,
        err,
      );
      stats.errors++;
      return stats;
    }

    if (options.orphanReconciliationEnabled) {
      await this.reconcileOrphanedRunFolders(laboratory, options, liveReferences, fileRows, stats);
    }
    if (options.outputDeletionEnabled) {
      await this.sweepRunOutputs(laboratory, options, liveReferences, fileRows, stats);
    }

    return stats;
  }

  private async loadFileRowIndex(laboratory: Laboratory): Promise<FileRowIndex> {
    const rows = await this.taggingService.listAllFileRowsForLab(laboratory.LaboratoryId);
    const permanentTagId = permanentTagIdForLaboratory(laboratory.LaboratoryId);

    const trackedKeys = new Set<string>();
    const permanentKeys = new Set<string>();
    const refByKey = new Map<string, string>();

    for (const row of rows) {
      if (!row.ObjectKey) continue;
      trackedKeys.add(row.ObjectKey);
      refByKey.set(row.ObjectKey, row.Ref);
      if ((row.TagIds || []).includes(permanentTagId)) permanentKeys.add(row.ObjectKey);
    }

    return { rows, trackedKeys, permanentKeys, refByKey };
  }

  /**
   * Input files are shared between runs and tracked per-file, so they are deleted only when their
   * FILE# row shows no remaining usages, carries a workflow tag (proving it was once used, which
   * distinguishes an expired file from a never-used orphan) and is not marked Permanent.
   */
  private async sweepInputFiles(
    laboratory: Laboratory,
    options: RetentionSweepOptions,
    fileRows: FileRowIndex,
    stats: RetentionSweepStats,
  ): Promise<void> {
    const permanentTagId = permanentTagIdForLaboratory(laboratory.LaboratoryId);
    const workflowTagIds = await this.loadWorkflowTagIds(laboratory.LaboratoryId);
    let loggedDeleteCap = false;

    for (const row of fileRows.rows) {
      const tagIds = new Set<string>(row.TagIds || []);
      const hasUsages = !!row.LaboratoryRunUsages && Object.keys(row.LaboratoryRunUsages).length > 0;
      const hasWorkflowTag = [...tagIds].some((id) => workflowTagIds.has(id));

      if (!hasWorkflowTag) continue;
      if (hasUsages) continue;
      if (tagIds.has(permanentTagId)) {
        stats.permanentProtected++;
        continue;
      }

      stats.eligible++;

      const bucket = row.S3Bucket || laboratory.S3Bucket!;
      const key = row.ObjectKey;
      if (!bucket || !key) continue;

      if (options.dryRun) {
        console.log(`  [dry-run] Would delete s3://${bucket}/${key} (lab=${laboratory.LaboratoryId})`);
        continue;
      }

      if (stats.deleted >= options.maxDeletesPerLab) {
        stats.hitDeleteCap = true;
        if (!loggedDeleteCap) {
          loggedDeleteCap = true;
          console.warn(
            `Lab ${laboratory.LaboratoryId} reached MAX_DELETES_PER_LAB_SWEEP=${options.maxDeletesPerLab}; remaining eligible rows left for a future run.`,
          );
        }
        continue;
      }

      try {
        await this.taggingService.assertLaboratoryHasS3BucketAccess(laboratory, bucket);
        this.taggingService.assertKeyUnderLabPrefix(laboratory, key);
      } catch (guardErr) {
        console.warn(
          `  Skip delete s3://${bucket}/${key} (lab=${laboratory.LaboratoryId}): bucket/key guard failed:`,
          guardErr,
        );
        stats.errors++;
        continue;
      }

      try {
        await this.s3Service.deleteObject({ Bucket: bucket, Key: key });
        await this.taggingService.deleteFileRowAndAssociations(laboratory.LaboratoryId, row.Ref);
        stats.deleted++;
      } catch (err) {
        console.warn(`  Error deleting s3://${bucket}/${key} (lab=${laboratory.LaboratoryId}):`, err);
        stats.errors++;
      }
    }

    console.log(
      `Lab ${laboratory.LaboratoryId} sweep complete: eligible=${stats.eligible} deleted=${stats.deleted} permanentProtected=${stats.permanentProtected} errors=${stats.errors}`,
    );
  }

  private async loadWorkflowTagIds(laboratoryId: string): Promise<Set<string>> {
    const { Tags } = await this.taggingService.listTags(laboratoryId);
    const workflowTagIds = new Set<string>();
    for (const tag of Tags || []) {
      const kind = tag.Kind ?? 'standard';
      if (kind === 'workflow' || !!(tag.Platform && tag.WorkflowExternalId)) workflowTagIds.add(tag.TagId);
    }
    return workflowTagIds;
  }

  /**
   * Collects every S3 location a surviving run still points at. Uses the paginated run query:
   * `queryByLaboratoryId` returns only the first 1MB page, and a run missing from a truncated page
   * would read as "expired", authorising deletion of a live run's data.
   */
  private async loadLiveRunReferences(laboratoryId: string): Promise<LiveRunReferences> {
    const runs = await this.runService.listAllRunsForLaboratory(laboratoryId);

    const runIds = new Set<string>();
    const outputPrefixes: string[] = [];
    const sampleSheetKeys = new Set<string>();

    for (const run of runs) {
      if (run.RunId) runIds.add(run.RunId);

      const output = parseS3ObjectUri(run.OutputS3Url);
      if (output) outputPrefixes.push(normalizeS3Prefix(output.prefix));

      // Legacy runs store the folder they publish into as InputS3Url and may have no OutputS3Url.
      // Treat that location as live too so a marker overlapping it is not deleted underneath them.
      const input = parseS3ObjectUri(run.InputS3Url);
      if (input) outputPrefixes.push(normalizeS3Prefix(input.prefix));

      // Retries prefill from the failed run and copy `SampleSheetS3Url` verbatim, so a live run's
      // sheet can physically live inside an *expired* run's folder. Tracked separately from
      // output prefixes, which would not cover it.
      const sampleSheet = parseS3ObjectUri(run.SampleSheetS3Url);
      if (sampleSheet) sampleSheetKeys.add(sampleSheet.prefix);
    }

    return { runIds, outputPrefixes, sampleSheetKeys };
  }

  /**
   * Finds run output data orphaned by runs that expired before this cascade existed, and records
   * it as RUNOUTPUT# rows for `sweepRunOutputs` to delete.
   *
   * Those runs' records were removed by TTL without anything capturing `OutputS3Url` /
   * `SampleSheetS3Url`, so their outputs are still in the bucket — invisible in the UI and still
   * billing. With the records gone, the only way to find that data is to reconcile the bucket
   * against surviving runs: a UUID-named folder no live run claims belonged to a run that has
   * since expired or been deleted.
   *
   * This only ever *records*; deletion stays on the single audited path in `sweepRunOutputs`.
   */
  private async reconcileOrphanedRunFolders(
    laboratory: Laboratory,
    options: RetentionSweepOptions,
    live: LiveRunReferences,
    fileRows: FileRowIndex,
    stats: RetentionSweepStats,
  ): Promise<void> {
    const bucket = laboratory.S3Bucket!;
    if (options.maxOrphanFoldersPerLab === 0) return;

    const cutoff = new Date(Date.now() - ORPHAN_SCAN_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
    const knownRunIds = new Set(
      (await this.taggingService.listExpiredRunOutputsForLab(laboratory.LaboratoryId)).map((r) => r.RunId),
    );

    const runFolders = await this.discoverRunFolders(bucket, laboratoryPrefix(laboratory));

    for (const runFolder of runFolders) {
      const runId = lastPathSegment(runFolder);
      if (live.runIds.has(runId) || knownRunIds.has(runId)) continue;
      if (stats.orphanFoldersScanned >= options.maxOrphanFoldersPerLab) break;
      stats.orphanFoldersScanned++;

      try {
        const objects = await this.s3Service.listAllObjectsUnderPrefix(bucket, runFolder);
        if (!objects.length) continue;

        const newest = objects.reduce<Date | undefined>(
          (acc, o) => (o.LastModified && (!acc || o.LastModified > acc) ? o.LastModified : acc),
          undefined,
        );
        // An unknown timestamp counts as "too recent": a folder we cannot age is not one to
        // schedule. Deliberately left unrecorded so it is re-evaluated once it ages.
        if (!newest || newest > cutoff) continue;

        const resultsPrefix = `${runFolder}results/`;
        const resultsObjects = objects.filter((o) => o.Key.startsWith(resultsPrefix));
        // Anything tracked under results/ may be tagged or shared, so leave the whole prefix to
        // the FILE#-row sweep rather than blanket-deleting around it.
        const resultsAreTracked = resultsObjects.some((o) => fileRows.trackedKeys.has(o.Key));
        const outputPrefix = resultsObjects.length && !resultsAreTracked ? resultsPrefix : undefined;

        const sampleSheetKeys = objects
          .map((o) => o.Key)
          .filter(
            (key) =>
              isSampleSheetKey(key, runFolder) && !fileRows.trackedKeys.has(key) && !live.sampleSheetKeys.has(key),
          );

        const hasWork = !!outputPrefix || sampleSheetKeys.length > 0;

        if (options.dryRun) {
          if (hasWork) {
            console.log(
              `  [dry-run] Would record orphaned RunId=${runId}: results=${outputPrefix ? resultsObjects.length : 0} sampleSheets=${sampleSheetKeys.length}`,
            );
            stats.orphanFoldersRecorded++;
          }
          continue;
        }

        // Folders with nothing deletable still get a row (immediately completed) so this pass does
        // not re-list them every subsequent night.
        const now = new Date().toISOString();
        await this.taggingService.recordExpiredRunOutput(laboratory.LaboratoryId, {
          RunId: runId,
          S3Bucket: bucket,
          ...(outputPrefix ? { OutputPrefix: outputPrefix } : {}),
          ...(sampleSheetKeys.length ? { SampleSheetKeys: sampleSheetKeys } : {}),
          RecordedAt: now,
          ...(hasWork ? {} : { CompletedAt: now }),
        });
        if (hasWork) stats.orphanFoldersRecorded++;
      } catch (err) {
        console.warn(`  Error reconciling ${runFolder} (lab=${laboratory.LaboratoryId}):`, err);
        stats.errors++;
      }
    }

    if (stats.orphanFoldersScanned) {
      console.log(
        `Lab ${laboratory.LaboratoryId} orphan reconciliation: scanned=${stats.orphanFoldersScanned} recorded=${stats.orphanFoldersRecorded}`,
      );
    }
  }

  /**
   * Deletes the outputs and sample sheets recorded as RUNOUTPUT# rows. Everything under the
   * recorded prefix goes, including the `results/` placeholder object when one exists.
   *
   * A marker is only stamped complete once everything it points at is gone, so a sweep that stops
   * early on the delete budget resumes cleanly next time.
   */
  private async sweepRunOutputs(
    laboratory: Laboratory,
    options: RetentionSweepOptions,
    live: LiveRunReferences,
    fileRows: FileRowIndex,
    stats: RetentionSweepStats,
  ): Promise<void> {
    const pending = (await this.taggingService.listExpiredRunOutputsForLab(laboratory.LaboratoryId)).filter(
      (row) => !row.CompletedAt,
    );
    if (!pending.length) return;

    let remaining = Math.max(0, options.maxDeletesPerLab - stats.deleted);

    for (const row of pending) {
      const bucket = row.S3Bucket || laboratory.S3Bucket!;

      // Re-validate at delete time, not just at write time. The writer's fence does not protect
      // the deleter from a malformed or hand-edited row, and this is the step that is irreversible.
      try {
        await this.taggingService.assertLaboratoryHasS3BucketAccess(laboratory, bucket);
        if (row.OutputPrefix && !isBelowRunFolderRoot(row.OutputPrefix, laboratory, row.RunId)) {
          throw new Error(`OutputPrefix '${row.OutputPrefix}' is not a subdirectory of run ${row.RunId}'s folder`);
        }
        for (const sheetKey of row.SampleSheetKeys || []) {
          if (!isWithinRunFolder(sheetKey, laboratory, row.RunId)) {
            throw new Error(`Sample sheet '${sheetKey}' is outside run ${row.RunId}'s folder`);
          }
        }
      } catch (guardErr) {
        console.warn(
          `  Skip output cleanup for RunId=${row.RunId} (lab=${laboratory.LaboratoryId}): guard failed:`,
          guardErr,
        );
        stats.errors++;
        continue;
      }

      if (row.OutputPrefix && this.isPrefixStillInUse(row.OutputPrefix, live.outputPrefixes)) {
        // A surviving run (e.g. a HealthOmics retry reusing the same outdir) still publishes here.
        // Leave the marker; it is re-evaluated once that run expires too.
        stats.outputPrefixesSkippedInUse++;
        continue;
      }

      if (remaining <= 0) {
        stats.hitDeleteCap = true;
        break;
      }

      try {
        const listed = row.OutputPrefix
          ? await this.s3Service.listAllObjectKeysUnderPrefix(bucket, row.OutputPrefix)
          : [];
        const sheetKeys = (row.SampleSheetKeys || []).filter(
          (key) => !live.sampleSheetKeys.has(key) && !this.isPrefixStillInUse(key, live.outputPrefixes),
        );
        stats.outputPrefixesSkippedInUse += (row.SampleSheetKeys || []).length - sheetKeys.length;

        // Files under results/ are taggable through the File Manager API, so the Permanent tag has
        // to be honoured here too — otherwise prefix deletion silently overrides the protection
        // the FILE#-row sweep enforces.
        const candidates = [...listed, ...sheetKeys];
        const keys = candidates.filter((key) => !fileRows.permanentKeys.has(key));
        stats.outputObjectsProtected += candidates.length - keys.length;

        if (!keys.length) {
          if (!options.dryRun) {
            await this.taggingService.markExpiredRunOutputCompleted(laboratory.LaboratoryId, row.RunId);
          }
          continue;
        }

        if (options.dryRun) {
          console.log(
            `  [dry-run] Would delete ${keys.length} object(s) for RunId=${row.RunId} under s3://${bucket}/${row.OutputPrefix ?? ''} (lab=${laboratory.LaboratoryId})`,
          );
          continue;
        }

        const batch = keys.slice(0, remaining);
        if (batch.length < keys.length) stats.hitDeleteCap = true;

        const removed = await this.deleteKeysInBatches(bucket, batch);
        remaining -= removed;
        stats.outputObjectsDeleted += removed;
        stats.sampleSheetsDeleted += sheetKeys.filter((k) => batch.includes(k)).length;

        // Drop FILE# rows for any deleted object that had one, so the tagging table does not keep
        // pointing at objects that no longer exist.
        for (const key of batch) {
          const ref = fileRows.refByKey.get(key);
          if (ref) await this.taggingService.deleteFileRowAndAssociations(laboratory.LaboratoryId, ref);
        }

        // Only retire the marker when everything deletable drained; otherwise the next sweep
        // resumes. Permanent-protected keys are intentionally retained and do not block this.
        if (removed === keys.length) {
          if (row.OutputPrefix) stats.outputPrefixesDeleted++;
          await this.taggingService.markExpiredRunOutputCompleted(laboratory.LaboratoryId, row.RunId);
        }
      } catch (err) {
        console.warn(`  Error deleting outputs for RunId=${row.RunId} (lab=${laboratory.LaboratoryId}):`, err);
        stats.errors++;
      }
    }

    console.log(
      `Lab ${laboratory.LaboratoryId} output sweep complete: prefixesDeleted=${stats.outputPrefixesDeleted} objectsDeleted=${stats.outputObjectsDeleted} protected=${stats.outputObjectsProtected} sampleSheetsDeleted=${stats.sampleSheetsDeleted} skippedInUse=${stats.outputPrefixesSkippedInUse} errors=${stats.errors}`,
    );
  }

  private isPrefixStillInUse(candidate: string, livePrefixes: string[]): boolean {
    const normalized = normalizeS3Prefix(candidate);
    return livePrefixes.some((live) => live.startsWith(normalized) || normalized.startsWith(live));
  }

  /**
   * Walks down from the laboratory prefix collecting UUID-named folders. Descending by common
   * prefix rather than assuming `{platform}/{runId}` keeps this working for older data written
   * before the platform path segment existed.
   */
  private async discoverRunFolders(bucket: string, prefix: string): Promise<string[]> {
    const runFolders: string[] = [];
    let frontier = [prefix];

    for (let depth = 0; depth < MAX_RUN_FOLDER_DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const child of await this.s3Service.listChildPrefixes(bucket, current)) {
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

  /** Returns the number of keys S3 confirmed deleted; per-key errors are logged and not counted. */
  private async deleteKeysInBatches(bucket: string, keys: string[]): Promise<number> {
    let removed = 0;

    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH_SIZE) {
      const chunk = keys.slice(i, i + S3_DELETE_BATCH_SIZE);
      const response = await this.s3Service.deleteObjects({
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
}
