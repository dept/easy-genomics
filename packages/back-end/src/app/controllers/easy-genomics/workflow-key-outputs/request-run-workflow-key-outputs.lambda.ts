import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  RequestRunWorkflowKeyOutputs,
  RequestRunWorkflowKeyOutputsSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import { RunWorkflowKeyOutputsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import {
  groupKeyOutputExamples,
  listKeyOutputMatches,
} from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-patterns';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { WorkflowKeyOutputsService } from '@BE/services/easy-genomics/workflow-key-outputs-service';
import { S3Service } from '@BE/services/s3-service';
import { assertLaboratoryHasS3BucketAccess } from '@BE/utils/laboratory-s3-access-utils';
import {
  authorizeLaboratoryKeyOutputsAccess,
  runKeyOutputsRoot,
  toRunRelativePath,
} from '@BE/utils/workflow-key-output-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();
const workflowKeyOutputsService = new WorkflowKeyOutputsService();
const s3Service = new S3Service();
const s3AccessService = new LaboratoryS3AccessService();

const MAX_LISTED_FILES = 25000;
const MAX_MATCHES_PER_ROLE = 1000;

/**
 * POST /easy-genomics/workflow-key-outputs/request-run-workflow-key-outputs
 *
 * Score the lab's saved key-outputs definition against this run and return the
 * matching files so File Manager can pin them above the full tree.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: RequestRunWorkflowKeyOutputs = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!RequestRunWorkflowKeyOutputsSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    const laboratory = await authorizeLaboratoryKeyOutputsAccess(event, laboratoryService, request.LaboratoryId);
    const run = await laboratoryRunService.get(request.LaboratoryId, request.RunId);
    const workflowId = run.WorkflowExternalId || '';
    const root = runKeyOutputsRoot(run);
    if (!root) {
      throw new InvalidRequestError('No S3 location is recorded for this run');
    }

    await assertLaboratoryHasS3BucketAccess(laboratory, root.bucket, s3AccessService);

    const listed = (await s3Service.listAllObjectsUnderPrefix(root.bucket, root.prefix)).slice(0, MAX_LISTED_FILES);
    const files = listed
      .map((object) => {
        const relativePath = toRunRelativePath(object.Key, root.prefix);
        if (!relativePath) return null;
        return { Key: object.Key, RelativePath: relativePath, Size: object.Size ?? 0 };
      })
      .filter((file): file is { Key: string; RelativePath: string; Size: number } => !!file);
    const groups = groupKeyOutputExamples(files);

    if (!workflowId) {
      return buildResponse(
        200,
        JSON.stringify({
          LaboratoryId: request.LaboratoryId,
          RunId: request.RunId,
          WorkflowId: workflowId,
          S3Bucket: root.bucket,
          S3Prefix: root.prefix,
          TotalFileCount: files.length,
          MatchedFileCount: 0,
          MatchedSizeBytes: 0,
          KeyOutputs: [],
          Groups: groups,
        } satisfies RunWorkflowKeyOutputsResponse),
        event,
      );
    }

    const definition = await workflowKeyOutputsService.get(request.LaboratoryId, workflowId);
    const uniqueMatched = new Set<string>();
    let matchedSizeBytes = 0;
    const keyOutputs = (definition?.KeyOutputs ?? []).map((item) => {
      const matches = listKeyOutputMatches(item.Pattern, files);
      for (const match of matches) {
        if (!uniqueMatched.has(match.Key)) {
          uniqueMatched.add(match.Key);
          matchedSizeBytes += match.Size;
        }
      }
      const matchSizeBytes = matches.reduce((sum, match) => sum + match.Size, 0);
      return {
        ...item,
        MatchCount: matches.length,
        MatchSizeBytes: matchSizeBytes,
        Matches: matches.slice(0, MAX_MATCHES_PER_ROLE),
      };
    });

    const response: RunWorkflowKeyOutputsResponse = {
      LaboratoryId: request.LaboratoryId,
      RunId: request.RunId,
      WorkflowId: workflowId,
      S3Bucket: root.bucket,
      S3Prefix: root.prefix,
      TotalFileCount: files.length,
      MatchedFileCount: uniqueMatched.size,
      MatchedSizeBytes: matchedSizeBytes,
      KeyOutputs: keyOutputs,
      Groups: groups,
    };

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
