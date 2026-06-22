import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

const MISSING_S3_BUCKET_MESSAGE = 'no S3 bucket configured';

export function isLaboratoryS3Configured(lab: Laboratory | null | undefined): boolean {
  return !!lab?.S3Bucket?.trim();
}

export function isMissingLaboratoryS3BucketError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(MISSING_S3_BUCKET_MESSAGE);
}
