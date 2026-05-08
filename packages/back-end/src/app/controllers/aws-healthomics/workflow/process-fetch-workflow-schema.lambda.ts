import { GetWorkflowCommandInput } from '@aws-sdk/client-omics';
import { Handler } from 'aws-lambda';
import { fetchGitHubSchemaJsonFile } from '@BE/services/aws-healthomics/fetch-github-schema-json';
import { GITHUB_SCHEMA_URL_TAG, parseGitHubSchemaFileUrl } from '@BE/services/aws-healthomics/parse-github-schema-url';
import { WorkflowSchemaService } from '@BE/services/aws-healthomics/workflow-schema-service';
import { OmicsService } from '@BE/services/omics-service';
import { SecretsManagerService } from '@BE/services/secrets-manager-service';
import { SsmService } from '@BE/services/ssm-service';

const omicsService = new OmicsService();
const secretsManagerService = new SecretsManagerService();
const ssmService = new SsmService();
const workflowSchemaService = new WorkflowSchemaService();

const SCHEMA_FILE_PATH = 'nextflow_schema.json';
const SCHEMA_VERSION = '1';

interface EventBridgeTagChangeEvent {
  source: string;
  'detail-type': string;
  resources: string[];
  detail: {
    'changed-tag-keys': string[];
    tags?: Record<string, string>;
  };
}

/**
 * Parses a GitHub repo URL into owner and repo name.
 * Supports formats:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 */
function parseGitHubRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub repo URL: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Extracts the HealthOmics workflow ID from its ARN.
 * ARN format: arn:aws:omics:REGION:ACCOUNT:workflow/WORKFLOW_ID
 */
function workflowIdFromArn(arn: string): string {
  const parts = arn.split('/');
  const id = parts[parts.length - 1];
  if (!id) throw new Error(`Cannot extract workflow ID from ARN: ${arn}`);
  return id;
}

async function resolveGitHubToken(workflowTags?: Record<string, string>): Promise<string> {
  const organizationId = workflowTags?.OrganizationId?.trim();
  const laboratoryId = workflowTags?.LaboratoryId?.trim();
  if (organizationId && laboratoryId) {
    const tokenParameterName = `/easy-genomics/organization/${organizationId}/laboratory/${laboratoryId}/github-access-token`;
    try {
      const parameter = await ssmService.getParameter({
        Name: tokenParameterName,
        WithDecryption: true,
      });
      const laboratoryGitHubToken = parameter.Parameter?.Value?.trim();
      if (laboratoryGitHubToken) {
        return laboratoryGitHubToken;
      }
      console.warn(
        `[process-fetch-workflow-schema] Empty lab GitHub token at ${tokenParameterName}, falling back to project secret`,
      );
    } catch (error: any) {
      if (error?.name !== 'ParameterNotFound') {
        throw error;
      }
      console.info(
        `[process-fetch-workflow-schema] Lab GitHub token not found at ${tokenParameterName}, falling back to project secret`,
      );
    }
  } else {
    console.info(
      '[process-fetch-workflow-schema] Missing OrganizationId/LaboratoryId workflow tags, falling back to project secret',
    );
  }

  const secretName = process.env.GITHUB_PAT_SECRET_NAME;
  if (!secretName) {
    throw new Error('GITHUB_PAT_SECRET_NAME environment variable is not set');
  }

  const secretResponse = await secretsManagerService.getSecretValue({ SecretId: secretName });
  const githubToken = secretResponse.SecretString?.trim();
  if (!githubToken) {
    throw new Error('GitHub PAT secret has no value — set the secret in Secrets Manager after deploy');
  }

  return githubToken;
}

/**
 * Lambda triggered by EventBridge "Tag Change on Resource" events for HealthOmics workflows.
 * When the github-repo-url or github-schema-url tag is set or updated on a workflow, this function:
 *  1. Reads tags via omics:GetWorkflow
 *  2. If github-schema-url is set, fetches that file (blob or raw URL). Else uses github-repo-url
 *     and fetches nextflow_schema.json at the repository root.
 *  3. Stores the schema in the workflow-schema DynamoDB table
 *
 * The schema is later used by read-workflow-schema to enrich the workflow's
 * parameterTemplate (already available from HealthOmics) with type info,
 * defaults, enums, and descriptions defined in the nf-core JSON Schema format.
 */
export const handler: Handler = async (event: EventBridgeTagChangeEvent): Promise<void> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));

  try {
    const workflowArn = event.resources?.[0];
    if (!workflowArn) {
      console.error('[process-fetch-workflow-schema] No resource ARN in event, skipping');
      return;
    }

    const workflowId = workflowIdFromArn(workflowArn);
    console.info(`[process-fetch-workflow-schema] Processing workflow ID: ${workflowId}`);

    const workflow = await omicsService.getWorkflow(<GetWorkflowCommandInput>{
      id: workflowId,
      type: 'PRIVATE',
    });

    const githubSchemaUrlTag = workflow.tags?.[GITHUB_SCHEMA_URL_TAG];
    const githubRepoUrl = workflow.tags?.['github-repo-url'];

    let owner: string;
    let repo: string;
    let filePath: string;
    let gitRef: string | undefined;

    if (githubSchemaUrlTag) {
      const parsed = parseGitHubSchemaFileUrl(githubSchemaUrlTag);
      if (!parsed) {
        console.warn(
          `[process-fetch-workflow-schema] Workflow ${workflowId} has invalid ${GITHUB_SCHEMA_URL_TAG} tag, skipping`,
        );
        return;
      }
      ({ owner, repo, ref: gitRef, path: filePath } = parsed);
    } else if (githubRepoUrl) {
      ({ owner, repo } = parseGitHubRepoUrl(githubRepoUrl));
      filePath = SCHEMA_FILE_PATH;
      gitRef = undefined;
    } else {
      console.warn(
        `[process-fetch-workflow-schema] Workflow ${workflowId} has no ${GITHUB_SCHEMA_URL_TAG} or github-repo-url tag, skipping`,
      );
      return;
    }

    const githubToken = await resolveGitHubToken(workflow.tags);

    console.info(`[process-fetch-workflow-schema] Fetching ${filePath} from ${owner}/${repo}`);

    const schema = await fetchGitHubSchemaJsonFile(owner, repo, filePath, githubToken, gitRef);
    if (!schema) {
      console.error(`[process-fetch-workflow-schema] ${filePath} not found in ${owner}/${repo}, skipping`);
      return;
    }

    await workflowSchemaService.saveSchema({
      WorkflowId: workflowId,
      Version: SCHEMA_VERSION,
      Schema: schema,
      UpdatedAt: new Date().toISOString(),
    });

    console.info(
      `[process-fetch-workflow-schema] Schema saved for WorkflowId=${workflowId}, Version=${SCHEMA_VERSION}`,
    );
  } catch (err: any) {
    console.error('[process-fetch-workflow-schema] Unhandled error:', err);
    throw err; // Re-throw so Lambda can retry if needed
  }
};
