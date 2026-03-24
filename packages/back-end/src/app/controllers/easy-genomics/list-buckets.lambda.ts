import { Bucket, GetBucketTaggingCommandOutput, ListBucketsCommandOutput, Tag } from '@aws-sdk/client-s3';
import { buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { S3Bucket } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/s3-bucket';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { S3Service } from '../../services/s3-service';

const s3Service = new S3Service();

/**
 * This API endpoint is designed to allow customers to obtain list of existing
 * S3 buckets within their AWS account with the intent of allowing the
 * Organization Administrator to select an existing S3 Bucket for use by a
 * Laboratory instead of the auto-provisioned S3 Bucket.
 *
 * The list of existing S3 Buckets returned by this API is filtered by reading
 * the respective Bucket's tags and checking if it contains the tag key/value
 * pair:
 *  - 'easy-genomics:s3-bucket-type': 'data'
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const response: ListBucketsCommandOutput = await s3Service.listBuckets({});
    if (response.Buckets) {
      // Exclude CDK, and Amplify S3 Buckets
      const buckets: Bucket[] = response.Buckets.filter(
        (bucket: Bucket) => !bucket.Name?.startsWith('cdk') && !bucket.Name?.startsWith('amplify'),
      );

      // Lookup all the name filtered Bucket's tags asynchronously in parallel
      const bucketTags: Awaited<GetBucketTaggingCommandOutput>[] = await Promise.all(
        buckets.map((bucket: Bucket) => s3Service.getBucketTagging({ Bucket: bucket.Name })),
      );

      // Filter for only Buckets with readable Tags and have matching tag key/values:
      //  - 'easy-genomics:s3-bucket-type': 'data'
      const filteredBuckets: S3Bucket[] = [];
      bucketTags.forEach((bucketTag: GetBucketTaggingCommandOutput | undefined, index: number) => {
        // AWS S3 prevents looking up a Bucket's tags if the Bucket exists in a different AWS Region,
        // so the bucketTag's undefined response can be used effectively to identify Bucket's to ignore.
        if (bucketTag) {
          const ts: Tag[] | undefined = bucketTag.TagSet;
          if (ts && ts.find((t: Tag) => t.Key === 'easy-genomics:s3-bucket-type' && t.Value === 'data')) {
            filteredBuckets.push(<S3Bucket>{ Name: buckets[index].Name });
          }
        }
      });
      return buildResponse(200, JSON.stringify(filteredBuckets), event);
    } else {
      throw new Error(`Unable to list Buckets: ${JSON.stringify(response)}`);
    }
  } catch (err: any) {
    console.error(err);
    return {
      statusCode: 400,
      body: `Error: ${err.message}`,
    };
  }
};
