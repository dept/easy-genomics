import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RunExportDestination } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run/request-run-export-job';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { normalizeS3Prefix, parseS3ObjectUri, parseS3Uri } from '@BE/utils/s3-uri-utils';

export const COMPLETED_RUN_STATUSES = new Set(['SUCCEEDED', 'COMPLETED']);
export const RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
export const RUN_EXPORT_JOBS_PREFIX = '.exports/jobs';
export const RUN_EXPORT_ARCHIVES_PREFIX = '.exports/archives';
export const RUN_EXPORT_STATUS_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
export const RUN_EXPORT_SKIP_PATH_SEGMENTS = new Set(['work', '.downloads', '.exports']);
export const RUN_EXPORT_MAX_RUNS = 25;
export const RUN_EXPORT_MAX_EXPANDED_OBJECTS = 10_000;

export const ZIP_TOO_LARGE_MESSAGE =
  'The selected runs are too large to download as a single ZIP. Export them to an S3 bucket or LIMS landing zone instead.';
export const RUN_NOT_COMPLETE_MESSAGE = 'Results can only be saved from a completed run.';
export const RUN_OUTPUT_MISSING_MESSAGE = 'This run does not have a stored output location.';
export const RUN_OUTPUT_EMPTY_MESSAGE = 'The selected runs do not contain any exportable output files.';
export const RUN_EXPORT_TOO_MANY_MESSAGE = `Select at most ${RUN_EXPORT_MAX_RUNS} runs at a time.`;
export const RUN_EXPORT_TOO_MANY_OBJECTS_MESSAGE = `Select fewer runs. At most ${RUN_EXPORT_MAX_EXPANDED_OBJECTS} objects can be exported at once.`;

export type RunOutputLocation = {
  bucket: string;
  prefix: string;
  uri: string;
};

export type RunExportObject = {
  Key: string;
  Size: number;
};

export type RunExportObjectStore = {
  listAllObjectsUnderPrefix: (bucket: string, prefix: string) => Promise<Array<{ Key?: string; Size?: number }>>;
};

export type RunExportJobSource = {
  RunId: string;
  RunName?: string;
  SourceBucket: string;
  SourcePrefix: string;
};

export type RunExportJobMessage = {
  JobId: string;
  LaboratoryId: string;
  OrganizationId: string;
  Destination: RunExportDestination;
  Sources: RunExportJobSource[];
  StatusBucket: string;
  StatusKey: string;
  ArchiveKey?: string;
  DestBucket?: string;
  DestPrefix?: string;
};

export function uniqueRunIds(runIds: string[]): string[] {
  return [...new Set(runIds)];
}

export function isCompletedRunStatus(status: string | undefined): boolean {
  return !!status && COMPLETED_RUN_STATUSES.has(status);
}

export function assertCompletedRun(run: LaboratoryRun): void {
  if (!isCompletedRunStatus(run.Status)) {
    throw new InvalidRequestError(RUN_NOT_COMPLETE_MESSAGE);
  }
}

export function resolveRunOutputLocation(run: LaboratoryRun): RunOutputLocation {
  const uri = run.OutputS3Url || run.InputS3Url;
  const parsed = parseS3ObjectUri(uri) || parseS3Uri(uri);
  if (!parsed?.bucket) {
    throw new InvalidRequestError(RUN_OUTPUT_MISSING_MESSAGE);
  }

  const prefix = parsed.prefix ? normalizeS3Prefix(parsed.prefix) : '';
  return {
    bucket: parsed.bucket,
    prefix,
    uri: prefix ? `s3://${parsed.bucket}/${prefix}` : `s3://${parsed.bucket}/`,
  };
}

export function shouldSkipRunExportKey(key: string, sourcePrefix: string): boolean {
  if (!key || key.endsWith('/')) return true;
  const relative = key.startsWith(sourcePrefix) ? key.slice(sourcePrefix.length) : key;
  return relative.split('/').some((segment) => RUN_EXPORT_SKIP_PATH_SEGMENTS.has(segment));
}

export function filterExportableRunObjects(
  objects: Array<{ Key?: string; Size?: number }>,
  sourcePrefix: string,
): RunExportObject[] {
  const exportable: RunExportObject[] = [];
  for (const object of objects) {
    const key = object.Key || '';
    if (shouldSkipRunExportKey(key, sourcePrefix)) continue;
    exportable.push({ Key: key, Size: object.Size || 0 });
  }
  return exportable;
}

export async function listExportableRunObjects(params: {
  s3: RunExportObjectStore;
  bucket: string;
  runPrefix: string;
}): Promise<RunExportObject[]> {
  const prefix = params.runPrefix ? normalizeS3Prefix(params.runPrefix) : '';
  const listed = await params.s3.listAllObjectsUnderPrefix(params.bucket, prefix);
  return filterExportableRunObjects(listed, prefix);
}

export function sanitizeExportPrefix(prefix: string): string {
  const cleaned = prefix.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = cleaned.split('/').filter((segment) => segment && segment !== '.' && segment !== '..');
  if (segments.length === 0) {
    throw new InvalidRequestError('Destination prefix is required');
  }
  return normalizeS3Prefix(segments.join('/'));
}

export function safeRunFolderName(runName: string | undefined, runId: string): string {
  const fromName = (runName || '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return fromName || `run-${runId}`;
}

export function uniqueRunExportFolder(run: Pick<LaboratoryRun, 'RunId'> & { RunName?: string }): string {
  return `${safeRunFolderName(run.RunName, run.RunId)}-${run.RunId}`;
}

export function defaultExportPrefix(params: {
  laboratory: Pick<Laboratory, 'OrganizationId' | 'LaboratoryId'>;
  run: Pick<LaboratoryRun, 'RunId' | 'RunName'>;
  destination: Exclude<RunExportDestination, 'Download'>;
}): string {
  const folder = uniqueRunExportFolder(params.run);
  const root = params.destination === 'Lims' ? 'lims-export' : 'exports';
  return `${params.laboratory.OrganizationId}/${params.laboratory.LaboratoryId}/${root}/${folder}/`;
}

export function defaultBundleExportPrefix(params: {
  laboratory: Pick<Laboratory, 'OrganizationId' | 'LaboratoryId'>;
  destination: Exclude<RunExportDestination, 'Download'>;
  runCount: number;
}): string {
  const root = params.destination === 'Lims' ? 'lims-export' : 'exports';
  return `${params.laboratory.OrganizationId}/${params.laboratory.LaboratoryId}/${root}/bundle-${params.runCount}-runs/`;
}

export function assertDestinationDoesNotOverlapSource(params: {
  sourceBucket: string;
  sourcePrefix: string;
  destBucket: string;
  destPrefix: string;
}): void {
  if (params.sourceBucket !== params.destBucket) return;
  const source = normalizeS3Prefix(params.sourcePrefix);
  const dest = normalizeS3Prefix(params.destPrefix);
  if (dest.startsWith(source) || source.startsWith(dest)) {
    throw new InvalidRequestError('Destination must not overlap the run output location');
  }
}

export function destinationObjectKey(sourceKey: string, sourcePrefix: string, destPrefix: string): string {
  const relative = sourceKey.startsWith(sourcePrefix) ? sourceKey.slice(sourcePrefix.length) : sourceKey;
  return `${normalizeS3Prefix(destPrefix)}${relative}`;
}
