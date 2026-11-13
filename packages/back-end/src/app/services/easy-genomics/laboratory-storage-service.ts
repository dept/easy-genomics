import {
  LaboratoryStorageItem,
  LaboratoryStorageItemStatus,
  LaboratoryStorageItemType,
  LaboratoryStorageSummary,
  LaboratoryStorageTotals,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-storage';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { InvalidRequestError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import {
  FileRowIndex,
  loadFileRowIndex,
  ORPHAN_SCAN_MIN_AGE_DAYS,
} from '@BE/services/easy-genomics/laboratory-data-retention-service';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { PricingService } from '@BE/services/pricing-service';
import { S3Service } from '@BE/services/s3-service';
import { isTerminalLaboratoryRunStatus } from '@BE/utils/laboratory-run-ttl-utils';
import {
  isRunFolderName,
  isSampleSheetKey,
  laboratoryPrefix,
  normalizeS3Prefix,
  parseS3ObjectUri,
} from '@BE/utils/s3-uri-utils';

/** Leaves headroom under API Gateway's 29 s limit for the reads and the snapshot write around the listing. */
export const INTERACTIVE_SCAN_BUDGET_MS = 20_000;

/** applyTagsToFiles costs several DynamoDB calls per key, so larger selections would outlive the API timeout. */
const MAX_PROTECTION_KEYS = 1_000;

const S3_DELETE_BATCH_SIZE = 1000;

/** Run folders sit at `{org}/{lab}/{platform}/{runId}/`; older data may omit the platform level. */
const MAX_RUN_FOLDER_DEPTH = 2;

/** HealthOmics private workflow definitions are read by the workflow, not by a run, so they are never offered for deletion. */
const WORKFLOW_DEFINITIONS_FOLDER = 'workflow-definitions';

type StoredObject = { Key: string; Size: number; LastModified?: Date };

type InventoryEntry = {
  type: LaboratoryStorageItemType;
  name: string;
  path: string;
  detail: string;
  run?: LaboratoryRun;
  objects: StoredObject[];
};

type Inventory = {
  bucket: string;
  runCount: number;
  entries: Map<string, InventoryEntry>;
  fileRows: FileRowIndex;
  sampleLinkedKeys: Set<string>;
  /** Every run that points at a key (inputs, sample sheet, output prefix or run folder). */
  claimants: Map<string, Set<string>>;
};

/**
 * Builds the lab storage inventory shown on the Storage page: every object under the lab prefix,
 * grouped by the run it belongs to, plus folders no surviving run claims. The snapshot is written
 * to the tagging table by the nightly retention sweep and by an interactive rescan, so the page
 * never lists the bucket on load.
 */
export class LaboratoryStorageService {
  private readonly s3Service: S3Service;
  private readonly taggingService: LaboratoryDataTaggingService;
  private readonly runService: LaboratoryRunService;
  private readonly pricingService: PricingService;

  public constructor(deps?: {
    s3Service?: S3Service;
    taggingService?: LaboratoryDataTaggingService;
    runService?: LaboratoryRunService;
    pricingService?: PricingService;
  }) {
    this.s3Service = deps?.s3Service ?? new S3Service();
    this.taggingService = deps?.taggingService ?? new LaboratoryDataTaggingService();
    this.runService = deps?.runService ?? new LaboratoryRunService();
    this.pricingService = deps?.pricingService ?? new PricingService();
  }

  public async getOrScanSummary(laboratory: Laboratory): Promise<LaboratoryStorageSummary> {
    const stored = await this.taggingService.getStorageSummary(laboratory.LaboratoryId);
    return stored ?? this.rescan(laboratory, INTERACTIVE_SCAN_BUDGET_MS);
  }

  public async getTotals(laboratoryId: string): Promise<LaboratoryStorageTotals | null> {
    return this.taggingService.getStorageTotals(laboratoryId);
  }

