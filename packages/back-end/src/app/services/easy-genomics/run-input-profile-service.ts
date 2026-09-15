import { RunInputProfile } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  countSamplesInSampleSheetCsv,
  hashRunSettings,
} from '@easy-genomics/shared-lib/src/app/utils/run-cost-estimation';
import { S3Service } from '@BE/services/s3-service';

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

async function streamToString(body: any): Promise<string> {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf-8');
  if (typeof body.transformToString === 'function') {
    return body.transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
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
  let SampleCount = 0;
  let InputBytesTotal = 0;
  const InputBytesByExtension: Record<string, number> = {};
  const bucket = params.laboratory.S3Bucket;

  if (params.sampleSheetS3Url) {
    try {
      const parsed = parseS3Url(params.sampleSheetS3Url);
      if (parsed && bucket && parsed.bucket === bucket) {
        const obj = await s3Service.getObject({ Bucket: parsed.bucket, Key: parsed.key });
        const csv = await streamToString(obj.Body);
        SampleCount = countSamplesInSampleSheetCsv(csv);
      } else if (parsed && parsed.bucket !== bucket) {
        console.warn(`Ignoring sampleSheetS3Url bucket=${parsed.bucket} (expected laboratory bucket=${bucket})`);
      }
    } catch (err) {
      console.warn('Failed to parse sample sheet for RunInputProfile (continuing):', err);
    }
  }

  if (bucket && keys.length > 0) {
    const heads = await Promise.allSettled(keys.map((key) => s3Service.headObject({ Bucket: bucket, Key: key })));
    for (let i = 0; i < heads.length; i++) {
      const result = heads[i];
      const key = keys[i];
      if (result.status !== 'fulfilled') {
        console.warn(`HeadObject failed for ${key} (continuing):`, result.reason);
        continue;
      }
      const size = result.value.ContentLength ?? 0;
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
