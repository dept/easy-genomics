/**
 * The following LaboratoryRun model represents the data stored in the
 * laboratory-run-table to support tracking Seqera NextFlow / AWS HealthOmics
 * runs for each Laboratory.
 *
 * The LaboratoryId serves as the DynamoDB HashKey, and the RunId
 * serves as the DynamoDB SortKey - and cannot be modified after creation.
 *
 * {
 *   LaboratoryId: <string>,
 *   RunId: <string>,
 *   UserId: <string>,
 *   OrganizationId: <string>,
 *   RunName: <string>,
 *   Platform: <string>,
 *   PlatformApiBaseUrl?: <string>,
 *   Status: <string>,
 *   Owner: <string>, // User Email for display purposes
 *   WorkflowName?: <string>, // Seqera Pipeline Name or AWS HealthOmics Workflow Name
 *   WorkflowVersionName?: <string>, // AWS HealthOmics workflow version name when applicable
 *   ExternalRunId?: <string>,
 *   InputS3Url?: <string>,
 *   OutputS3Url?: <string>,
 *   SampleSheetS3Url?: <string>,
 *   Settings?: <string>, // JSON string
 *   CreatedAt?: <string>,
 *   CreatedBy?: <string>,
 *   ModifiedAt?: <string>,
 *   ModifiedBy?: <string>,
 * }
 */
import { BaseAttributes, RunType } from "../base-entity";

export interface LaboratoryRun extends BaseAttributes {
  LaboratoryId: string; // DynamoDB Partition Key (String)
  RunId: string; // DynamoDB Sort Key (String) & Global Secondary Index (String)
  UserId: string; // Global Secondary Index (String)
  OrganizationId: string; // Global Secondary Index (String)
  RunName: string;
  Platform: RunType,
  PlatformApiBaseUrl?: string, // Used if Laboratory uses alternative Seqera Platform API Base URL
  Status: string;
  Owner: string; // User Email for display purposes
  WorkflowName?: string; // Seqera Pipeline Name or AWS HealthOmics Workflow Name
  WorkflowVersionName?: string;
  ExternalRunId?: string;
  InputS3Url?: string;
  OutputS3Url?: string;
  SampleSheetS3Url?: string;
  Settings?: string; // JSON string

  /**
   * ISO timestamp indicating when the run first reached a terminal state.
   * Used as the anchor for retention/TTL recomputation.
   */
  TerminalAt?: string;

  /**
   * DynamoDB TTL epoch timestamp (in seconds).
   * When present, DynamoDB will remove the item after this timestamp.
   */
  ExpiresAt?: number;
}
