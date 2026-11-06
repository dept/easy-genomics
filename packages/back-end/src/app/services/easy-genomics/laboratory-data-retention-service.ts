import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  LaboratoryDataTaggingService,
  permanentTagIdForLaboratory,
} from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { S3Service } from '@BE/services/s3-service';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  getTerminalAtIsoString,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '@BE/utils/laboratory-run-ttl-utils';
import {
  isBelowRunFolderRoot,
  isRunFolderFastqKey,
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

function orphanQuietCutoff(nowMs: number = Date.now()): Date {
  return new Date(nowMs - ORPHAN_SCAN_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export type ApplyRunRetentionResult = {
  terminalRuns: number;
  updated: number;
  removed: number;
  skipped: number;
  runsExpireImmediately: number;
  runsExpirationDateUpdated: number;
  deferred: number;
  hitDeadline: boolean;
};

/**
 * Rotates which laboratory is first so a lab that fills the whole invocation cannot starve the
 * others. The next scheduled run starts further along the same stable order.
 */
export function orderedLaboratoriesForSweep<T extends { LaboratoryId: string }>(
  laboratories: T[],
  eventTime?: string,
): T[] {
  if (laboratories.length <= 1) return laboratories;
  const sorted = [...laboratories].sort((a, b) => a.LaboratoryId.localeCompare(b.LaboratoryId));
  const parsed = eventTime ? new Date(eventTime) : new Date();
  const epochMs = Number.isNaN(parsed.getTime()) ? Date.now() : parsed.getTime();
  const start = Math.floor(epochMs / 86_400_000) % sorted.length;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

function pastDeadline(deadlineMs?: number): boolean {
  return deadlineMs != null && Date.now() >= deadlineMs;
}

/** Epoch ms when this invocation should stop, leaving `reserveMs` for the caller to finish. */
export function deadlineFromContext(
  context: { getRemainingTimeInMillis?: () => number } | undefined,
  reserveMs: number,
): number | undefined {
  if (context == null || typeof context.getRemainingTimeInMillis !== 'function') return undefined;
  const remaining = context.getRemainingTimeInMillis();
  if (!Number.isFinite(remaining)) return undefined;
  return Date.now() + Math.max(0, remaining - reserveMs);
}

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
  /** Stop cleanly before the Lambda is killed. Unset means run until the work is done. */
  deadlineMs?: number;
  /**
   * How long the first retention-metadata pass may spend writing before deletion runs.
   * A later pass uses whatever time is left after deletes. Unset means no slice limit.
   */
  retentionWriteSliceMs?: number;
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
  stoppedForDeadline: boolean;
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
    stoppedForDeadline: false,
  };
}

/** Everything a surviving run still points at. Absence from these sets authorises deletion. */
type LiveRunReferences = {
  runIds: Set<string>;
  outputPrefixes: string[];
  sampleSheetKeys: Set<string>;
  inputKeys: Set<string>;
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
   * Walks laboratories in the given order and stops before `options.deadlineMs`. One laboratory
   * throwing does not stop the others.
   */
  public async sweepAllLaboratories(
    laboratories: Laboratory[],
    options: RetentionSweepOptions,
  ): Promise<RetentionSweepStats & { labsHitDeleteCap: number }> {
    const totals = { ...emptyRetentionSweepStats(), labsHitDeleteCap: 0 };
    for (const laboratory of laboratories) {
      if (pastDeadline(options.deadlineMs)) {
        console.warn('Sweep stopping before timeout; remaining laboratories continue on the next run.');
        break;
      }
      try {
        const stats = await this.sweepLaboratory(laboratory, options);
        totals.eligible += stats.eligible;
        totals.deleted += stats.deleted;
        totals.permanentProtected += stats.permanentProtected;
        totals.outputPrefixesDeleted += stats.outputPrefixesDeleted;
        totals.outputObjectsDeleted += stats.outputObjectsDeleted;
        totals.outputObjectsProtected += stats.outputObjectsProtected;
        totals.sampleSheetsDeleted += stats.sampleSheetsDeleted;
        totals.outputPrefixesSkippedInUse += stats.outputPrefixesSkippedInUse;
        totals.orphanFoldersScanned += stats.orphanFoldersScanned;
        totals.orphanFoldersRecorded += stats.orphanFoldersRecorded;
        totals.errors += stats.errors;
        if (stats.hitDeleteCap) totals.labsHitDeleteCap++;
        if (stats.stoppedForDeadline) {
          console.warn('Sweep stopping before timeout; remaining laboratories continue on the next run.');
          break;
        }
      } catch (err) {
        console.error(`Sweep failed for lab ${laboratory.LaboratoryId} (continuing):`, err);
        totals.errors++;
      }
    }
    return totals;
  }

  /**
   * Runs all three retention phases for one laboratory: the FILE#-row input sweep, orphan
   * reconciliation, then the recorded-output sweep. Reconciliation runs before the output sweep so
   * anything it finds is deleted in the same invocation.
   */
  public async sweepLaboratory(laboratory: Laboratory, options: RetentionSweepOptions): Promise<RetentionSweepStats> {
    const stats = emptyRetentionSweepStats();
    if (!laboratory.S3Bucket) return stats;

    const runsForStamp = await this.loadRunsForSweep(laboratory.LaboratoryId, stats);

    let retentionDeferred = 0;
    if (runsForStamp && !pastDeadline(options.deadlineMs)) {
      const wrote = await this.applySweepRetention(laboratory, runsForStamp, options, options.retentionWriteSliceMs);
      retentionDeferred = wrote.deferred;
      this.logRetentionReconcile(laboratory.LaboratoryId, wrote);
      if (wrote.hitDeadline) {
        stats.stoppedForDeadline = true;
        return stats;
      }
    }

    const fileRows = await this.loadFileRowIndex(laboratory);
    // The stamp above can take the whole write slice. Reload so a run created in that window is
    // visible before any input is classified as stale.
    const runs = runsForStamp ? await this.loadRunsForSweep(laboratory.LaboratoryId, stats) : undefined;
    await this.sweepInputFiles(laboratory, options, fileRows, stats, runs);
    if (stats.stoppedForDeadline) return stats;

    if (runs && (options.outputDeletionEnabled || options.orphanReconciliationEnabled)) {
      const liveReferences = this.liveRunReferencesFrom(runs);
      if (options.orphanReconciliationEnabled) {
        await this.reconcileOrphanedRunFolders(laboratory, options, liveReferences, fileRows, stats);
      }
      if (!stats.stoppedForDeadline && options.outputDeletionEnabled) {
        await this.sweepRunOutputs(laboratory, options, liveReferences, fileRows, stats);
      }
    }

    if (runsForStamp && retentionDeferred > 0 && !stats.stoppedForDeadline && !pastDeadline(options.deadlineMs)) {
      const rest = await this.applySweepRetention(laboratory, runsForStamp, options);
      this.logRetentionReconcile(laboratory.LaboratoryId, rest);
      if (rest.hitDeadline) stats.stoppedForDeadline = true;
    }

    return stats;
  }

  private applySweepRetention(
    laboratory: Laboratory,
    runs: LaboratoryRun[],
    options: RetentionSweepOptions,
    maxWriteMs?: number,
  ): Promise<ApplyRunRetentionResult> {
    return this.applyRunRetentionPolicy(laboratory, getRetentionMonthsOrDefault(laboratory.RunRetentionMonths), {
      dryRun: options.dryRun,
      modifiedBy: 'Run Retention Sweep',
      deadlineMs: options.deadlineMs,
      maxWriteMs,
      runs,
    });
  }

  /** `undefined` means the load failed. Callers must not treat a missing run as permission to delete. */
  private async loadRunsForSweep(
    laboratoryId: string,
    stats: RetentionSweepStats,
  ): Promise<LaboratoryRun[] | undefined> {
    try {
      return await this.runService.listAllRunsForLaboratory(laboratoryId);
    } catch (err) {
      console.error(
        `  Skipping retention reconcile, stale-usage deletes, and output retention for lab ${laboratoryId}: could not load runs:`,
        err,
      );
      stats.errors++;
      return undefined;
    }
  }

  /**
   * Rewrites `ExpiresAt` on every terminal run so it matches the laboratory policy. Follows every
   * DynamoDB page. Writes stop at `deadlineMs` or after `maxWriteMs`, whichever comes first.
   * Runs left unwritten are reported as `deferred` and are safe to retry.
   */
  public async applyRunRetentionPolicy(
    laboratory: Laboratory,
    retentionMonths: number,
    options: {
      dryRun: boolean;
      modifiedBy: string;
      deadlineMs?: number;
      maxWriteMs?: number;
      runs?: LaboratoryRun[];
    },
  ): Promise<ApplyRunRetentionResult> {
    const result: ApplyRunRetentionResult = {
      terminalRuns: 0,
      updated: 0,
      removed: 0,
      skipped: 0,
      runsExpireImmediately: 0,
      runsExpirationDateUpdated: 0,
      deferred: 0,
      hitDeadline: false,
    };

    const runs = options.runs ?? (await this.runService.listAllRunsForLaboratory(laboratory.LaboratoryId));
    const terminalRuns = runs.filter((run) => isTerminalLaboratoryRunStatus(run.Status));
    result.terminalRuns = terminalRuns.length;
    const writeUntil = options.maxWriteMs != null ? Date.now() + options.maxWriteMs : undefined;

    for (const run of terminalRuns) {
      const now = new Date();
      const nowEpochSeconds = Math.floor(now.getTime() / 1000);
      const terminalAtIso = getTerminalAtIsoString(run, now);
      const needsTerminalAt = run.TerminalAt == null;
      const shouldHaveExpiry = shouldExpireWithRetentionMonths(retentionMonths);
      const desiredExpiresAt = shouldHaveExpiry
        ? calculateExpiresAtEpochSeconds(new Date(terminalAtIso), retentionMonths)
        : undefined;
      const needsExpiresAtSet = shouldHaveExpiry && run.ExpiresAt !== desiredExpiresAt;
      const needsExpiresAtRemove = !shouldHaveExpiry && run.ExpiresAt != null;

      if (!needsTerminalAt && !needsExpiresAtSet && !needsExpiresAtRemove) {
        result.skipped++;
        continue;
      }

      const countExpiry = (): void => {
        if (needsExpiresAtSet && desiredExpiresAt != null) {
          if (desiredExpiresAt <= nowEpochSeconds) result.runsExpireImmediately++;
          else result.runsExpirationDateUpdated++;
        } else if (needsExpiresAtRemove) {
          result.runsExpirationDateUpdated++;
        }
      };

      if (options.dryRun) {
        countExpiry();
        if (needsExpiresAtRemove) result.removed++;
        if (needsTerminalAt || needsExpiresAtSet) result.updated++;
        continue;
      }

      const sliceElapsed = writeUntil != null && Date.now() >= writeUntil;
      if (pastDeadline(options.deadlineMs) || sliceElapsed) {
        if (pastDeadline(options.deadlineMs)) result.hitDeadline = true;
        result.deferred++;
        continue;
      }

      countExpiry();

      await this.runService.updateRetentionMetadata({
        LaboratoryId: run.LaboratoryId,
        RunId: run.RunId,
        set: {
          ...(needsTerminalAt ? { TerminalAt: terminalAtIso } : {}),
          ...(needsExpiresAtSet && desiredExpiresAt != null ? { ExpiresAt: desiredExpiresAt } : {}),
          ModifiedAt: now.toISOString(),
          ModifiedBy: options.modifiedBy,
        },
        remove: needsExpiresAtRemove ? ['ExpiresAt'] : [],
      });

      if (needsTerminalAt) run.TerminalAt = terminalAtIso;
      if (needsExpiresAtSet && desiredExpiresAt != null) run.ExpiresAt = desiredExpiresAt;
      if (needsExpiresAtRemove) delete run.ExpiresAt;

      if (laboratory.S3Bucket && (run.InputFileKeys || []).length > 0) {
        try {
          await this.taggingService.updateRunUsageExpiresAt(
            laboratory,
            laboratory.S3Bucket,
            run.RunId,
            run.InputFileKeys || [],
            needsExpiresAtRemove ? undefined : desiredExpiresAt,
          );
        } catch (err) {
          console.warn(`Failed to propagate ExpiresAt to tagging for RunId=${run.RunId} (continuing):`, err);
        }
      }

      if (needsExpiresAtRemove) result.removed++;
      if (needsTerminalAt || needsExpiresAtSet) result.updated++;
    }

    return result;
  }

  private logRetentionReconcile(laboratoryId: string, wrote: ApplyRunRetentionResult): void {
    if (!wrote.updated && !wrote.removed && !wrote.deferred) return;
    console.log(
      `Lab ${laboratoryId} retention reconcile: updated=${wrote.updated} removed=${wrote.removed} deferred=${wrote.deferred}`,
    );
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
   * Input files are shared between runs and tracked per-file. A file is deleted when no
   * surviving run lists it in `InputFileKeys`, it has no usage whose run row still exists, and
   * it is not marked Permanent. A workflow tag or a stale usage is enough. So is a row with no
   * tags of any kind and no usages: nothing claims it.
   *
   * A file with any non-permanent tag and no usage is kept. An object with no FILE# row is not
   * visible here; the orphan pass records those FASTQs once the folder is 30 days old.
   */
  private async sweepInputFiles(
    laboratory: Laboratory,
    options: RetentionSweepOptions,
    fileRows: FileRowIndex,
    stats: RetentionSweepStats,
    runs: LaboratoryRun[] | undefined,
  ): Promise<void> {
    const permanentTagId = permanentTagIdForLaboratory(laboratory.LaboratoryId);
    const workflowTagIds = await this.loadWorkflowTagIds(laboratory.LaboratoryId);
    // `undefined` runs means the load failed: treat every usage as live so we cannot delete a
    // file that a surviving run still needs.
    const liveRunIds = runs ? new Set(runs.map((run) => run.RunId).filter((id): id is string => !!id)) : null;
    const liveInputKeys = new Set<string>();
    for (const run of runs || []) {
      for (const key of run.InputFileKeys || []) liveInputKeys.add(key);
    }
    let loggedDeleteCap = false;

    for (const row of fileRows.rows) {
      if (pastDeadline(options.deadlineMs)) {
        stats.stoppedForDeadline = true;
        break;
      }

      const tagIds = new Set<string>(row.TagIds || []);
      const usageIds = Object.keys(row.LaboratoryRunUsages || {});
      const liveUsages = liveRunIds == null ? usageIds.length : usageIds.filter((id) => liveRunIds.has(id)).length;
      const hasWorkflowTag = [...tagIds].some((id) => workflowTagIds.has(id));
      const key = row.ObjectKey;
      const bucket = row.S3Bucket || laboratory.S3Bucket;

      if (key && liveInputKeys.has(key)) continue;
      if (liveUsages > 0) {
        if (!options.dryRun && liveRunIds && bucket && key) {
          await this.dropStaleUsages(laboratory, bucket, key, usageIds.filter((id) => !liveRunIds.has(id)));
        }
        continue;
      }

      const hasAnyTag = tagIds.size > 0;
      const belongedToExpiredRun = hasWorkflowTag || (liveRunIds != null && usageIds.length > 0);
      const untaggedAndUnowned = liveRunIds != null && !hasAnyTag && usageIds.length === 0;
      if (!belongedToExpiredRun && !untaggedAndUnowned) continue;

      if (tagIds.has(permanentTagId)) {
        stats.permanentProtected++;
        if (!options.dryRun && liveRunIds && bucket && key) {
          await this.dropStaleUsages(laboratory, bucket, key, usageIds);
        }
        continue;
      }

      stats.eligible++;

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
        if (await this.inputBecameLive(laboratory.LaboratoryId, row.Ref, liveInputKeys)) continue;
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

  /** A run launched after the list was loaded records its usage before we delete. */
  private async inputBecameLive(laboratoryId: string, ref: string, liveInputKeys: Set<string>): Promise<boolean> {
    const fresh = await this.taggingService.getFileRow(laboratoryId, ref);
    if (!fresh) return true;
    if (fresh.ObjectKey && liveInputKeys.has(fresh.ObjectKey)) return true;
    for (const runId of Object.keys(fresh.LaboratoryRunUsages || {})) {
      if (await this.runService.runRowExists(laboratoryId, runId)) return true;
    }
    return false;
  }

  /** Removes usages whose runs are gone from a file this sweep is keeping. */
  private async dropStaleUsages(laboratory: Laboratory, bucket: string, key: string, staleRunIds: string[]): Promise<void> {
    if (!staleRunIds.length) return;
    const runIdToInputKeys: Record<string, string[]> = {};
    for (const runId of staleRunIds) runIdToInputKeys[runId] = [key];
    try {
      await this.taggingService.removeLaboratoryRunUsageForRunIds(laboratory, bucket, runIdToInputKeys);
    } catch (err) {
      console.warn(`  Could not drop stale usages for s3://${bucket}/${key} (continuing):`, err);
    }
  }

  /**
   * Collects every S3 location a surviving run still points at. Callers must pass the full run
   * list: a run missing from a truncated page would read as "expired", authorising deletion of a
   * live run's data.
   */
  private liveRunReferencesFrom(runs: LaboratoryRun[]): LiveRunReferences {
    const runIds = new Set<string>();
    const outputPrefixes: string[] = [];
    const sampleSheetKeys = new Set<string>();
    const inputKeys = new Set<string>();

    for (const run of runs) {
      if (run.RunId) runIds.add(run.RunId);
      for (const key of run.InputFileKeys || []) inputKeys.add(key);

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

    return { runIds, outputPrefixes, sampleSheetKeys, inputKeys };
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

    const cutoff = orphanQuietCutoff();
    const knownRunIds = new Set(
      (await this.taggingService.listExpiredRunOutputsForLab(laboratory.LaboratoryId)).map((r) => r.RunId),
    );

    const runFolders = await this.discoverRunFolders(bucket, laboratoryPrefix(laboratory));

    for (const runFolder of runFolders) {
      if (pastDeadline(options.deadlineMs)) {
        stats.stoppedForDeadline = true;
        break;
      }
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

        const untaggedInputKeys = objects
          .map((o) => o.Key)
          .filter(
            (key) =>
              isRunFolderFastqKey(key, laboratory, runId) &&
              !fileRows.trackedKeys.has(key) &&
              !fileRows.permanentKeys.has(key) &&
              !live.inputKeys.has(key),
          );

        const hasWork = !!outputPrefix || sampleSheetKeys.length > 0 || untaggedInputKeys.length > 0;

        if (options.dryRun) {
          if (hasWork) {
            console.log(
              `  [dry-run] Would record orphaned RunId=${runId}: results=${outputPrefix ? resultsObjects.length : 0} sampleSheets=${sampleSheetKeys.length} fastqs=${untaggedInputKeys.length}`,
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
          ...(untaggedInputKeys.length ? { UntaggedInputKeys: untaggedInputKeys } : {}),
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
      if (pastDeadline(options.deadlineMs)) {
        stats.stoppedForDeadline = true;
        break;
      }
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
        for (const inputKey of row.UntaggedInputKeys || []) {
          if (!isRunFolderFastqKey(inputKey, laboratory, row.RunId)) {
            throw new Error(`Untagged input '${inputKey}' is not a FASTQ in run ${row.RunId}'s folder`);
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
        const untaggedInputKeys = (row.UntaggedInputKeys || []).filter((key) => !live.inputKeys.has(key));

        // Files under results/ are taggable through the File Manager API, so the Permanent tag has
        // to be honoured here too — otherwise prefix deletion silently overrides the protection
        // the FILE#-row sweep enforces.
        const candidates = [...listed, ...sheetKeys, ...untaggedInputKeys];
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
