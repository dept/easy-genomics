import { Environment, StackProps } from 'aws-cdk-lib';
import { OrganizationRoles } from "@SharedLib/types/easy-genomics/roles";

// Defines the BaseStack shared props for Front-End & Back-End subprojects
export interface BaseStackProps extends StackProps {
  env: Environment;
  constructNamespace: string;
  envName: string;
  envType: string;
  appDomainName: string;
  awsHostedZoneId?: string;
  awsCertificateArn?: string;
}

// Defines Front-End Stack props
export interface FrontEndStackProps extends BaseStackProps {
  // Privacy-safe upstream analytics opt-in (institution-level). When true, the
  // front-end build embeds the anonymous deployment identifiers so the browser
  // can send events directly to PostHog. Defaults to false / undefined (off).
  analyticsEnabled?: boolean;
}

export interface VpcPeering {
  externalVpcId: string;
  externalAwsAccountId: string;
  externalAwsRegion: string;
  externalRoleArn: string;
  externalCidrBlock: string;
}

// Defines Back-End Stack props
export interface BackEndStackProps extends BaseStackProps {
  namePrefix: string;
  jwtSecretKey: string;
  sysAdminEmail: string;
  sysAdminPassword: string;
  testUsers?: TestUserDetails[];
  seqeraApiBaseUrl: string;
  githubPatSecretName?: string;
  vpcPeering?: VpcPeering;
  googleClientId?: string;
  googleClientSecret?: string;
  cognitoDomainPrefix?: string;
  callbackUrls?: string;
  logoutUrls?: string;
  // Privacy-safe upstream analytics opt-in (institution-level). When true, the
  // back-end provisions the anonymous per-deployment identifier secrets.
  // Defaults to false / undefined (off).
  analyticsEnabled?: boolean;
}

// Defines Test User Accounts to provision for DevEnv deployments
export interface TestUserDetails {
    UserEmail: string;
    UserPassword: string;
    Access: 'OrganizationAdmin' | 'LabManager' | 'LabTechnician'
}