  /** `budgetMs` bounds the bucket listing; omit it for the nightly sweep, which has a 15 minute timeout. */
  public async rescan(laboratory: Laboratory, budgetMs?: number): Promise<LaboratoryStorageSummary> {
    const inventory = await this.buildInventory(laboratory, budgetMs);
    return this.saveSummary(laboratory, inventory);
  }

  public async setProtection(
    laboratory: Laboratory,
    itemIds: string[],
    protect: boolean,
    userId: string,
  ): Promise<LaboratoryStorageSummary> {
    const inventory = await this.buildInventory(laboratory, INTERACTIVE_SCAN_BUDGET_MS);
    const keys = this.selectEntries(inventory, itemIds).flatMap((entry) => entry.objects.map((o) => o.Key));
    if (keys.length > MAX_PROTECTION_KEYS) {
      throw new InvalidRequestError(
        `Selection holds ${keys.length} files; protect at most ${MAX_PROTECTION_KEYS} files at a time.`,
      );
    }

    const permanentTag = await this.taggingService.ensurePermanentTag(laboratory, userId);
    await this.taggingService.applyTagsToFiles(
      laboratory,
      userId,
      inventory.bucket,
      keys,
      protect ? [permanentTag.TagId] : [],
      protect ? [] : [permanentTag.TagId],
    );

    // Reload rather than patch: a file linked to a permanent sample stays protected after the tag is removed.
    inventory.fileRows = await loadFileRowIndex(this.taggingService, laboratory);
    return this.saveSummary(laboratory, inventory);
  }

  /**
   * Deletes the selected items' objects now. Bucket versioning is off, so this cannot be undone;
   * every key that something else still depends on is skipped rather than deleted.
   */
  public async removeItems(
    laboratory: Laboratory,
    itemIds: string[],
  ): Promise<{ DeletedObjectCount: number; SkippedObjectCount: number; Summary: LaboratoryStorageSummary }> {
    const inventory = await this.buildInventory(laboratory, INTERACTIVE_SCAN_BUDGET_MS);
    await this.taggingService.assertLaboratoryHasS3BucketAccess(laboratory, inventory.bucket);

    const keysToDelete: string[] = [];
    let skipped = 0;
    for (const entry of this.selectEntries(inventory, itemIds)) {
      if (!this.isEntryDeletable(entry)) {
        skipped += entry.objects.length;
        continue;
      }
      for (const object of entry.objects) {
        if (this.isKeyDeletable(inventory, object.Key, entry.run?.RunId)) {
          this.taggingService.assertKeyUnderLabPrefix(laboratory, object.Key);
          keysToDelete.push(object.Key);
        } else {
          skipped++;
        }
      }
    }

    const deleted = await this.deleteKeys(inventory.bucket, keysToDelete);
    skipped += keysToDelete.length - deleted.size;

    for (const key of deleted) {
      const ref = inventory.fileRows.refByKey.get(key);
      if (ref) await this.taggingService.deleteFileRowAndAssociations(laboratory.LaboratoryId, ref);
    }
    for (const entry of inventory.entries.values()) {
      entry.objects = entry.objects.filter((o) => !deleted.has(o.Key));
    }

    return {
      DeletedObjectCount: deleted.size,
      SkippedObjectCount: skipped,
      Summary: await this.saveSummary(laboratory, inventory),
    };
  }

  private selectEntries(inventory: Inventory, itemIds: string[]): InventoryEntry[] {
    return itemIds.map((itemId) => {
      const entry = inventory.entries.get(itemId);
      if (!entry) throw new InvalidRequestError(`Storage item '${itemId}' no longer exists; rescan the bucket.`);
      return entry;
    });
  }

  private isEntryDeletable(entry: InventoryEntry): boolean {
    if (entry.run) return isTerminalLaboratoryRunStatus(entry.run.Status);
    if (entry.path.split('/')[0] === WORKFLOW_DEFINITIONS_FOLDER) return false;
    // Uploads land in their folder before the run record exists, so recent data with no run is usually a live upload.
    const newest = newestModified(entry.objects);
    return !!newest && newest.getTime() < Date.now() - ORPHAN_SCAN_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  }

