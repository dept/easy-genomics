import { randomUUID } from 'crypto';
import { CreateWorkflowCommandInput } from '@aws-sdk/client-omics';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { CreateWorkflowRequest } from '@easy-genomics/shared-lib/src/app/types/aws-healthomics/aws-healthomics-api';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '@BE/services/omics-lab-factory';
import { S3Service } from '@BE/services/s3-service';
import { SsmService } from '@BE/services/ssm-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();
const ssmService = new SsmService();
const CREATE_WORKFLOW_ALLOWED_KEYS = new Set([
  'name',
  'description',
  'engine',
  'definitionUri',
  'main',
  'requestId',
  'parameterTemplate',
  'storageCapacity',
  'storageType',
  'githubRepoUrl',
  'githubRef',
]);

type CreatePrivateWorkflowRequest = CreateWorkflowRequest & {
  githubRepoUrl?: string;
  githubRef?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidGitHubRepoUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?(?:\/)?$/i.test(url.trim());
}

function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i);
  if (!match) {
    throw new InvalidRequestError();
  }
  return { owner: match[1], repo: match[2] };
}

function sanitizeGitRef(ref: string): string {
  return ref.trim().replace(/^refs\/(heads|tags)\//, '');
}

async function uploadWorkflowZipFromGitHub(
  request: CreatePrivateWorkflowRequest,
  laboratory: Laboratory,
): Promise<{ definitionUri: string; main: string }> {
  const githubRepoUrl = request.githubRepoUrl?.trim() ?? '';
  const githubRef = sanitizeGitRef(request.githubRef?.trim() ?? 'main');
  const requestedMain = request.main.trim();
  if (!githubRepoUrl || !githubRef || !requestedMain) {
    throw new InvalidRequestError();
  }

  const tokenResponse = await ssmService.getParameter({
    Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/github-access-token`,
    WithDecryption: true,
  });
  const githubAccessToken = tokenResponse.Parameter?.Value;
  if (!githubAccessToken) {
    throw new UnauthorizedAccessError('GitHub token is not configured for this lab');
  }

  const { owner, repo } = parseGitHubRepoUrl(githubRepoUrl);
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${githubAccessToken}`,
    'User-Agent': 'easy-genomics-omics-workflow',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const archiveUrls = [
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(githubRef)}`,
    `https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${encodeURIComponent(githubRef)}`,
  ];
  let archiveResponse: Response | undefined;
  for (const archiveUrl of archiveUrls) {
    const candidate = await fetch(archiveUrl, { headers, redirect: 'follow' });
    if (candidate.ok) {
      archiveResponse = candidate;
      break;
    }
  }
  if (!archiveResponse) {
    throw new Error(`Failed to fetch repository archive from GitHub for ref '${githubRef}'`);
  }
  const archiveBody = Buffer.from(await archiveResponse.arrayBuffer());
  if (archiveBody.length < 1) {
    throw new Error('GitHub repository archive is empty');
  }

  const workflowUploadBucket = process.env.OMICS_WORKFLOW_UPLOAD_BUCKET;
  if (!workflowUploadBucket) {
    throw new Error('OMICS_WORKFLOW_UPLOAD_BUCKET is not configured');
  }

  const requestId = request.requestId?.trim() || randomUUID();
  const fileName = `${repo}-${githubRef}.zip`;
  const key = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/workflow-definitions/${requestId}/${fileName}`;
  await s3Service.putObject({
    Bucket: workflowUploadBucket,
    Key: key,
    Body: archiveBody,
    ContentType: 'application/zip',
  });

  return {
    definitionUri: `s3://${workflowUploadBucket}/${key}`,
    main: `${repo}-${githubRef.replace(/\//g, '-')}/${requestedMain}`,
  };
}

function isValidCreateWorkflowRequest(request: unknown): request is CreatePrivateWorkflowRequest {
  if (!isObject(request)) return false;

  const keys = Object.keys(request);
  if (keys.some((key) => !CREATE_WORKFLOW_ALLOWED_KEYS.has(key))) return false;

  const {
    name,
    description,
    engine,
    definitionUri,
    main,
    requestId,
    parameterTemplate,
    storageCapacity,
    storageType,
    githubRepoUrl,
    githubRef,
  } = request;

  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 64) return false;
  if (description !== undefined && (typeof description !== 'string' || description.length > 256)) return false;
  if (engine !== 'WDL' && engine !== 'NEXTFLOW' && engine !== 'CWL') return false;
  if (githubRepoUrl !== undefined && (typeof githubRepoUrl !== 'string' || !isValidGitHubRepoUrl(githubRepoUrl))) {
    return false;
  }
  if (
    githubRef !== undefined &&
    (typeof githubRef !== 'string' || githubRef.trim().length < 1 || githubRef.length > 128)
  ) {
    return false;
  }
  if (
    githubRepoUrl === undefined &&
    (typeof definitionUri !== 'string' || definitionUri.trim().length < 1 || definitionUri.length > 2048)
  ) {
    return false;
  }
  if (typeof main !== 'string' || main.trim().length < 1 || main.length > 2048) return false;
  if (typeof requestId !== 'string' || requestId.trim().length < 1 || requestId.length > 127) return false;
  if (storageType !== undefined && storageType !== 'STATIC' && storageType !== 'DYNAMIC') return false;
  if (
    storageCapacity !== undefined &&
    (typeof storageCapacity !== 'number' ||
      !Number.isInteger(storageCapacity) ||
      storageCapacity <= 0 ||
      storageCapacity > 100000)
  ) {
    return false;
  }
  if (parameterTemplate !== undefined && !isObject(parameterTemplate)) return false;

  return true;
}

/**
 * POST /aws-healthomics/workflow/create-private-workflow?laboratoryId={LaboratoryId}
 * Creates a new private AWS HealthOmics workflow for a laboratory.
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: CreatePrivateWorkflowRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!isValidCreateWorkflowRequest(request)) throw new InvalidRequestError();

    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();

    if (!laboratory.AwsHealthOmicsEnabled) {
      throw new UnauthorizedAccessError('Laboratory does not have AWS HealthOmics enabled');
    }

    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const userId: string | undefined =
      event.requestContext.authorizer?.claims?.sub ?? event.requestContext.authorizer?.claims?.['cognito:username'];
    const userEmail: string | undefined = event.requestContext.authorizer?.claims?.email;
    const omicsUserId = userId ?? 'unknown-user';
    const omicsService = await createOmicsServiceForLab(
      laboratory.LaboratoryId,
      laboratory.OrganizationId,
      omicsUserId,
    );

    let definitionUri = request.definitionUri;
    let main = request.main;
    if (request.githubRepoUrl) {
      const uploadedFromGitHub = await uploadWorkflowZipFromGitHub(request, laboratory);
      definitionUri = uploadedFromGitHub.definitionUri;
      main = uploadedFromGitHub.main;
    }

    const { githubRepoUrl, githubRef, ...workflowRequest } = request;
    const response = await omicsService.createWorkflow(<CreateWorkflowCommandInput>{
      ...workflowRequest,
      definitionUri,
      main,
      tags: {
        LaboratoryId: laboratory.LaboratoryId,
        OrganizationId: laboratory.OrganizationId,
        WorkflowName: request.name,
        ...(githubRepoUrl && { 'github-repo-url': githubRepoUrl }),
        ...(githubRef && { 'github-ref': githubRef }),
        ...(userId && { UserId: userId }),
        ...(userEmail && { UserEmail: userEmail }),
        Application: 'easy-genomics',
        Platform: 'AWS HealthOmics',
      },
    });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
