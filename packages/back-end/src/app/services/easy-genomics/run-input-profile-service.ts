import { RunInputProfile } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  countSamplesInSampleSheetCsv,
  hashRunSettings,
} from '@easy-genomics/shared-lib/src/app/utils/run-cost-estimation';
import { S3Service } from '@BE/services/s3-service';
import { s3BodyToString } from '@BE/utils/s3-object-body';

const s3Service = new S3Service();

function extensionOfKey(key: string): string {
  const base = key.split('/').pop() || key;
  const idx = base.indexOf('.');
  if (idx < 0) return '';
  return base.slice(idx).toLowerCase();
}

function parseS3Url(url: string): { bucket: string; key: string } | undefined {
  const match = url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return undefined;
  return { bucket: match[1], key: match[2] };
}

export type SampleSheetRead =
  | { outcome: 'read'; sampleCount: number; dataFileKeys: string[] }
  | { outcome: 'notRead'; reason: 'noSampleSheet' | 'notInLaboratoryBucket' | 'unreadable' };

function laboratoryBucketKeysInSampleSheet(csv: string, bucket: string): string[] {
  const dataLines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(1);
  const keys = new Set<string>();
  for (const line of dataLines) {
    for (const cell of line.split(',')) {
      const parsed = parseS3Url(cell.trim());
      if (parsed && parsed.bucket === bucket) keys.add(parsed.key);
    }
  }
  return [...keys];
}

/**
 * Reads the run's sample sheet from the laboratory bucket. Only the laboratory bucket is read,
 * to prevent cross-tenant S3 reads. A sheet that could not be read is reported as `notRead`,
 * never as zero samples.
 */
export async function readSampleSheet(laboratory: Laboratory, sampleSheetS3Url?: string): Promise<SampleSheetRead> {
  if (!sampleSheetS3Url) return { outcome: 'notRead', reason: 'noSampleSheet' };
  const parsed = parseS3Url(sampleSheetS3Url);
  if (!parsed) return { outcome: 'notRead', reason: 'unreadable' };
  const bucket = laboratory.S3Bucket;
  if (!bucket || parsed.bucket !== bucket) return { outcome: 'notRead', reason: 'notInLaboratoryBucket' };

  try {
    const obj = await s3Service.getObject({ Bucket: parsed.bucket, Key: parsed.key });
    const csv = await s3BodyToString(obj.Body);
    return {
      outcome: 'read',
      sampleCount: countSamplesInSampleSheetCsv(csv),
      dataFileKeys: laboratoryBucketKeysInSampleSheet(csv, bucket),
    };
  } catch (err) {
    console.warn(`Failed to read sample sheet ${sampleSheetS3Url}:`, err);
    return { outcome: 'notRead', reason: 'unreadable' };
  }
}

/** Sizes of the objects HeadObject could read, keyed in input order. A failed head is skipped. */
async function readObjectSizes(bucket: string, keys: string[]): Promise<{ key: string; size: number }[]> {
  const heads = await Promise.allSettled(keys.map((key) => s3Service.headObject({ Bucket: bucket, Key: key })));
  const sizes: { key: string; size: number }[] = [];
  heads.forEach((result, i) => {
    if (result.status !== 'fulfilled') {
      console.warn(`HeadObject failed for ${keys[i]} (continuing):`, result.reason);
      return;
    }
    sizes.push({ key: keys[i], size: result.value.ContentLength ?? 0 });
  });
  return sizes;
}

export async function sumObjectBytes(bucket: string, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const sizes = await readObjectSizes(bucket, keys);
  return sizes.reduce((total, { size }) => total + size, 0);
}

/**
 * Build a RunInputProfile for cost estimation. Best-effort: missing sample sheet
 * or HeadObject failures yield zeros rather than throwing.
 *
 * sampleSheetS3Url is only read when its bucket matches laboratory.S3Bucket
 * (same pin as inputFileKeys) to prevent cross-tenant S3 reads.
 */
export async function buildRunInputProfile(params: {
  laboratory: Laboratory;
  inputFileKeys?: string[];
  sampleSheetS3Url?: string;
  settings?: unknown;
}): Promise<RunInputProfile> {
  const keys = params.inputFileKeys || [];
  let InputBytesTotal = 0;
  const InputBytesByExtension: Record<string, number> = {};
  const bucket = params.laboratory.S3Bucket;

  const sampleSheet = await readSampleSheet(params.laboratory, params.sampleSheetS3Url);
  if (sampleSheet.outcome === 'notRead' && sampleSheet.reason === 'notInLaboratoryBucket') {
    console.warn(`Ignoring sampleSheetS3Url ${params.sampleSheetS3Url} (expected laboratory bucket=${bucket})`);
  }
  const SampleCount = sampleSheet.outcome === 'read' ? sampleSheet.sampleCount : 0;

  if (bucket && keys.length > 0) {
    for (const { key, size } of await readObjectSizes(bucket, keys)) {
      InputBytesTotal += size;
      const ext = extensionOfKey(key);
      if (ext) {
        InputBytesByExtension[ext] = (InputBytesByExtension[ext] || 0) + size;
      }
    }
  }

  let settingsObj: unknown = params.settings;
  if (typeof settingsObj === 'string') {
    try {
      settingsObj = JSON.parse(settingsObj);
    } catch {
      settingsObj = {};
    }
  }

  return {
    SampleCount,
    InputFileCount: keys.length,
    InputBytesTotal,
    ParameterHash: hashRunSettings(settingsObj ?? {}),
    ...(Object.keys(InputBytesByExtension).length ? { InputBytesByExtension } : {}),
  };
}