  private isKeyDeletable(inventory: Inventory, key: string, ownRunId: string | undefined): boolean {
    if (inventory.fileRows.permanentKeys.has(key)) return false;
    if (inventory.sampleLinkedKeys.has(key)) return false;
    const claimants = inventory.claimants.get(key);
    return !claimants || [...claimants].every((runId) => runId === ownRunId);
  }

  private async deleteKeys(bucket: string, keys: string[]): Promise<Set<string>> {
    const deleted = new Set<string>();
    for (let i = 0; i < keys.length; i += S3_DELETE_BATCH_SIZE) {
      const chunk = keys.slice(i, i + S3_DELETE_BATCH_SIZE);
      const response = await this.s3Service.deleteObjects({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      });
      const failed = new Set((response.Errors || []).map((e) => e.Key));
      for (const failure of response.Errors || []) {
        console.warn(`Failed to delete s3://${bucket}/${failure.Key}: ${failure.Code} ${failure.Message}`);
      }
      for (const key of chunk) if (!failed.has(key)) deleted.add(key);
    }
    return deleted;
  }

  private async buildInventory(laboratory: Laboratory, budgetMs?: number): Promise<Inventory> {
    if (!laboratory.S3Bucket) throw new InvalidRequestError('This lab has no default S3 bucket.');
    const bucket = laboratory.S3Bucket;
    const labPrefix = laboratoryPrefix(laboratory);

    const [objects, runs, fileRows] = await Promise.all([
      this.listObjects(bucket, labPrefix, budgetMs),
      this.runService.listAllRunsForLaboratory(laboratory.LaboratoryId),
      loadFileRowIndex(this.taggingService, laboratory),
    ]);

    const runsById = new Map(runs.map((run) => [run.RunId, run]));
    const runsByInputKey = new Map<string, LaboratoryRun>();
    const runsBySampleSheetKey = new Map<string, LaboratoryRun>();
    const outputPrefixes: Array<{ prefix: string; run: LaboratoryRun }> = [];
    const claimants = new Map<string, Set<string>>();
    const claim = (key: string, runId: string) => claimants.set(key, (claimants.get(key) ?? new Set()).add(runId));

    for (const run of runs) {
      for (const inputKey of run.InputFileKeys || []) {
        const key = parseS3ObjectUri(inputKey)?.prefix ?? inputKey;
        if (!runsByInputKey.has(key)) runsByInputKey.set(key, run);
        claim(key, run.RunId);
      }
      const sampleSheet = parseS3ObjectUri(run.SampleSheetS3Url);
      if (sampleSheet) {
        if (!runsBySampleSheetKey.has(sampleSheet.prefix)) runsBySampleSheetKey.set(sampleSheet.prefix, run);
        claim(sampleSheet.prefix, run.RunId);
      }
      const output = parseS3ObjectUri(run.OutputS3Url);
      if (output) outputPrefixes.push({ prefix: normalizeS3Prefix(output.prefix), run });
    }
    // Longest prefix first so a run nested inside another's output directory wins its own files.
    outputPrefixes.sort((a, b) => b.prefix.length - a.prefix.length);

    const entries = new Map<string, InventoryEntry>();
    const add = (itemId: string, entry: Omit<InventoryEntry, 'objects'>, object: StoredObject) => {
      const existing = entries.get(itemId);
      if (existing) existing.objects.push(object);
      else entries.set(itemId, { ...entry, objects: [object] });
    };
    const relative = (key: string) => key.slice(labPrefix.length);

    for (const object of objects) {
      const key = object.Key;
      const runFolder = findRunFolder(key, labPrefix);
      const folderRun = runFolder ? runsById.get(runFolder.runId) : undefined;
      const matchingOutputs = outputPrefixes.filter(({ prefix }) => key.startsWith(prefix));
      for (const { run } of matchingOutputs) claim(key, run.RunId);
      if (folderRun) claim(key, folderRun.RunId);

      const inputRun = runsByInputKey.get(key);
      const sheetRun = runsBySampleSheetKey.get(key);
      const outputMatch = matchingOutputs[0];

      if (inputRun) {
        add(`InputData#${inputRun.RunId}`, inputEntry(inputRun, relative(dirname(key))), object);
      } else if (sheetRun) {
        add(`SampleSheet#${sheetRun.RunId}`, sampleSheetEntry(sheetRun, key, relative(dirname(key))), object);
      } else if (outputMatch) {
        add(`RunOutputs#${outputMatch.run.RunId}`, outputEntry(outputMatch.run, relative(outputMatch.prefix)), object);
      } else if (folderRun && runFolder) {
        if (isSampleSheetKey(key, runFolder.prefix)) {
          add(`SampleSheet#${folderRun.RunId}`, sampleSheetEntry(folderRun, key, relative(runFolder.prefix)), object);
        } else if (key.startsWith(`${runFolder.prefix}results/`)) {
          add(`RunOutputs#${folderRun.RunId}`, outputEntry(folderRun, relative(`${runFolder.prefix}results/`)), object);
        } else {
          add(`InputData#${folderRun.RunId}`, inputEntry(folderRun, relative(runFolder.prefix)), object);
        }
      } else {
        const groupPath = runFolder ? relative(runFolder.prefix) : unattachedGroup(relative(key));
        const isWorkflowDefinition = groupPath.split('/')[0] === WORKFLOW_DEFINITIONS_FOLDER;
        add(
          `Unattached#${groupPath}`,
          {
            type: 'Unattached',
            name: groupPath.replace(/\/$/, ''),
            path: isWorkflowDefinition ? 'HealthOmics workflow definitions' : 'no matching run record',
            detail: runFolder ? 'Unknown workflow' : 'Outside any run folder',
          },
          object,
        );
      }
    }

    const sampleLinkedKeys = new Set(
      fileRows.rows.filter((row) => row.ObjectKey && (row.SampleIds || []).length > 0).map((row) => row.ObjectKey),
    );

    return { bucket, runCount: runs.length, entries, fileRows, sampleLinkedKeys, claimants };
  }

