import { join } from 'path';
import { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import { loadConfigurations } from '@easy-genomics/shared-lib/src/app/utils/configuration';
import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { FrontEndStack } from './infra/stacks/front-end-stack';

const app = new App();

let awsAccountId: string | undefined;
let awsRegion: string | undefined;
let envName: string | undefined;
let envType: string | undefined;
let appDomainName: string | undefined;
let awsHostedZoneId: string | undefined;
let awsCertificateArn: string | undefined;
let analyticsEnabled: boolean = false;

if (process.env.CI_CD === 'true') {
  console.log('Loading Front-End environment settings for CI/CD Pipeline...');

  // CI/CD Pipeline uses ENV parameters
  awsAccountId = process.env.AWS_ACCOUNT_ID;
  awsRegion = process.env.AWS_REGION;
  envName = process.env.ENV_NAME;
  envType = process.env.ENV_TYPE;
  appDomainName = process.env.APP_DOMAIN_NAME;
  awsHostedZoneId = process.env.AWS_HOSTED_ZONE_ID;
  awsCertificateArn = process.env.AWS_CERTIFICATE_ARN;
  analyticsEnabled = process.env.ANALYTICS_ENABLED === 'true';

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
    throw new Error('AWS_HOSTED_ZONE_ID undefined, please check the CI/CD environment configuration');
  }
  if (envType === 'prod' && !awsCertificateArn) {
    throw new Error('AWS_CERTIFICATE_ARN undefined, please check the CI/CD environment configuration');
  }
} else {
  console.log('Loading Front-End easy-genomics.yaml settings...');

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
  awsCertificateArn = configSettings['aws-certificate-arn'];
  analyticsEnabled = configSettings.analytics?.enabled === true;

  if (!awsAccountId) {
    throw new Error('"aws-account-id" undefined, please check the easy-genomics.yaml configuration');
  }
  if (!awsRegion) {
    throw new Error('"aws-region" undefined, please check the easy-genomics.yaml configuration');
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
  if (envType === 'prod' && !awsCertificateArn) {
    throw new Error('"aws-certificate-arn" undefined, please check the easy-genomics.yaml configuration');
  }
}

// Ensure the AWS Region for the CDK calls to correctly query the correct region.
process.env.AWS_REGION = awsRegion;

const namePrefix: string = `${envType}-${envName}`;
const constructNamespace: string = `${namePrefix}-easy-genomics`;

// Setups Front-End Stack to support static web hosting for the UI
new FrontEndStack(app, `${namePrefix}-main-front-end-stack`, {
  env: {
    account: awsAccountId,
    region: awsRegion,
  },
  constructNamespace,
  envName,
  envType,
  appDomainName,
  awsHostedZoneId,
  awsCertificateArn,
  analyticsEnabled,
});

if (process.env.CDK_AUDIT === 'true') {
  // Perform AWS Security check on FE CDK infrastructure
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: false }));
}

app.synth();
