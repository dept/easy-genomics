import { z } from 'zod';

const LabNameSchema = z
  .string()
  .trim()
  .min(1, 'Lab name is required')
  .max(128, 'Lab name must be no more than 128 characters');

const LabDescriptionSchema = z.string().trim().max(500, 'Description must be no longer than 500 characters').optional();

/**
 * No max character limit as it needs to store the encrypted version of the token
 * from the server, which could be any length. The raw token input by the user
 * is validated in the EGFormLabDetails component as it handles special cases
 * for edit mode when the token value may or may not be updated by the user.
 */
const NextFlowTowerAccessTokenSchema = z.string().trim().min(1, 'Seqera access token is required');

const NextFlowTowerWorkspaceIdSchema = z.string().trim().max(128, 'Workspace ID must be no more than 128 characters');

const NextFlowTowerApiBaseUrlSchema = z.string().trim().min(1, 'Seqera endpoint URL is required');

const S3BucketSchema = z
  .string()
  .trim()
  .min(1, 'S3 bucket is required')
  .max(63, 'S3 bucket name must be no more than 63 characters');

const RunRetentionMonthsSchema = z
  .number({ invalid_type_error: 'Run retention must be a number' })
  .int('Run retention must be a whole number')
  .min(0, 'Run retention must be 0 or greater')
  .max(120, 'Run retention must be 120 months or less');

// Just the fields required for read-only display
const LabDetailsSchema = z.object({
  Name: LabNameSchema,
  Description: LabDescriptionSchema,
  S3Bucket: S3BucketSchema,
  RunRetentionMonths: RunRetentionMonthsSchema,
  NextFlowTowerEnabled: z.boolean(),
  NextFlowTowerAccessToken: NextFlowTowerAccessTokenSchema,
  NextFlowTowerWorkspaceId: NextFlowTowerWorkspaceIdSchema,
  NextFlowTowerApiBaseUrl: NextFlowTowerApiBaseUrlSchema,
  AwsHealthOmicsEnabled: z.boolean(),
});
type LabDetails = z.infer<typeof LabDetailsSchema>;

const LabDetailsFormModes = {
  Create: 'create',
  Edit: 'edit',
  ReadOnly: 'read-only',
} as const;
const LabDetailsFormModeEnum = z.nativeEnum(LabDetailsFormModes);
type LabDetailsFormMode = z.infer<typeof LabDetailsFormModeEnum>;

export {
  LabDescriptionSchema,
  LabDetailsFormModeEnum,
  LabDetailsFormModes,
  LabDetailsSchema,
  LabNameSchema,
  NextFlowTowerApiBaseUrlSchema,
  NextFlowTowerAccessTokenSchema,
  NextFlowTowerWorkspaceIdSchema,
  RunRetentionMonthsSchema,
  S3BucketSchema,
  type LabDetails,
  type LabDetailsFormMode,
};