  private async listObjects(bucket: string, prefix: string, budgetMs?: number): Promise<StoredObject[]> {
    const deadline = budgetMs != null ? Date.now() + budgetMs : Infinity;
    const out: StoredObject[] = [];
    let continuationToken: string | undefined;
    do {
      if (Date.now() > deadline) {
        throw new InvalidRequestError(
          'This lab holds too many files to rescan now. Storage figures refresh automatically every night.',
        );
      }
      const response = await this.s3Service.listBucketObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });
      for (const object of response.Contents || []) {
        if (object.Key) out.push({ Key: object.Key, Size: object.Size ?? 0, LastModified: object.LastModified });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  private async saveSummary(laboratory: Laboratory, inventory: Inventory): Promise<LaboratoryStorageSummary> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const items: LaboratoryStorageItem[] = [...inventory.entries.entries()]
      .filter(([, entry]) => entry.objects.length > 0)
      .map(([itemId, entry]) => ({
        ItemId: itemId,
        Type: entry.type,
        Name: entry.name,
        Path: entry.path,
        Detail: entry.detail,
        RunId: entry.run?.RunId,
        FileCount: entry.objects.length,
        SizeBytes: entry.objects.reduce((sum, o) => sum + o.Size, 0),
        LastModified: newestModified(entry.objects)?.toISOString(),
        ProtectedFileCount: entry.objects.filter((o) => inventory.fileRows.permanentKeys.has(o.Key)).length,
        Status: entry.run ? runStatus(entry.run, nowSeconds) : 'NoRunRecord',
        Deletable: this.isEntryDeletable(entry),
      }));

    const sumBytes = (list: LaboratoryStorageItem[]) => list.reduce((sum, item) => sum + item.SizeBytes, 0);
    const unattached = items.filter((item) => item.Type === 'Unattached');

    const summary: LaboratoryStorageSummary = {
      OrganizationId: laboratory.OrganizationId,
      LaboratoryId: laboratory.LaboratoryId,
      S3Bucket: inventory.bucket,
      ScannedAt: new Date().toISOString(),
      TotalBytes: sumBytes(items),
      AttachedBytes: sumBytes(items.filter((item) => item.Type !== 'Unattached')),
      NoRunRecordBytes: sumBytes(unattached),
      NoRunRecordFileCount: unattached.reduce((sum, item) => sum + item.FileCount, 0),
      ProtectedItemCount: items.filter((item) => item.FileCount > 0 && item.ProtectedFileCount === item.FileCount)
        .length,
      RunCount: inventory.runCount,
      PricePerGbMonthUsd: await this.getPricePerGbMonth(inventory.bucket),
      Items: items,
    };

    await this.taggingService.putStorageSummary(summary);
    return summary;
  }

