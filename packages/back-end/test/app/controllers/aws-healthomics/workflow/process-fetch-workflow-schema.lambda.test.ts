const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

jest.mock('../../../../../src/app/services/omics-service');
jest.mock('../../../../../src/app/services/secrets-manager-service');
jest.mock('../../../../../src/app/services/aws-healthomics/workflow-schema-service');

import { Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/aws-healthomics/workflow/process-fetch-workflow-schema.lambda';
import { WorkflowSchemaService } from '../../../../../src/app/services/aws-healthomics/workflow-schema-service';
import { OmicsService } from '../../../../../src/app/services/omics-service';
import { SecretsManagerService } from '../../../../../src/app/services/secrets-manager-service';

describe('process-fetch-workflow-schema.lambda', () => {
  const WORKFLOW_ID = '1234567';
  const WORKFLOW_ARN = `arn:aws:omics:us-east-1:123456789012:workflow/${WORKFLOW_ID}`;
  const GITHUB_REPO_URL = 'https://github.com/nf-core/rnaseq';
  const GITHUB_PAT = 'ghp_test_pat_token';
  const SECRET_NAME = 'github-pat-secret';

  const schemaContent = {
    $schema: 'http://json-schema.org/draft-07/schema',
    title: 'nf-core/rnaseq',
    description: 'RNA sequencing pipeline',
    definitions: {
      input_output_options: {
        properties: {
          input: { type: 'string', description: 'Path to samplesheet' },
          outdir: { type: 'string', description: 'Output directory' },
        },
      },
    },
  };

  let mockOmicsService: jest.MockedClass<typeof OmicsService>;
  let mockSecretsManagerService: jest.MockedClass<typeof SecretsManagerService>;
  let mockWorkflowSchemaService: jest.MockedClass<typeof WorkflowSchemaService>;

  const createEvent = (overrides: Record<string, any> = {}) => ({
    'source': 'aws.tag',
    'detail-type': 'Tag Change on Resource',
    'resources': [WORKFLOW_ARN],
    'detail': {
      'changed-tag-keys': ['github-repo-url'],
      'tags': { 'github-repo-url': GITHUB_REPO_URL },
    },
    ...overrides,
  });

  const createContext = (): Context =>
    ({
      functionName: 'process-fetch-workflow-schema',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:process-fetch-workflow-schema',
      memoryLimitInMB: '128',
      awsRequestId: 'req-id',
      logGroupName: '/aws/lambda/process-fetch-workflow-schema',
      logStreamName: '2026/03/31/[$LATEST]test',
      identity: undefined,
      clientContext: undefined,
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    process.env.GITHUB_PAT_SECRET_NAME = SECRET_NAME;

    mockOmicsService = OmicsService as jest.MockedClass<typeof OmicsService>;
    mockSecretsManagerService = SecretsManagerService as jest.MockedClass<typeof SecretsManagerService>;
    mockWorkflowSchemaService = WorkflowSchemaService as jest.MockedClass<typeof WorkflowSchemaService>;

    mockOmicsService.prototype.getWorkflow = jest.fn().mockResolvedValue({
      id: WORKFLOW_ID,
      tags: { 'github-repo-url': GITHUB_REPO_URL },
    });

    mockSecretsManagerService.prototype.getSecretValue = jest.fn().mockResolvedValue({
      SecretString: GITHUB_PAT,
    });

    mockWorkflowSchemaService.prototype.saveSchema = jest.fn().mockResolvedValue({});

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: Buffer.from(JSON.stringify(schemaContent)).toString('base64'),
        encoding: 'base64',
      }),
    } as Response);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.GITHUB_PAT_SECRET_NAME;
  });

  it('fetches schema from GitHub and saves to DynamoDB', async () => {
    await handler(createEvent(), createContext(), () => {});

    expect(mockOmicsService.prototype.getWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ id: WORKFLOW_ID, type: 'PRIVATE' }),
    );
    expect(mockSecretsManagerService.prototype.getSecretValue).toHaveBeenCalledWith({
      SecretId: SECRET_NAME,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/nf-core/rnaseq/contents/nextflow_schema.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${GITHUB_PAT}`,
        }),
      }),
    );
    expect(mockWorkflowSchemaService.prototype.saveSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        WorkflowId: WORKFLOW_ID,
        Version: '1',
        Schema: schemaContent,
      }),
    );
  });

  it('skips processing when no resource ARN is present in the event', async () => {
    await handler(createEvent({ resources: [] }), createContext(), () => {});

    expect(mockOmicsService.prototype.getWorkflow).not.toHaveBeenCalled();
    expect(mockWorkflowSchemaService.prototype.saveSchema).not.toHaveBeenCalled();
  });

  it('skips when workflow has neither github-repo-url nor github-schema-url tag', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WORKFLOW_ID,
      tags: {},
    });

    await handler(createEvent(), createContext(), () => {});

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWorkflowSchemaService.prototype.saveSchema).not.toHaveBeenCalled();
  });

  it('fetches schema from github-schema-url tag when repo URL is absent', async () => {
    const blobUrl = 'https://github.com/nf-core/rnaseq/blob/dev/nextflow_schema.json';
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WORKFLOW_ID,
      tags: { 'github-schema-url': blobUrl },
    });

    await handler(
      createEvent({
        detail: {
          'changed-tag-keys': ['github-schema-url'],
          'tags': { 'github-schema-url': blobUrl },
        },
      }),
      createContext(),
      () => {},
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/nf-core/rnaseq/contents/nextflow_schema.json?ref=dev',
      expect.anything(),
    );
    expect(mockWorkflowSchemaService.prototype.saveSchema).toHaveBeenCalled();
  });

  it('skips when github-schema-url tag is not parseable', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WORKFLOW_ID,
      tags: { 'github-schema-url': 'https://example.com/not-github' },
    });

    await handler(createEvent(), createContext(), () => {});

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockWorkflowSchemaService.prototype.saveSchema).not.toHaveBeenCalled();
  });

  it('throws when GITHUB_PAT_SECRET_NAME env var is not set', async () => {
    delete process.env.GITHUB_PAT_SECRET_NAME;

    await expect(handler(createEvent(), createContext(), () => {})).rejects.toThrow(
      'GITHUB_PAT_SECRET_NAME environment variable is not set',
    );
  });

  it('throws when GitHub PAT secret has no value', async () => {
    (mockSecretsManagerService.prototype.getSecretValue as jest.Mock).mockResolvedValue({
      SecretString: undefined,
    });

    await expect(handler(createEvent(), createContext(), () => {})).rejects.toThrow('GitHub PAT secret has no value');
  });

  it('skips saving when GitHub returns 404 (schema file not found)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    await handler(createEvent(), createContext(), () => {});

    expect(mockWorkflowSchemaService.prototype.saveSchema).not.toHaveBeenCalled();
  });

  it('parses GitHub repo URLs with .git suffix', async () => {
    (mockOmicsService.prototype.getWorkflow as jest.Mock).mockResolvedValue({
      id: WORKFLOW_ID,
      tags: { 'github-repo-url': 'https://github.com/nf-core/sarek.git' },
    });

    await handler(createEvent(), createContext(), () => {});

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/nf-core/sarek/contents/nextflow_schema.json',
      expect.anything(),
    );
  });

  it('throws on non-recoverable GitHub API errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'rate limit exceeded',
    } as Response);

    await expect(handler(createEvent(), createContext(), () => {})).rejects.toThrow('GitHub API error 403');
  });

  it('throws when GitHub returns unexpected encoding', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: 'raw-content',
        encoding: 'utf-8',
      }),
    } as Response);

    await expect(handler(createEvent(), createContext(), () => {})).rejects.toThrow(
      'Unexpected encoding from GitHub Contents API: utf-8',
    );
  });

  it('extracts workflow ID from ARN with nested path', async () => {
    const arn = 'arn:aws:omics:us-east-1:123456789012:workflow/9999999';
    await handler(createEvent({ resources: [arn] }), createContext(), () => {});

    expect(mockOmicsService.prototype.getWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: '9999999' }));
  });
});
