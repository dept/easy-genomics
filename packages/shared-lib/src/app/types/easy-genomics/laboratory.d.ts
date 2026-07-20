/**
 * The following Laboratory model represents the data stored in the
 * laboratory-table to store the Laboratory specific settings.
 *
 * The OrganizationId serves as the DynamoDB HashKey, and the LaboratoryId
 * serves as the DynamoDB SortKey - and cannot be modified after creation.
 *
 * The Laboratory Name is modifiable but it is enforced to be unique within the
 * Organization via a transaction that checks the 'unique-reference-table' for
 * uniqueness.
 *
 * {
 *   OrganizationId: <string>,
 *   LaboratoryId: <string>,
 *   Name: <string>,
 *   Description?: <string>,
 *   Status: <string>,
 *   S3Bucket?: <string>,
 *   AwsHealthOmicsEnabled?: <boolean>,
 *   NextFlowTowerEnabled?: <boolean>,
 *   NextFlowTowerApiBaseUrl?: <string>,
 *   NextFlowTowerWorkspaceId?: <string>,
 *   HasNextFlowTowerAccessToken?: <boolean>,
 *   HasGitHubAccessToken?: <boolean>,
 *   EnableNewWorkflowsByDefault?: <boolean>,
 *   CreatedAt?: <string>,
 *   CreatedBy?: <string>,
 *   ModifiedAt?: <string>,
 *   ModifiedBy?: <string>,
 * }
 */
import { BaseAttributes, Status } from '../base-entity';

export interface Laboratory extends BaseAttributes {
  OrganizationId: string; // DynamoDB Partition Key (String)
  LaboratoryId: string; // DynamoDB Sort Key (String) & Global Secondary Index (String)
  Name: string;
  Description?: string;
  Status: Status;
  S3Bucket?: string; // S3 Bucket Full Name
  AwsHealthOmicsEnabled?: boolean;
  NextFlowTowerEnabled?: boolean;
  NextFlowTowerApiBaseUrl?: string;
  NextFlowTowerWorkspaceId?: string;
  /**
   * VPC networking mode for this lab's HealthOmics runs. Omitted ⇒ RESTRICTED
   * (S3 + ECR, same Region only). VPC routes runs through the referenced,
   * ops-created HealthOmics Configuration named by AwsHealthOmicsVpcConfigurationName.
   * Independent of AwsHealthOmicsEnabled — a lab may hold a dormant VPC config
   * while HealthOmics is disabled.
   */
  AwsHealthOmicsNetworkingMode?: 'RESTRICTED' | 'VPC';
  /** Name of an existing, ACTIVE HealthOmics Configuration resource, created out-of-band by ops. */
  AwsHealthOmicsVpcConfigurationName?: string;
  HasNextFlowTowerAccessToken?: boolean;
  HasGitHubAccessToken?: boolean;

  /**
   * When true, workflows/pipelines without a DENY row are allowed (new AWS-console workflows included).
   * When false/omitted, only explicit ALLOW rows grant access.
   */
  EnableNewWorkflowsByDefault?: boolean;

  /**
   * Laboratory-wide run retention policy, in months, applied after a run reaches a terminal state.
   * - 0 means "never delete run records" (no TTL expiration).
   */
  RunRetentionMonths?: number;

  /**
   * BYOK LLM provider selection per integration. Each lab can pick a different
   * provider/model/key for HealthOmics vs Seqera. Setting a provider IS the
   * enable signal — when set, ambiguous HealthOmics failures and free-text
   * Seqera errors are routed to the configured LLM. The deterministic
   * HealthOmics lookup table runs regardless. Bedrock uses the platform Lambda
   * IAM; OpenAI / Anthropic read the lab's own API key from SSM at classify
   * time.
   *
   * SSM paths for the API keys:
   *   `/easy-genomics/organization/{OrganizationId}/laboratory/{LaboratoryId}/llm-api-key-healthomics`
   *   `/easy-genomics/organization/{OrganizationId}/laboratory/{LaboratoryId}/llm-api-key-seqera`
   */
  HealthOmicsLlmProvider?: 'bedrock' | 'openai' | 'anthropic';
  HealthOmicsLlmModelId?: string;
  SeqeraLlmProvider?: 'bedrock' | 'openai' | 'anthropic';
  SeqeraLlmModelId?: string;

  /**
   * When true, the failure classifier fetches the failed HealthOmics run's
   * CloudWatch engine log, redacts PII + secrets, and sends a bounded excerpt to
   * the configured LLM for deeper diagnosis. Requires a HealthOmics LLM provider.
   */
  HealthOmicsLogEnrichmentEnabled?: boolean;

  /** Boolean indicators returned by read-laboratory; the actual keys never leave SSM. */
  HasHealthOmicsLlmApiKey?: boolean;
  HasSeqeraLlmApiKey?: boolean;
}
