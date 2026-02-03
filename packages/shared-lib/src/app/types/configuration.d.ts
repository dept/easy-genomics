export interface VpcPeeringSettings {
  ['external-vpc-id']: string; // External peering VPC Id
  ['external-aws-account-id']: string; // AWS Account Id of external peering VPC
  ['external-aws-region']: string; // AWS Region of external peering VPC
  ['external-role-arn']: string; // Role ARN to assume
  ['external-cidr-block']: string; // External peering VPC Cidr Block
}

export interface ConfigurationSettings {
  ['aws-account-id']: string;
  ['aws-region']: string;
  ['env-type']: 'dev' | 'pre-prod' | 'prod';
  ['app-domain-name']: string;
  // The following Front-End Infrastructure settings will need to be pre-configured in AWS and defined when 'env-type' is 'pre-prod' or 'prod'.
  ['aws-hosted-zone-id']?: string; // Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
  ['aws-certificate-arn']?: string; // Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
  ['google-client-id']?: string;
  ['google-client-secret']?: string;
  ['cognito-domain-prefix']?: string;
  ['callback-urls']?: string;
  ['logout-urls']?: string;
  // Back-End specific settings
  ['back-end']: {
    ['jwt-secret-key']?: string; // Optional: If undefined, a random value will be generated on deployment for JWT Signature
    ['seqera-api-base-url']?: string; // Optional: Update for self-hosted Seqera API Base URL; if unspecified this defaults to 'https://api.cloud.seqera.io'
    ['vpc-peering']?: VpcPeeringSettings; // Optional: VPC Peering Accepter details
    // The System Admin account is required
    ['sys-admin-email']?: string;
    ['sys-admin-password']?: string; // Initial Cognito password
    // Optional: The following user accounts are only seeded for 'dev' and 'pre-prod' environments for testing purposes
    ['org-admin-email']: string;
    ['org-admin-password']: string; // Admin Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
    ['lab-manager-email']?: string;
    ['lab-manager-password']?: string; // Lab Admin Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
    ['lab-technician-email']?: string;
    ['lab-technician-password']?: string; // Lab Technician Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
    // Optional: The following test settings are only used for E2E integration testing
    ['test-workspace-id']?: string;
    ['test-access-token']?: string;
    ['test-s3-url']?: string;
    ['test-invite-email']?: string;
  };

  // Front-End specific settings
  ['front-end']?: {};
}

export interface Configuration {
  ['env-name']: ConfigurationSettings;
}
