import { Bucket, GetBucketTaggingCommandOutput, ListBucketsCommandOutput, Tag } from '@aws-sdk/client-s3';
import { S3BucketCatalogEntry } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { S3Bucket } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/s3-bucket';
import { S3Service } from '../s3-service';

const s3Service = new S3Service();

const DATA_BUCKET_TAG_KEY = 'easy-genomics:s3-bucket-type';
const DATA_BUCKET_TAG_VALUE = 'data';

export function isExcludedCatalogBucketName(bucketName: string): boolean {
  return bucketName.startsWith('cdk') || bucketName.startsWith('amplify');
}

export function bucketTagsIncludeDataType(tagSet: Tag[] | undefined): boolean {
  return !!tagSet?.find((t: Tag) => t.Key === DATA_BUCKET_TAG_KEY && t.Value === DATA_BUCKET_TAG_VALUE);
}

/**
 * True when `bucketName` is a data-tagged S3 bucket (same filter as the catalog).
 * Uses a single GetBucketTagging call — preferred on hot assert paths.
 */
export async function isDataTaggedS3Bucket(bucketName: string): Promise<boolean> {
  if (!bucketName || isExcludedCatalogBucketName(bucketName)) {
    return false;
  }
  const tagging: GetBucketTaggingCommandOutput | undefined = await s3Service.getBucketTagging({ Bucket: bucketName });
  return bucketTagsIncludeDataType(tagging?.TagSet);
}

/**
 * Lists data-tagged S3 buckets (same filter as list-buckets.lambda).
 */
export async function listDataTaggedS3Buckets(): Promise<S3BucketCatalogEntry[]> {
  const response: ListBucketsCommandOutput = await s3Service.listBuckets({});
  if (!response.Buckets) {
    throw new Error(`Unable to list Buckets: ${JSON.stringify(response)}`);
  }

  const buckets: Bucket[] = response.Buckets.filter(
    (bucket: Bucket) => bucket.Name && !isExcludedCatalogBucketName(bucket.Name),
  );

  const bucketTags: Awaited<GetBucketTaggingCommandOutput>[] = await Promise.all(
    buckets.map((bucket: Bucket) => s3Service.getBucketTagging({ Bucket: bucket.Name })),
  );

  const filteredBuckets: S3Bucket[] = [];
  bucketTags.forEach((bucketTag: GetBucketTaggingCommandOutput | undefined, index: number) => {
    if (bucketTag && bucketTagsIncludeDataType(bucketTag.TagSet)) {
      filteredBuckets.push(<S3Bucket>{ Name: buckets[index].Name });
    }
  });

  return filteredBuckets
    .map((b) => b.Name)
    .filter((name): name is string => !!name)
    .map((name) => ({ name }));
}
