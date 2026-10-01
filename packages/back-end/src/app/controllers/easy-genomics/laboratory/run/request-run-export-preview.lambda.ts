import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestRunExportPreview,
  RequestRunExportPreviewSchema,
  RunExportPreviewResponse,
  RunExportPreviewRun,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run/request-run-export-job';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';
import {
  RUN_EXPORT_MAX_EXPANDED_OBJECTS,
  RUN_EXPORT_TOO_MANY_OBJECTS_MESSAGE,
  RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES,
  assertCompletedRun,
  listExportableRunObjects,
  resolveRunOutputLocation,
  uniqueRunIds,
} from '@BE/utils/run-export-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const s3Service = new S3Service();
const s3AccessService = new LaboratoryS3AccessService();

/**
 * Returns exportable size for one or more completed runs so the UI can choose
 * ZIP download vs S3/LIMS copy before starting a job.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestRunExportPreview = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);

    const parsed = RequestRunExportPreviewSchema.safeParse(request);
    if (!parsed.success) {
      throw new InvalidRequestError();
    }

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(parsed.data.LaboratoryId);
    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const runPreviews: RunExportPreviewRun[] = [];
    let fileCount = 0;
    let totalBytes = 0;

    for (const runId of uniqueRunIds(parsed.data.RunIds)) {
      const run: LaboratoryRun = await laboratoryRunService.queryByRunId(runId);
      if (run.LaboratoryId !== laboratory.LaboratoryId) {
        throw new UnauthorizedAccessError();
      }
      assertCompletedRun(run);

      const source = resolveRunOutputLocation(run);
      await assertLaboratoryHasS3BucketAccess(laboratory, source.bucket, s3AccessService);
      const exportable = await listExportableRunObjects({
        s3: s3Service,
        bucket: source.bucket,
        runPrefix: source.prefix,
      });
      const runBytes = exportable.reduce((sum, object) => sum + object.Size, 0);
      fileCount += exportable.length;
      totalBytes += runBytes;
      if (fileCount > RUN_EXPORT_MAX_EXPANDED_OBJECTS) {
        throw new InvalidRequestError(RUN_EXPORT_TOO_MANY_OBJECTS_MESSAGE);
      }

      runPreviews.push({
        RunId: run.RunId,
        RunName: run.RunName,
        SourceS3Uri: source.uri,
        FileCount: exportable.length,
        TotalBytes: runBytes,
      });
    }

    const response: RunExportPreviewResponse = {
      RunCount: runPreviews.length,
      FileCount: fileCount,
      TotalBytes: totalBytes,
      CanDownloadAsZip: fileCount > 0 && totalBytes <= RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES,
      ZipSizeLimitBytes: RUN_EXPORT_ZIP_SIZE_LIMIT_BYTES,
      Runs: runPreviews,
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
