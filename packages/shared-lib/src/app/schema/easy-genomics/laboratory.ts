import { z } from 'zod';

export const LaboratorySchema = z
  .object({
    OrganizationId: z.string().uuid(),
    LaboratoryId: z.string().uuid(),
    Name: z.string(),
    Description: z.string().optional(),
    S3Bucket: z.string().optional(),
    Status: z.enum(['Active', 'Inactive']),
    AwsHealthOmicsEnabled: z.boolean().optional(),
    NextFlowTowerEnabled: z.boolean().optional(),
    NextFlowTowerApiBaseUrl: z.string().optional(),
    NextFlowTowerWorkspaceId: z.string().optional(),
    /**
     * Laboratory-wide run retention policy, in months, applied after a run reaches a terminal state.
     * - 0 means "never delete run records" (no TTL expiration).
     */
    RunRetentionMonths: z.number().int().min(0).optional(),
    EnableNewWorkflowsByDefault: z.boolean().optional(),
    /**
     * BYOK provider selection per integration. Setting a provider IS the enable
     * signal — when set, ambiguous HealthOmics failures (WORKFLOW_RUN_FAILED,
     * generic RUN_TASK_FAILED) and free-text Seqera errors are sent to the
     * configured LLM for owner attribution. The deterministic HealthOmics
     * lookup table runs regardless. Bedrock uses the platform Lambda IAM;
     * OpenAI / Anthropic need a key stored separately in SSM SecureString.
     */
    HealthOmicsLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
    HealthOmicsLlmModelId: z.string().optional(),
    SeqeraLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
    SeqeraLlmModelId: z.string().optional(),
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();

export const CreateLaboratorySchema = z
  .object({
    OrganizationId: z.string().uuid(),
    Name: z.string(),
    Description: z.string().optional(),
    S3Bucket: z.string().optional(),
    Status: z.enum(['Active', 'Inactive']),
    AwsHealthOmicsEnabled: z.boolean().optional(),
    NextFlowTowerEnabled: z.boolean().optional(),
    NextFlowTowerApiBaseUrl: z.string().optional(),
    NextFlowTowerAccessToken: z.string().optional(),
    GitHubAccessToken: z.string().optional(),
    NextFlowTowerWorkspaceId: z.string().optional(),
    RunRetentionMonths: z.number().int().min(0).optional(),
    EnableNewWorkflowsByDefault: z.boolean().optional(),
    HealthOmicsLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
    HealthOmicsLlmModelId: z.string().optional(),
    SeqeraLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
    SeqeraLlmModelId: z.string().optional(),
    /** Write-only on Create / Update. Persisted to SSM SecureString, never echoed back. */
    HealthOmicsLlmApiKey: z.string().optional(),
    SeqeraLlmApiKey: z.string().optional(),
  })
  .strict();
export type CreateLaboratory = z.infer<typeof CreateLaboratorySchema>;

export const ReadLaboratorySchema = z
  .object({
    OrganizationId: z.string().uuid(),
    LaboratoryId: z.string().uuid(),
    Name: z.string(),
    Description: z.string().optional(),
    S3Bucket: z.string().optional(),
    Status: z.enum(['Active', 'Inactive']),
    AwsHealthOmicsEnabled: z.boolean().optional(),
    NextFlowTowerEnabled: z.boolean().optional(),
    NextFlowTowerApiBaseUrl: z.string().optional(),
    NextFlowTowerWorkspaceId: z.string().optional(),
    HasNextFlowTowerAccessToken: z.boolean().optional(), // Return boolean indicator instead of actual NextFlowTowerAccessToken
    HasGitHubAccessToken: z.boolean().optional(), // Return boolean indicator instead of actual GitHubAccessToken
    RunRetentionMonths: z.number().int().min(0).optional(),
    EnableNewWorkflowsByDefault: z.boolean().optional(),
    HealthOmicsLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
    HealthOmicsLlmModelId: z.string().optional(),
    SeqeraLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
    SeqeraLlmModelId: z.string().optional(),
    /** Boolean indicators. The actual keys live in SSM and are never returned. */
    HasHealthOmicsLlmApiKey: z.boolean().optional(),
    HasSeqeraLlmApiKey: z.boolean().optional(),
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();
export type ReadLaboratory = z.infer<typeof ReadLaboratorySchema>;

export const RequestLaboratorySchema = z
  .object({
    OrganizationId: z.string().uuid(),
    LaboratoryId: z.string().uuid(),
  })
  .strict();

export const UpdateLaboratorySchema = z.object({
  Name: z.string(),
  Description: z.string().optional(),
  S3Bucket: z.string().optional(),
  Status: z.enum(['Active', 'Inactive']),
  AwsHealthOmicsEnabled: z.boolean().optional(),
  NextFlowTowerEnabled: z.boolean().optional(),
  NextFlowTowerApiBaseUrl: z.string().optional(),
  NextFlowTowerAccessToken: z.string().optional(),
  GitHubAccessToken: z.string().optional(),
  NextFlowTowerWorkspaceId: z.string().optional(),
  RunRetentionMonths: z.number().int().min(0).optional(),
  EnableNewWorkflowsByDefault: z.boolean().optional(),
  HealthOmicsLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
  HealthOmicsLlmModelId: z.string().optional(),
  SeqeraLlmProvider: z.enum(['bedrock', 'openai', 'anthropic']).optional(),
  SeqeraLlmModelId: z.string().optional(),
  /** Write-only on Update. Persisted to SSM SecureString. */
  HealthOmicsLlmApiKey: z.string().optional(),
  SeqeraLlmApiKey: z.string().optional(),
});
export type UpdateLaboratory = z.infer<typeof UpdateLaboratorySchema>;
