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
export interface FrontEndStackProps extends BaseStackProps {}

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
  vpcPeering?: VpcPeering;
  googleClientId?: string;
  googleClientSecret?: string;
  cognitoDomainPrefix?: string;
  callbackUrls?: string;
  logoutUrls?: string;
}

// Defines Test User Accounts to provision for DevEnv deployments
export interface TestUserDetails {
    UserEmail: string;
    UserPassword: string;
    Access: 'OrganizationAdmin' | 'LabManager' | 'LabTechnician'
}