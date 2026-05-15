import { createHash } from 'crypto';
import { PutObjectCommandOutput } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { logSafeEvent } from '@easy-genomics/shared-lib/lib/app/utils/logSafeEvent';
import { SampleSheetRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/upload/s3-file-upload-sample-sheet';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  SampleSheetRequest,
  SampleSheetResponse,
  UploadedFilePairInfo,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-sample-sheet';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';

const SAMPLE_SHEET_CSV_HEADER: string[] = ['sample,fastq_1,fastq_2'];

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

/**
 * The SampleSheetRequest's supplied UploadedFiles array is intended to allow
 * the user to use the FE stepper to go back and forth to upload additional
 * files or de-select/remove any uploaded files to correct the generated CSV
 * sample-sheet to provided better usability.
 *
 * This will allow the user to easily amend the generated CSV sample-sheet
 * without having to restart the entire Pipeline Run setup if they uploaded
 * incorrect / unnecessary sequence files.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  logSafeEvent(event);
  try {
    // Post Request Body
    const request: SampleSheetRequest = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    // Optional Query Parameter
    const validateS3FilesExist: boolean = event.queryStringParameters?.validate === 'true';

    // Data validation safety check
    const requestParseResult = SampleSheetRequestSchema.safeParse(request);
    if (!requestParseResult.success) {
      requestParseResult.error.issues.forEach((issue) => console.error(issue));
      throw new InvalidRequestError('Invalid sample sheet request');
    }

    const sampleSheetName: string = request.SampleSheetName;
    if (!sampleSheetName.match(/^[a-zA-Z0-9._:!@#$%^()-]+(\.csv)$/)) {
      throw new InvalidRequestError(`Invalid sample sheet name: ${sampleSheetName}`);
    }

    const laboratoryId: string = request.LaboratoryId;
    const transactionId: string = request.TransactionId;
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);

    const s3Bucket: string | undefined = laboratory.S3Bucket;
    if (!s3Bucket) {
      throw new InvalidRequestError(`Laboratory ${laboratoryId} S3 Bucket needs to be configured`);
    }

    const platform: string = request.Platform === 'AWS HealthOmics' ? 'aws-healthomics' : 'seqera-platform';
    const s3Path: string = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/${platform}/${transactionId}`;
    const s3Key: string = `${s3Path}/${sampleSheetName}`;
    const s3Url: string = `s3://${s3Bucket}/${s3Key}`;
    const bucketLocation = (await s3Service.getBucketLocation({ Bucket: s3Bucket })).LocationConstraint;

    // S3 Buckets in Region us-east-1 have a LocationConstraint of null.
    const s3Region: string = bucketLocation ? bucketLocation : 'us-east-1';
    const sampleSheetType: string = getSampleSheetType(request);

    // Validate SampleSheet request to check for any duplicate SampleIds
    const sampleIds: string[] = request.UploadedFilePairs.map((_: UploadedFilePairInfo) => _.SampleId);
    if (sampleIds.length !== [...new Set(sampleIds)].length) {
      throw new InvalidRequestError('Invalid sample sheet request: duplicate Sample Id(s) found');
    }

    const sampleSheetCsv: string =
      sampleSheetType === 'paired-read'
        ? await generatePairedReadsSampleSheetCsv(request.UploadedFilePairs, validateS3FilesExist)
        : await generateSingleReadSampleSheetCsv(request.UploadedFilePairs, validateS3FilesExist);
    const sampleSheetCsvChecksum: string = createHash('sha256').update(sampleSheetCsv).digest('hex');

    const result: PutObjectCommandOutput = await s3Service.putObject({
      ACL: 'private',
      Bucket: s3Bucket,
      Key: s3Key,
      Body: sampleSheetCsv,
      ContentType: 'text/csv',
      ContentLength: sampleSheetCsv.length, // Required for S3 upload to work
    });

    if (result.$metadata.httpStatusCode !== 200) {
      throw new Error(
        `Unable to write '${s3Key}' to S3 Bucket '${s3Bucket}': Error ${result.$metadata.httpStatusCode}`,
      );
    } else {
      const response: SampleSheetResponse = {
        TransactionId: transactionId,
        SampleSheetInfo: {
          Name: sampleSheetName,
          Size: sampleSheetCsv.length,
          Checksum: sampleSheetCsvChecksum,
          Bucket: s3Bucket,
          Key: s3Key,
          Path: s3Path,
          Region: s3Region,
          S3Url: s3Url,
          SampleSheetType: sampleSheetType,
        },
      };
      return buildResponse(200, JSON.stringify(response), event);
    }
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

/**
 * Helper function to get the type of sample-sheet request and will return either:
 *  - 'single-read'
 *  - 'paired-read'
 *
 * @param request
 */
function getSampleSheetType(request: SampleSheetRequest) {
  // Check request has supplied a paired-read R1 & R2 sample sheet
  const r1Info: boolean[] = request.UploadedFilePairs.map((row: UploadedFilePairInfo) => row.R1 != undefined);
  const r2Info: boolean[] = request.UploadedFilePairs.map((row: UploadedFilePairInfo) => row.R2 != undefined);

  // Check if R1 / R2 has any entries defined
  const r1InfoDefined = r1Info.includes(true);
  const r2InfoDefined = r2Info.includes(true);

  if (r1InfoDefined && !r2InfoDefined) {
    const r1InfoAllValid = r1Info.every((r1Defined: boolean) => r1Defined === true);

    if (!r1InfoAllValid) {
      throw new InvalidRequestError('Invalid single-read sample files supplied');
    }

    return 'single-read';
  } else if (r1InfoDefined && r2InfoDefined) {
    const r1InfoAllValid = r1Info.every((r1Defined: boolean) => r1Defined === true);
    const r2InfoAllValid = r2Info.every((r2Defined: boolean) => r2Defined === true);

    if (!r1InfoAllValid) {
      throw new InvalidRequestError('Invalid paired-read R1 sample files supplied');
    }
    if (!r2InfoAllValid) {
      throw new InvalidRequestError('Invalid paired-read R2 sample files supplied');
    }

    return 'paired-read';
  } else {
    throw new InvalidRequestError('Invalid paired-read R1 / R2 sample files supplied');
  }
}

/**
 * Helper function to generate single-read CSV Sample-Sheet from supplied array of
 * UploadedFilePairInfo definitions, which each consisting of only R1 values.
 *
 * @param uploadedFilePairs
 */
async function generateSingleReadSampleSheetCsv(
  uploadedFilePairs: UploadedFilePairInfo[],
  validateS3FilesExist: boolean,
): Promise<string> {
  /**
   * Iterate over the supplied list of UploadedFiles to check the single R1 file exist, and generate CSV sample-sheet row record.
   */
  const sampleSheetCsvData: string[] = (
    await Promise.all(
      uploadedFilePairs.map(async (uploadedFilePair: UploadedFilePairInfo) => {
        const r1 = uploadedFilePair.R1;

        // Check the single-read R1 details are supplied
        if (!r1) {
          throw new InvalidRequestError('Single read sample file undefined');
        }

        // Check the single-read R1 file starts with the supplied SampleId
        const r1FileName: string | undefined = r1.Key.split('/').pop();
        if (!r1FileName || !r1FileName.startsWith(uploadedFilePair.SampleId)) {
          throw new InvalidRequestError(
            `Sample Id '${uploadedFilePair.SampleId}' does not match single-read sample file: ${r1.Key}`,
          );
        }

        if (validateS3FilesExist) {
          // Check the single-read R1 file exists in the S3 Bucket / Key location
          const singleReadFileExists: boolean = await s3Service.doesObjectExist({ Bucket: r1.Bucket, Key: r1.Key });
          if (!singleReadFileExists) {
            throw new InvalidRequestError(`Single read sample file not found: ${r1.Key}`);
          }

          return `${uploadedFilePair.SampleId},s3://${r1.Bucket}/${r1.Key},`; // CSV Sample-Sheet row
        } else {
          return `${uploadedFilePair.SampleId},s3://${r1.Bucket}/${r1.Key},`; // CSV Sample-Sheet row
        }
      }),
    )
  ).map((csvRow: Awaited<string>) => {
    return csvRow;
  });

  const sampleSheetCsv: string = [...SAMPLE_SHEET_CSV_HEADER, ...sampleSheetCsvData].join('\n');
  return sampleSheetCsv;
}

/**
 * Helper function to generate paired-read CSV Sample-Sheet from supplied array of
 * UploadedFilePairInfo definitions, which each consisting of both R1 & R1 pairs.
 *
 * @param uploadedFilePairs
 */
async function generatePairedReadsSampleSheetCsv(
  uploadedFilePairs: UploadedFilePairInfo[],
  validateS3FilesExist: boolean,
): Promise<string> {
  /**
   * Iterate over the supplied list of UploadedFiles to check the paired R1 & R2 files exist, and generate CSV sample-sheet row record.
   */
  const sampleSheetCsvData: string[] = (
    await Promise.all(
      uploadedFilePairs.map(async (uploadedFilePair: UploadedFilePairInfo) => {
        const r1 = uploadedFilePair.R1;
        const r2 = uploadedFilePair.R2;

        // Check the paired-read R1 and R2 details are supplied
        if (!(r1 && r2)) {
          throw new InvalidRequestError('Paired read R1/R2 sample file(s) undefined');
        }

        // Check the paired-read R1 & R2 files starts with the supplied SampleId
        const r1FileName: string | undefined = r1.Key.split('/').pop();
        const r2FileName: string | undefined = r2.Key.split('/').pop();
        if (!r1FileName || !r1FileName.startsWith(uploadedFilePair.SampleId)) {
          throw new InvalidRequestError(
            `Sample Id '${uploadedFilePair.SampleId}' does not match paired-read R1 sample file: ${r1.Key}`,
          );
        }
        if (!r2FileName || !r2FileName.startsWith(uploadedFilePair.SampleId)) {
          throw new InvalidRequestError(
            `Sample Id '${uploadedFilePair.SampleId}' does not match paired-read R2 sample file: ${r2.Key}`,
          );
        }

        if (r1FileName == r2FileName) {
          throw new InvalidRequestError(
            `Sample Id '${uploadedFilePair.SampleId}' R1 and R2 paired-read sample files have the same name: ${r1FileName}`,
          );
        }

        // Only check if Sample files exists on S3 if validateS3FilesExist query parameter is supplied
        if (validateS3FilesExist) {
          // Check the paired-read R1 & R2 files exist in the S3 Bucket / Key location
          const pairedReadFilesExist: boolean[] = await Promise.all([
            s3Service.doesObjectExist({ Bucket: r1.Bucket, Key: r1.Key }),
            s3Service.doesObjectExist({ Bucket: r2.Bucket, Key: r2.Key }),
          ]);
          if (!pairedReadFilesExist[0]) {
            throw new InvalidRequestError(`Paired read R1 sample file not found: ${r1.Key}`);
          }
          if (!pairedReadFilesExist[1]) {
            throw new InvalidRequestError(`Paired read R2 sample file not found: ${r2.Key}`);
          }

          return `${uploadedFilePair.SampleId},s3://${r1.Bucket}/${r1.Key},s3://${r2.Bucket}/${r2.Key}`; // CSV Sample-Sheet row
        } else {
          return `${uploadedFilePair.SampleId},s3://${r1.Bucket}/${r1.Key},s3://${r2.Bucket}/${r2.Key}`; // CSV Sample-Sheet row
        }
      }),
    )
  ).map((csvRow: Awaited<string>) => {
    return csvRow;
  });

  const sampleSheetCsv: string = [...SAMPLE_SHEET_CSV_HEADER, ...sampleSheetCsvData].join('\n');
  return sampleSheetCsv;
}
