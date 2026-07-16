import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

const MISSING_S3_BUCKET_MESSAGE = 'no S3 bucket configured';
const BUCKET_DOES_NOT_EXIST_MESSAGE = 'specified bucket does not exist';
const S3_BUCKET_ACCESS_DENIED_MESSAGE = 'S3 bucket access denied';

/** Guidance shown when a lab's default bucket is missing or its access was revoked. */
export const CONFIGURE_S3_BUCKET_MESSAGE =
  'This lab has no accessible default S3 bucket. Ask an organization admin to grant access, then set the default S3 bucket in lab settings.';

export function isLaboratoryS3Configured(lab: Laboratory | null | undefined): boolean {
  return !!lab?.S3Bucket?.trim();
}

export function isMissingLaboratoryS3BucketError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(MISSING_S3_BUCKET_MESSAGE);
}

/** True when the error is a 403 (EG-333) raised because the lab is not allowed to access the bucket. */
export function isS3BucketAccessDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(S3_BUCKET_ACCESS_DENIED_MESSAGE);
}

/** Suppress unlinked-bucket scan errors when the lab has no usable S3 bucket configured. */
export function shouldIgnoreUnlinkedBucketObjectsError(error: unknown, lab: Laboratory | null | undefined): boolean {
  if (isMissingLaboratoryS3BucketError(error)) {
    return true;
  }
  // A revoked default bucket behaves like an unconfigured lab: don't surface a scan failure.
  if (isS3BucketAccessDeniedError(error)) {
    return true;
  }
  if (!isLaboratoryS3Configured(lab)) {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes(BUCKET_DOES_NOT_EXIST_MESSAGE);
  }
  return false;
}
