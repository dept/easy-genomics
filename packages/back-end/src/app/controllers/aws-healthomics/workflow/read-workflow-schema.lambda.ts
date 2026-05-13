import { GetWorkflowCommandInput } from '@aws-sdk/client-omics';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { WorkflowSchema, WorkflowSchemaService } from '@BE/services/aws-healthomics/workflow-schema-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { OmicsService } from '@BE/services/omics-service';
import { SecretsManagerService } from '@BE/services/secrets-manager-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const omicsService = new OmicsService();
const secretsManagerService = new SecretsManagerService();
const workflowSchemaService = new WorkflowSchemaService();

const SCHEMA_FILE_PATH = 'nextflow_schema.json';
const SCHEMA_VERSION = '1';
const MAX_RETRIES = 3;

// Module-level cache for warm Lambda invocations (key: workflowId#version)
const schemaCache = new Map<string, { schema: WorkflowSchema; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub repo URL: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

async function fetchGitHubSchema(owner: string, repo: string, token: string, attempt = 0): Promise<object | null> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${SCHEMA_FILE_PATH}`;
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'easy-genomics-schema-fetcher',
  };

  let response: Response;
  try {
    response = await fetch(apiUrl, { headers });
  } catch (networkError) {
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      return fetchGitHubSchema(owner, repo, token, attempt + 1);
    }
    throw networkError;
  }

  if (response.status === 404) return null;

  if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    return fetchGitHubSchema(owner, repo, token, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { content: string; encoding: string };
  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding from GitHub Contents API: ${data.encoding}`);
  }
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
}

/**
 * Fetches the GitHub PAT and falls back to fetching the schema directly from GitHub.
 * Used when DynamoDB has no cached schema (EventBridge trigger may have failed).
 */
async function fetchSchemaFromGitHub(workflowId: string): Promise<WorkflowSchema | null> {
  const workflow = await omicsService.getWorkflow(<GetWorkflowCommandInput>{
    id: workflowId,
    type: 'PRIVATE',
  });

  const githubRepoUrl = workflow.tags?.['github-repo-url'];
  if (!githubRepoUrl) {
    return null;
  }

  const secretName = process.env.GITHUB_PAT_SECRET_NAME;
  if (!secretName) return null;

  const secretResponse = await secretsManagerService.getSecretValue({ SecretId: secretName });
  const githubToken = secretResponse.SecretString;
  if (!githubToken) return null;

  const { owner, repo } = parseGitHubRepoUrl(githubRepoUrl);
  const schema = await fetchGitHubSchema(owner, repo, githubToken);
  if (!schema) return null;

  return {
    WorkflowId: workflowId,
    Version: SCHEMA_VERSION,
    Schema: schema,
    UpdatedAt: new Date().toISOString(),
  };
}

/**
 * GET /aws-healthomics/workflow/read-workflow-schema/{id}?laboratoryId={laboratoryId}
 *
 * Returns the cached nf-core JSON Schema for a HealthOmics workflow.
 * The schema is used by the frontend to enrich the workflow's parameterTemplate
 * (already returned by HealthOmics) with type info, defaults, enums, and descriptions.
 *
 * Resolution order:
 *  1. In-memory module-level cache (warm Lambda invocations)
 *  2. DynamoDB lookup by WorkflowId + Version
 *  3. Direct GitHub fetch as fallback (if EventBridge trigger failed)
 *
 * Required path parameter:
 *  - id: HealthOmics workflow ID
 * Required query parameter:
 *  - laboratoryId: to verify the caller's lab access
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const workflowId = event.pathParameters?.id || '';
    if (workflowId === '') throw new RequiredIdNotFoundError();

    const laboratoryId = event.queryStringParameters?.laboratoryId || '';
    if (laboratoryId === '') throw new RequiredIdNotFoundError('laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) {
      throw new RequiredIdNotFoundError('laboratoryId');
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

    // 1. In-memory cache check
    const cacheKey = `${workflowId}#${SCHEMA_VERSION}`;
    const cached = schemaCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      console.info(`[read-workflow-schema] Cache hit for WorkflowId=${workflowId}`);
      return buildResponse(200, JSON.stringify(cached.schema), event);
    }

    // 2. DynamoDB lookup
    let schema = await workflowSchemaService.getSchema(workflowId, SCHEMA_VERSION);

    // 3. GitHub fallback — also persist to DynamoDB so subsequent cold starts avoid hitting GitHub
    if (!schema) {
      console.warn(`[read-workflow-schema] No schema in DynamoDB for WorkflowId=${workflowId}, falling back to GitHub`);
      schema = await fetchSchemaFromGitHub(workflowId);
      if (schema) {
        workflowSchemaService.saveSchema(schema).catch((err) => {
          console.warn('[read-workflow-schema] Failed to persist GitHub-fetched schema to DynamoDB:', err);
        });
      }
    }

    if (!schema) {
      return buildResponse(204, JSON.stringify({ message: 'No schema available for this workflow' }), event);
    }

    // Populate cache for subsequent warm invocations
    schemaCache.set(cacheKey, { schema, cachedAt: Date.now() });

    return buildResponse(200, JSON.stringify(schema), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
