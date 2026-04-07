import { GetWorkflowCommandInput } from '@aws-sdk/client-omics';
import { Handler } from 'aws-lambda';
import { WorkflowSchemaService } from '@BE/services/aws-healthomics/workflow-schema-service';
import { OmicsService } from '@BE/services/omics-service';
import { SecretsManagerService } from '@BE/services/secrets-manager-service';

const omicsService = new OmicsService();
const secretsManagerService = new SecretsManagerService();
const workflowSchemaService = new WorkflowSchemaService();

const SCHEMA_FILE_PATH = 'nextflow_schema.json';
const SCHEMA_VERSION = '1';
const MAX_RETRIES = 3;

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

/**
 * Fetches the nextflow_schema.json from the GitHub Contents API with exponential-backoff retry.
 * Returns null if the file is not found (404).
 */
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
      const backoffMs = Math.pow(2, attempt) * 1000;
      console.warn(
        `[process-fetch-workflow-schema] Network error fetching schema, retrying in ${backoffMs}ms`,
        networkError,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return fetchGitHubSchema(owner, repo, token, attempt + 1);
    }
    throw networkError;
  }

  if (response.status === 404) {
    return null;
  }

  if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
    const backoffMs = Math.pow(2, attempt) * 1000;
    console.warn(`[process-fetch-workflow-schema] GitHub returned ${response.status}, retrying in ${backoffMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    return fetchGitHubSchema(owner, repo, token, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status} fetching ${SCHEMA_FILE_PATH}: ${await response.text()}`);
  }

  const data = (await response.json()) as { content: string; encoding: string };

  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding from GitHub Contents API: ${data.encoding}`);
  }

  const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
  return JSON.parse(decoded);
}

/**
 * Lambda triggered by EventBridge "Tag Change on Resource" events for HealthOmics workflows.
 * When the github-repo-url tag is set or updated on a workflow, this function:
 *  1. Reads the github-repo-url tag value via omics:GetWorkflow
 *  2. Fetches nextflow_schema.json from the linked GitHub repository
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

    // Fetch the workflow to confirm the github-repo-url tag is present
    const workflow = await omicsService.getWorkflow(<GetWorkflowCommandInput>{
      id: workflowId,
      type: 'PRIVATE',
    });

    const githubRepoUrl = workflow.tags?.['github-repo-url'];
    if (!githubRepoUrl) {
      console.warn(`[process-fetch-workflow-schema] Workflow ${workflowId} has no github-repo-url tag, skipping`);
      return;
    }

    // Retrieve GitHub PAT from Secrets Manager
    const secretName = process.env.GITHUB_PAT_SECRET_NAME;
    if (!secretName) {
      throw new Error('GITHUB_PAT_SECRET_NAME environment variable is not set');
    }

    const secretResponse = await secretsManagerService.getSecretValue({ SecretId: secretName });
    const githubToken = secretResponse.SecretString;
    if (!githubToken) {
      throw new Error('GitHub PAT secret has no value — set the secret in Secrets Manager after deploy');
    }

    const { owner, repo } = parseGitHubRepoUrl(githubRepoUrl);
    console.info(`[process-fetch-workflow-schema] Fetching ${SCHEMA_FILE_PATH} from ${owner}/${repo}`);

    const schema = await fetchGitHubSchema(owner, repo, githubToken);
    if (!schema) {
      console.error(`[process-fetch-workflow-schema] ${SCHEMA_FILE_PATH} not found in ${owner}/${repo}, skipping`);
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
