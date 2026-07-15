import { Bucket, GetBucketTaggingCommandOutput, ListBucketsCommandOutput, Tag } from '@aws-sdk/client-s3';
import { S3BucketCatalogEntry } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { S3Bucket } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/s3-bucket';
import { S3Service } from '../s3-service';

const s3Service = new S3Service();

/**
 * Lists data-tagged S3 buckets (same filter as list-buckets.lambda).
 */
export async function listDataTaggedS3Buckets(): Promise<S3BucketCatalogEntry[]> {
  const response: ListBucketsCommandOutput = await s3Service.listBuckets({});
  if (!response.Buckets) {
    throw new Error(`Unable to list Buckets: ${JSON.stringify(response)}`);
  }

  const buckets: Bucket[] = response.Buckets.filter(
    (bucket: Bucket) => !bucket.Name?.startsWith('cdk') && !bucket.Name?.startsWith('amplify'),
  );

  const bucketTags: Awaited<GetBucketTaggingCommandOutput>[] = await Promise.all(
    buckets.map((bucket: Bucket) => s3Service.getBucketTagging({ Bucket: bucket.Name })),
  );

  const filteredBuckets: S3Bucket[] = [];
  bucketTags.forEach((bucketTag: GetBucketTaggingCommandOutput | undefined, index: number) => {
    if (bucketTag) {
      const ts: Tag[] | undefined = bucketTag.TagSet;
      if (ts && ts.find((t: Tag) => t.Key === 'easy-genomics:s3-bucket-type' && t.Value === 'data')) {
        filteredBuckets.push(<S3Bucket>{ Name: buckets[index].Name });
      }
    }
  });

  return filteredBuckets
    .map((b) => b.Name)
    .filter((name): name is string => !!name)
    .map((name) => ({ name }));
}
