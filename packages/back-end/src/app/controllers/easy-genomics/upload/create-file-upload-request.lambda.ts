import { GetBucketLocationCommandOutput } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { FileUploadRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/upload/s3-file-upload-manifest';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  FileUploadRequest,
  FileUploadManifest,
  FileInfo,
  FileUploadInfo,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-manifest';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';

const EASY_GENOMICS_SINGLE_FILE_TRANSFER_LIMIT: number = 5 * Math.pow(1024, 3); // 5GiB

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

/**
 * This API expects a LaboratoryId and a list of file details (consisting of the
 * filename and size) that will be uploaded to S3.
 *
 * This API checks each of the file's sizes and generates list of S3 URLs for
 * each of the filenames for the FE. The generated S3 URLs are then used by the
 * FE to generate a signed-url to perform the upload securely.
 *
 * By only requesting the signed-url at the time needed, it will minimise the
 * duration of the signed-url's expiry window to enhance security.
 *
 * The file size checking logic will later be extended to support multi-part
 * S3 upload URL generations for files larger than 5GiB to 5TiB.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Post Request Body
    const request: FileUploadRequest = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Data validation safety check
    if (!FileUploadRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    const laboratoryId: string = request.LaboratoryId;
    /**
     * Random UUID transactionId received from FE to collate the uploaded files.
     * It is necessary for the FE to generate and maintain this transactionId
     * so the FE can allow the user to upload additional files to the same S3
     * location if required.
     */
    const transactionId: string = request.TransactionId;
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    const s3Bucket: string | undefined = laboratory.S3Bucket;
    if (!s3Bucket) {
      throw new Error(`Laboratory ${laboratoryId} S3 Bucket needs to be configured`);
    }

    // Retrieve S3 Bucket Region and also sanity check S3 Bucket exists still
    const bucketLocation = await s3Service
      .getBucketLocation({
        Bucket: s3Bucket,
      })
      .then((result: GetBucketLocationCommandOutput) => {
        if (result.$metadata.httpStatusCode === 200) {
          return result.LocationConstraint;
        } else {
          throw new Error(`Laboratory ${laboratoryId} S3 Bucket access error: ${result.$metadata.httpStatusCode}`);
        }
      })
      .catch((error) => {
        throw new Error(`Laboratory ${laboratoryId} S3 Bucket access error: ${error.toString()}`);
      });

    // S3 Buckets in Region us-east-1 have a LocationConstraint of null.
    const s3Region: string = bucketLocation ? bucketLocation : 'us-east-1';

    const files: FileUploadInfo[] = await Promise.all(
      request.Files.map(async (file: FileInfo) => {
        // Sanity checks
        if (file.Name.length === 0) {
          throw new Error(`File name is invalid: '${file.Name}'`);
        }
        if (file.Size === 0) {
          throw new Error(`File size is invalid: '${file.Name}'`);
        }

        /**
         * If a file size is greater than the EASY_GENOMICS_SINGLE_FILE_TRANSFER_LIMIT then throw an error,
         * otherwise default to generating a single upload S3 URL for the respective file.
         */
        if (file.Size > EASY_GENOMICS_SINGLE_FILE_TRANSFER_LIMIT) {
          throw new Error(`File size is too large: '${file.Name}'`);
        } else {
          /**
           * The S3 Key will consist of: {organizationId}/{laboratoryId}/{platform}/{transactionId}/{file name}
           */
          const platform: string = request.Platform === 'AWS HealthOmics' ? 'aws-healthomics' : 'seqera-platform';
          const s3Path: string = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/${platform}/${transactionId}`;
          const s3Key: string = `${s3Path}/${file.Name}`;

          const preSignedUrl = await s3Service.getPreSignedUploadUrl({
            Bucket: s3Bucket,
            Key: s3Key,
            ContentLength: file.Size,
          });

          return {
            ...file,
            Bucket: s3Bucket,
            Key: s3Key,
            Region: s3Region,
            S3Url: preSignedUrl,
          };
        }
      }),
    );

    const response: FileUploadManifest = {
      TransactionId: transactionId,
      Files: files,
    };
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
