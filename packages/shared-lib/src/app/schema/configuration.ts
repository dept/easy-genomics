import { z } from 'zod';

export const VpcPeeringSchema = z.object({
  ['external-vpc-id']: z.string(), // External peering VPC Id
  ['external-aws-account-id']: z.string(), // AWS Account Id of external peering VPC
  ['external-aws-region']: z.string(), // AWS Region of external peering VPC
  ['external-role-arn']: z.string(), // Role ARN to assume
});

export const ConfigurationSettingsSchema = z
  .object({
    ['aws-account-id']: z.string(),
    ['aws-region']: z.string(),
    ['env-type']: z.enum(['dev', 'pre-prod', 'prod']),
    ['app-domain-name']: z.string(),
    // The following Front-End Infrastructure settings will need to be pre-configured in AWS and defined when 'env-type' is 'pre-prod' or 'prod'.
    ['aws-hosted-zone-id']: z.string().nullable().optional(), // Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
    ['aws-certificate-arn']: z.string().nullable().optional(), // Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
    // The following are for Google SSO sign in settings
    ['google-client-id']: z.string().nullable().optional(),
    ['google-client-secret']: z.string().nullable().optional(),
    ['cognito-domain-prefix']: z.string().nullable().optional(),
    ['callback-urls']: z.string().nullable().optional(),
    ['logout-urls']: z.string().nullable().optional(),
    // Back-End specific settings
    ['back-end']: z.object({
      ['jwt-secret-key']: z.string().nullable().optional(), // Optional: If undefined, a random value will be generated on deployment for JWT Signature
      ['seqera-api-base-url']: z.string().nullable().optional(), // Optional: Update for self-hosted Seqera API Base URL; if unspecified this defaults to 'https://api.cloud.seqera.io'
      ['vpc-peering']: z.object(VpcPeeringSchema.shape).nullable().optional(), // Optional: VPC Peering Accepter details
      // The System Admin account is required
      ['sys-admin-email']: z.string(),
      ['sys-admin-password']: z.string(), // Initial Cognito password
      // Optional: The following user accounts are only seeded for 'dev' and 'pre-prod' environments for testing purposes
      ['org-admin-email']: z.string().nullable().optional(),
      ['org-admin-password']: z.string().nullable().optional(), // Admin Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
      ['lab-manager-email']: z.string().nullable().optional(),
      ['lab-manager-password']: z.string().nullable().optional(), // Lab Admin Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
      ['lab-technician-email']: z.string().nullable().optional(),
      ['lab-technician-password']: z.string().nullable().optional(), // Lab Technician Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
      // Optional: The following test settings are only used for E2E integration testing
      ['test-workspace-id']: z.string().nullable().optional(),
      ['test-access-token']: z.string().nullable().optional(),
      ['test-s3-url']: z.string().nullable().optional(),
      ['test-invite-email']: z.string().nullable().optional(),
    }),

    // Front-End specific settings
    ['front-end']: z.object({}).nullable().optional(),
  })
  .strict();
