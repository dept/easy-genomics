import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestPreviewWorkflowKeyOutputs,
  RequestPreviewWorkflowKeyOutputsSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import { PreviewWorkflowKeyOutputsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import {
  inferKeyOutputsFromSelection,
  scoreKeyOutputPatterns,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';
import {
  authorizeLaboratoryKeyOutputsAccess,
  runKeyOutputsRoot,
  toRunRelativePath,
} from '@BE/utils/workflow-key-output-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const s3Service = new S3Service();
const s3AccessService = new LaboratoryS3AccessService();

const MAX_LISTED_FILES = 25000;

/**
 * POST /easy-genomics/workflow-key-outputs/request-preview-workflow-key-outputs
 *
 * Infer globs from files ticked on a completed run, or score patterns the caller
 * already has (JSON editor), and return match counts against that run's outputs.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestPreviewWorkflowKeyOutputs = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!RequestPreviewWorkflowKeyOutputsSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await authorizeLaboratoryKeyOutputsAccess(event, laboratoryService, request.LaboratoryId);
    const run = await laboratoryRunService.get(request.LaboratoryId, request.RunId);
    const root = runKeyOutputsRoot(run);
    if (!root) {
      throw new InvalidRequestError('No S3 location is recorded for this run');
    }

    await assertLaboratoryHasS3BucketAccess(laboratory, root.bucket, s3AccessService);

    const listed = await s3Service.listAllObjectKeysUnderPrefix(root.bucket, root.prefix);
    const allRelativePaths = listed
      .slice(0, MAX_LISTED_FILES)
      .map((key) => toRunRelativePath(key, root.prefix))
      .filter((path): path is string => !!path);

    const inferred =
      request.ObjectKeys && request.ObjectKeys.length > 0
        ? inferKeyOutputsFromSelection(
            request.ObjectKeys.map((key) => toRunRelativePath(key, root.prefix)).filter(
              (path): path is string => !!path,
            ),
            allRelativePaths,
          )
        : scoreKeyOutputPatterns(
            (request.KeyOutputs ?? []).map((item) => ({
              Label: item.Label,
              Pattern: item.Pattern,
              ExamplePath: item.ExamplePath,
            })),
            allRelativePaths,
          );

    const response: PreviewWorkflowKeyOutputsResponse = {
      KeyOutputs: inferred.map((item) => ({
        KeyOutputId: uuidv4(),
        Label: item.Label,
        Pattern: item.Pattern,
        ExamplePath: item.ExamplePath,
        MatchCount: item.MatchCount,
      })),
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
