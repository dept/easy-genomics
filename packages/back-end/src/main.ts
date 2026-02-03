import { randomUUID } from 'crypto';
import { join } from 'path';
import { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import { loadConfigurations } from '@easy-genomics/shared-lib/src/app/utils/configuration';
import { TestUserDetails, VpcPeering } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { cognitoPasswordRegex } from './infra/constants/cognito';
import { BackEndStack } from './infra/stacks/back-end-stack';

const SEQERA_API_BASE_URL = 'https://api.cloud.seqera.io';
const app = new App();

let awsAccountId: string | undefined;
let awsRegion: string | undefined;
let envName: string | undefined;
let envType: string | undefined;
let appDomainName: string | undefined;
let awsHostedZoneId: string | undefined;
let googleClientId: string | undefined;
let googleClientSecret: string | undefined;
let cognitoDomainPrefix: string | undefined;
let callbackUrls: string | undefined;
let logoutUrls: string | undefined;

let jwtSecretKey: string | undefined;
let sysAdminEmail: string | undefined;
let sysAdminPassword: string | undefined;
let orgAdminEmail: string | undefined;
let orgAdminPassword: string | undefined;
let labManagerEmail: string | undefined;
let labManagerPassword: string | undefined;
let labTechnicianEmail: string | undefined;
let labTechnicianPassword: string | undefined;
let seqeraApiBaseUrl: string;
let vpcPeering: VpcPeering | undefined;

if (process.env.CI_CD === 'true') {
  console.log('Loading Back-End environment settings for CI/CD Pipeline...');

  // CI/CD Pipeline uses ENV parameters
  awsAccountId = process.env.AWS_ACCOUNT_ID;
  awsRegion = process.env.AWS_REGION;
  envName = process.env.ENV_NAME;
  envType = process.env.ENV_TYPE;
  appDomainName = process.env.APP_DOMAIN_NAME;
  awsHostedZoneId = process.env.AWS_HOSTED_ZONE_ID;
  googleClientId = process.env.GOOGLE_CLIENT_ID;
  googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  cognitoDomainPrefix = process.env.COGNITO_DOMAIN_PREFIX;
  callbackUrls = process.env.CALLBACK_URLS;
  logoutUrls = process.env.LOGOUT_URLS;

  jwtSecretKey = process.env.JWT_SECRET_KEY;
  // System Admin
  sysAdminEmail = process.env.SYSTEM_ADMIN_EMAIL;
  sysAdminPassword = process.env.SYSTEM_ADMIN_PASSWORD;
  // Org Admin
  orgAdminEmail = process.env.ORG_ADMIN_EMAIL;
  orgAdminPassword = process.env.ORG_ADMIN_PASSWORD;
  // Lab Manager
  labManagerEmail = process.env.LAB_MANAGER_EMAIL;
  labManagerPassword = process.env.LAB_MANAGER_PASSWORD;
  // Lab Technician
  labTechnicianEmail = process.env.LAB_TECHNICIAN_EMAIL;
  labTechnicianPassword = process.env.LAB_TECHNICIAN_PASSWORD;

  seqeraApiBaseUrl = process.env.SEQERA_API_BASE_URL || SEQERA_API_BASE_URL;

  if (
    process.env.EXTERNAL_VPC_ID &&
    process.env.EXTERNAL_AWS_ACCOUNT_ID &&
    process.env.EXTERNAL_AWS_REGION &&
    process.env.EXTERNAL_ROLE_ARN &&
    process.env.EXTERNAL_CIDR_BLOCK
  ) {
    vpcPeering = {
      externalVpcId: process.env.EXTERNAL_VPC_ID,
      externalAwsAccountId: process.env.EXTERNAL_AWS_ACCOUNT_ID,
      externalAwsRegion: process.env.EXTERNAL_AWS_REGION,
      externalRoleArn: process.env.EXTERNAL_ROLE_ARN,
      externalCidrBlock: process.env.EXTERNAL_CIDR_BLOCK,
    };
  }

  if (!awsAccountId) {
    throw new Error('"AWS_ACCOUNT_ID" undefined, please check the CI/CD environment configuration');
  }
  if (!awsRegion) {
    throw new Error('"AWS_REGION" undefined, please check the CI/CD environment configuration');
  }
  if (!envName) {
    throw new Error('"ENV_NAME" undefined, please check the CI/CD environment configuration');
  }
  if (!envType) {
    throw new Error('"ENV_TYPE" undefined, please check the CI/CD environment configuration');
  }
  if (!appDomainName) {
    throw new Error('"APP_DOMAIN_NAME" undefined, please check the CI/CD environment configuration');
  }
  if (envType === 'prod' && !awsHostedZoneId) {
    throw new Error('"AWS_HOSTED_ZONE_ID" undefined, please check the CI/CD environment configuration');
  }
  if (!sysAdminEmail) {
    throw new Error('"SYSTEM_ADMIN_EMAIL" undefined, please check the CI/CD environment configuration');
  }
  if (!sysAdminPassword) {
    throw new Error('"SYSTEM_ADMIN_PASSWORD" undefined, please check the CI/CD environment configuration');
  } else if (!cognitoPasswordRegex.test(sysAdminPassword)) {
    throw new Error(
      '"SYSTEM_ADMIN_PASSWORD" does not satisfy password requirements, please check the CI/CD environment configuration',
    );
  }
  if (envType !== 'prod') {
    if (orgAdminEmail && orgAdminPassword && !cognitoPasswordRegex.test(orgAdminPassword)) {
      throw new Error(
        '"ORG_ADMIN_PASSWORD" does not satisfy password requirements, please check the CI/CD environment configuration',
      );
    }
    if (labManagerEmail && labManagerPassword && !cognitoPasswordRegex.test(labManagerPassword)) {
      throw new Error(
        '"LAB_MANAGER_PASSWORD" does not satisfy password requirements, please check the CI/CD environment configuration',
      );
    }
    if (labTechnicianEmail && labTechnicianPassword && !cognitoPasswordRegex.test(labTechnicianPassword)) {
      throw new Error(
        '"LAB_TECHNICIAN_PASSWORD" does not satisfy password requirements, please check the CI/CD environment configuration',
      );
    }
  }
} else {
  console.log('Loading Back-End easy-genomics.yaml settings...');

  let configSettings: ConfigurationSettings | undefined;
  const configurations: { [p: string]: ConfigurationSettings }[] = loadConfigurations(
    join(__dirname, '../../../config/easy-genomics.yaml'),
  );
  if (configurations.length === 0) {
    throw new Error('Easy Genomics Configuration missing / invalid, please update: easy-genomics.yaml');
  } else if (configurations.length > 1) {
    throw new Error('Too many Easy Genomics Configurations found, please update: easy-genomics.yaml');
  } else {
    const configuration: { [p: string]: ConfigurationSettings } | undefined = configurations.shift();

    if (configuration) {
      envName = Object.keys(configuration).shift();
      configSettings = Object.values(configuration).shift();
    }
  }

  if (!envName || !configSettings) {
    throw new Error('Easy Genomics Configuration missing / invalid, please check the easy-genomics.yaml configuration');
  }

  // Shared configuration settings
  awsAccountId = configSettings['aws-account-id'].toString();
  awsRegion = configSettings['aws-region'];
  envType = configSettings['env-type']; // dev | pre-prod | prod
  appDomainName = configSettings['app-domain-name'];
  awsHostedZoneId = configSettings['aws-hosted-zone-id'];
  googleClientId = configSettings['google-client-id'];
  googleClientSecret = configSettings['google-client-secret'];
  cognitoDomainPrefix = configSettings['cognito-domain-prefix'];
  callbackUrls = configSettings['callback-urls'];
  logoutUrls = configSettings['logout-urls'];

  // Back-End configuration settings
  jwtSecretKey = configSettings['back-end']['jwt-secret-key'];
  // System Admin
  sysAdminEmail = configSettings['back-end']['sys-admin-email'];
  sysAdminPassword = configSettings['back-end']['sys-admin-password'];
  // Org Admin
  orgAdminEmail = configSettings['back-end']['org-admin-email'];
  orgAdminPassword = configSettings['back-end']['org-admin-password'];
  // Lab Manager User
  labManagerEmail = configSettings['back-end']['lab-manager-email'];
  labManagerPassword = configSettings['back-end']['lab-manager-password'];
  // Lab Technician User
  labTechnicianEmail = configSettings['back-end']['lab-technician-email'];
  labTechnicianPassword = configSettings['back-end']['lab-technician-password'];

  seqeraApiBaseUrl = configSettings['back-end']['seqera-api-base-url'] || SEQERA_API_BASE_URL;

  const vpcPeeringSettings = configSettings['back-end']['vpc-peering'];
  if (vpcPeeringSettings) {
    const externalVpcId = vpcPeeringSettings['external-vpc-id'];
    const externalAwsAccountId = vpcPeeringSettings['external-aws-account-id'];
    const externalAwsRegion = vpcPeeringSettings['external-aws-region'];
    const externalRoleArn = vpcPeeringSettings['external-role-arn'];
    const externalCidrBlock = vpcPeeringSettings['external-cidr-block'];
    if (externalVpcId && externalAwsAccountId && externalAwsRegion && externalRoleArn && externalCidrBlock) {
      vpcPeering = {
        externalVpcId: externalVpcId,
        externalAwsAccountId: externalAwsAccountId,
        externalAwsRegion: externalAwsRegion,
        externalRoleArn: externalRoleArn,
        externalCidrBlock: externalCidrBlock,
      };
    }
  }

  if (!awsAccountId) {
    throw new Error('"aws-account-id" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!awsRegion) {
    throw new Error('"aws-region" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!envName) {
    throw new Error('"env-name" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!envType) {
    throw new Error('"env-type" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!appDomainName) {
    throw new Error('"app-domain-name" undefined, please check the easy-genomics.yaml configuration');
  }
  if (envType === 'prod' && !awsHostedZoneId) {
    throw new Error('"aws-hosted-zone-id" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!sysAdminEmail) {
    throw new Error('"sys-admin-email" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!sysAdminPassword) {
    throw new Error('"sys-admin-password" undefined, please check the easy-genomics.yaml configuration');
  } else if (!cognitoPasswordRegex.test(sysAdminPassword)) {
    throw new Error(
      '"sys-admin-password" does not satisfy password requirements, please check the easy-genomics.yaml configuration',
    );
  }
  if (envType !== 'prod') {
    if (orgAdminEmail && orgAdminPassword && !cognitoPasswordRegex.test(orgAdminPassword)) {
      throw new Error(
        '"org-admin-password" does not satisfy password requirements, please check the easy-genomics.yaml configuration',
      );
    }
    if (labManagerEmail && labManagerPassword && !cognitoPasswordRegex.test(labManagerPassword)) {
      throw new Error(
        '"lab-manager-password" does not satisfy password requirements, please check the easy-genomics.yaml configuration',
      );
    }
    if (labTechnicianEmail && labTechnicianPassword && !cognitoPasswordRegex.test(labTechnicianPassword)) {
      throw new Error(
        '"lab-technician-password" does not satisfy password requirements, please check the easy-genomics.yaml configuration',
      );
    }
  }
}

// Ensure the AWS Region for the CDK calls to correctly query the correct region.
process.env.AWS_REGION = awsRegion;

const namePrefix: string = `${envType}-${envName}`;
const constructNamespace: string = `${namePrefix}-easy-genomics`;

// Define Test User Accounts to seed for development and testing
const testUsers: TestUserDetails[] = envType !== 'prod' ? <TestUserDetails[]>[
        orgAdminEmail && orgAdminPassword
          ? <TestUserDetails>{
              UserEmail: orgAdminEmail,
              UserPassword: orgAdminPassword,
              Access: 'OrganizationAdmin',
            }
          : undefined,
        labManagerEmail && labManagerPassword
          ? <TestUserDetails>{
              UserEmail: labManagerEmail,
              UserPassword: labManagerPassword,
              Access: 'LabManager',
            }
          : undefined,
        labTechnicianEmail && labTechnicianPassword
          ? <TestUserDetails>{
              UserEmail: labTechnicianEmail,
              UserPassword: labTechnicianPassword,
              Access: 'LabTechnician',
            }
          : undefined,
      ].filter((item: TestUserDetails | undefined) => item != undefined) : [];

if (!sysAdminEmail || !sysAdminPassword) {
  throw new Error(
    'The System Admin User login and password is required, please check your easy-genomics.yaml configuration.',
  );
}

// Setups Back-End Stack which initiates the nested stacks for Auth, Easy Genomics, AWS HealthOmics and NextFlow Tower
new BackEndStack(app, `${namePrefix}-main-back-end-stack`, {
  env: {
    account: awsAccountId,
    region: awsRegion,
  },
  constructNamespace: constructNamespace,
  envName: envName,
  envType: envType,
  appDomainName: appDomainName,
  awsHostedZoneId: awsHostedZoneId,
  namePrefix: namePrefix,
  // Generate random value for JWT signature secret on deployment if jwt-secret-key configuration undefined
  jwtSecretKey: jwtSecretKey ? jwtSecretKey : randomUUID(),
  sysAdminEmail: sysAdminEmail,
  sysAdminPassword: sysAdminPassword,
  testUsers: testUsers,
  seqeraApiBaseUrl: seqeraApiBaseUrl.replace(/\/+$/, ''), // Remove trailing slashes
  vpcPeering: vpcPeering,
  googleClientId,
  googleClientSecret,
  cognitoDomainPrefix,
  callbackUrls,
  logoutUrls,
});

if (process.env.CDK_AUDIT === 'true') {
  // Perform AWS Security check on FE CDK infrastructure
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: false }));
}

app.synth();
