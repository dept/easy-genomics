import { Hash } from 'crypto';
import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';
import { formatUrl } from '@aws-sdk/util-format-url';
import { FileUploadInfo } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import { AwsCredentialIdentity } from '@smithy/types/dist-types/identity/awsCredentialIdentity';
import { parseUrl } from '@smithy/url-parser';

/**
 * This FE utility function just generates and returns a signed S3 URL for
 * uploading a file (PutObject command) to S3 without an S3 Client.
 *
 * The AWS credentials will need to be obtained from AWS Amplify Session.
 *
 * @param credentials
 * @param fileUploadInfo
 */
export async function getFileUploadSignedS3Url(
  credentials: AwsCredentialIdentity,
  fileUploadInfo: FileUploadInfo,
): Promise<string> {
  const bucket: string = fileUploadInfo.Bucket;
  const key: string = fileUploadInfo.Key;
  const region: string = fileUploadInfo.Region;

  const url = parseUrl(`https://${bucket}.s3.${region}.amazonaws.com/${key}`);
  const s3RequestPresigner = new S3RequestPresigner({
    credentials,
    region,
    sha256: Hash.bind(null, 'sha256'),
  });

  const signedUrlObject = await s3RequestPresigner.presign(new HttpRequest({ ...url, method: 'PUT' }));
  return formatUrl(signedUrlObject);
}