  private async getPricePerGbMonth(bucket: string): Promise<number | undefined> {
    try {
      const { LocationConstraint } = await this.s3Service.getBucketLocation({ Bucket: bucket });
      // GetBucketLocation reports us-east-1 as an empty constraint and eu-west-1 as the legacy 'EU'.
      const region = !LocationConstraint ? 'us-east-1' : LocationConstraint === 'EU' ? 'eu-west-1' : LocationConstraint;
      return await this.pricingService.getS3StandardPricePerGbMonth(region);
    } catch (error) {
      console.warn(`Could not resolve storage price for bucket ${bucket}; cost estimate hidden:`, error);
      return undefined;
    }
  }
}

function runStatus(run: LaboratoryRun, nowSeconds: number): LaboratoryStorageItemStatus {
  if (!isTerminalLaboratoryRunStatus(run.Status)) return 'Running';
  if (run.ExpiresAt != null && run.ExpiresAt <= nowSeconds) return 'Expiring';
  return run.Status === 'FAILED' ? 'RunFailed' : 'Active';
}

function outputEntry(run: LaboratoryRun, path: string): Omit<InventoryEntry, 'objects'> {
  return { type: 'RunOutputs', name: run.RunName, path, detail: run.WorkflowName || 'Unknown workflow', run };
}

function inputEntry(run: LaboratoryRun, path: string): Omit<InventoryEntry, 'objects'> {
  const samples = run.RunInputProfile?.SampleCount;
  const detail = samples ? `${samples} sample${samples === 1 ? '' : 's'}` : run.WorkflowName || 'Unknown workflow';
  return { type: 'InputData', name: `${run.RunName} reads`, path, detail, run };
}

function sampleSheetEntry(run: LaboratoryRun, key: string, path: string): Omit<InventoryEntry, 'objects'> {
  const fileName = key.slice(key.lastIndexOf('/') + 1);
  return { type: 'SampleSheet', name: fileName, path, detail: run.WorkflowName || 'Unknown workflow', run };
}

/** The UUID-named folder a key sits in, within the first two levels below the lab prefix. */
function findRunFolder(key: string, labPrefix: string): { prefix: string; runId: string } | undefined {
  const segments = key.slice(labPrefix.length).split('/');
  for (let i = 0; i < Math.min(MAX_RUN_FOLDER_DEPTH, segments.length - 1); i++) {
    if (isRunFolderName(segments[i])) {
      return { prefix: `${labPrefix}${segments.slice(0, i + 1).join('/')}/`, runId: segments[i] };
    }
  }
  return undefined;
}

/** Files outside run folders are grouped by their first two folders, e.g. `uploads/2025-11-ingest/`. */
function unattachedGroup(relativeKey: string): string {
  const folders = relativeKey.split('/').slice(0, -1);
  return folders.length ? `${folders.slice(0, 2).join('/')}/` : relativeKey;
}

function dirname(key: string): string {
  return key.slice(0, key.lastIndexOf('/') + 1);
}

function newestModified(objects: StoredObject[]): Date | undefined {
  return objects.reduce<Date | undefined>(
    (acc, o) => (o.LastModified && (!acc || o.LastModified > acc) ? o.LastModified : acc),
    undefined,
  );
}
