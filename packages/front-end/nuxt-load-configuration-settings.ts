import * as fs from 'fs';
import { join } from 'path';
import {
  AnalyticsDeploymentInfo,
  getAnalyticsDeploymentInfo,
} from '@easy-genomics/shared-lib/lib/src/app/utils/analytics-utils';
import { getApiGatewayInfo } from '@easy-genomics/shared-lib/lib/src/app/utils/api-gateway-utils';
import {
  getCognitoClientUrls,
  getCognitoDomainInfo,
  getCognitoIdpInfo,
} from '@easy-genomics/shared-lib/lib/src/app/utils/cognito-idp-utils';
import { ApiGatewayInfo } from '@easy-genomics/shared-lib/src/app/types/api-gateway-info';
import { CognitoIdpInfo } from '@easy-genomics/shared-lib/src/app/types/cognito-idp-info';
import { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import {
  getStackEnvName,
  loadConfigurations,
  resolveConfiguration,
} from '@easy-genomics/shared-lib/lib/src/app/utils/configuration';

/**
 * This script is required to simplify the easy-genomics.yaml configuration and deployment workflow for customers and
 * for the Easy Genomics development team to easily work on various parts of the system in parallel.
 *
 * This script reads the {easy-genomics root dir}/config/easy-genomics.yaml file for the configured shared settings to
 * then asynchronously queries the relevant AWS services for the existing:44
 *  - API Gateway URL
 *  - Cognito IDP User Pool ID
 *  - Cognito IDP User Pool Client ID
 *
 * This information is then saved to the {easy-genomics root dir}/config/.env.nuxt file for Nuxt's nuxt.config.ts
 * to use for the static web content generation.
 *
 * Once the project configuration is able to allow top-level asynchronous calls from either the Front-End main.ts
 * entry point or the nuxt.config.ts entry point, this intermediate script can be deprecated.
 *
 * @param awsRegion
 * @param envName
 * @param envType
 * @param easyGenomicsApiUrl Optional override for the easy-genomics API URL (no trailing slash).
 */
export async function exportNuxtConfigurationSettings(
  awsRegion: string,
  envName: string,
  envType: string,
  apiGatewayUrl?: string,
  easyGenomicsApiUrl?: string,
  analyticsEnabled: boolean = false,
  analyticsAllowDev: boolean = false,
  costExplorerEnabled: boolean = false,
) {
  const namePrefix: string = `${envType}-${envName}`;
  const apiGatewayRestApiName: string = `${namePrefix}-easy-genomics-apigw`;
  const cognitoUserPoolName: string = `${namePrefix}-easy-genomics-auth-user-pool`;
  const cognitoUserPoolClientName: string = `${namePrefix}-easy-genomics-auth-user-pool-client`;

  // Ensure the AWS Region for the SDK calls to correctly query the correct region.
  process.env.AWS_REGION = awsRegion;
  const normalizedApiGatewayUrl = apiGatewayUrl?.replace(/\/+$/, '');
  const apiGatewayInfo: ApiGatewayInfo = normalizedApiGatewayUrl
    ? { RestApiUrl: normalizedApiGatewayUrl }
    : await getApiGatewayInfo(apiGatewayRestApiName, awsRegion);
  const cognitoIdpInfo: CognitoIdpInfo = await getCognitoIdpInfo(cognitoUserPoolName, cognitoUserPoolClientName);
  const cognitoDomain = await getCognitoDomainInfo(cognitoIdpInfo.UserPoolId || '');
  const clientUrls = await getCognitoClientUrls(cognitoIdpInfo.UserPoolId || '', cognitoIdpInfo.UserPoolClientId || '');
  const { callbackUrls, logoutUrls } = clientUrls;

  console.log('Retrieve and export Nuxt Configuration Settings...');
  console.log(`  AWS_REGION=${awsRegion}`);
  console.log(`  ENV_NAME=${envName}`);
  console.log(`  ENV_TYPE=${envType}`);
  console.log(`  AWS_API_GATEWAY_URL=${apiGatewayInfo.RestApiUrl}`);
  if (easyGenomicsApiUrl) {
    console.log(`  AWS_EASY_GENOMICS_API_URL=${easyGenomicsApiUrl}`);
  }
  console.log(`  AWS_COGNITO_USER_POOL_ID=${cognitoIdpInfo.UserPoolId}`);
  console.log(`  AWS_COGNITO_USER_POOL_CLIENT_ID=${cognitoIdpInfo.UserPoolClientId}`);
  console.log(`  AWS_COGNITO_DOMAIN=${cognitoDomain}`);

  // Privacy-safe upstream analytics. Only resolve the anonymous per-deployment
  // identifiers when the institution has opted in. The CI/CD pipeline may pass
  // them directly via env vars (ANALYTICS_DEPLOYMENT_ID / ANALYTICS_SALT);
  // otherwise we read them from Secrets Manager (created by the back-end deploy).
  let analyticsDeploymentId = '';
  let analyticsSalt = '';
  if (analyticsEnabled) {
    const envDeploymentId = process.env.ANALYTICS_DEPLOYMENT_ID;
    const envSalt = process.env.ANALYTICS_SALT;
    if (envDeploymentId && envSalt) {
      analyticsDeploymentId = envDeploymentId;
      analyticsSalt = envSalt;
    } else {
      const info: AnalyticsDeploymentInfo | undefined = await getAnalyticsDeploymentInfo(namePrefix);
      if (info) {
        analyticsDeploymentId = info.deploymentId;
        analyticsSalt = info.salt;
      } else {
        console.warn(
          '  ANALYTICS: enabled but deployment identifiers were not found in Secrets Manager yet. ' +
            'This is expected on the very first deploy; redeploy the front-end after the back-end deploy completes.',
        );
      }
    }
    console.log(`  ANALYTICS_ENABLED=${analyticsEnabled}`);
    console.log(`  ANALYTICS_DEPLOYMENT_ID=${analyticsDeploymentId ? '<set>' : '<missing>'}`);
  }

  console.log(`  COST_EXPLORER_ENABLED=${costExplorerEnabled}`);

  const normalizedEasyGenomicsApiUrl = easyGenomicsApiUrl?.replace(/\/+$/, '');
  const nuxtConfigurationSettings: string =
    '###\n' +
    '# This configuration file is generated by the Front-End nuxt-load-configuration-settings.ts script.\n' +
    '###\n' +
    `AWS_REGION=${awsRegion}\n` +
    `ENV_NAME=${envName}\n` +
    `ENV_TYPE=${envType}\n` +
    `AWS_API_GATEWAY_URL=${apiGatewayInfo.RestApiUrl}\n` +
    `AWS_EASY_GENOMICS_API_URL=${normalizedEasyGenomicsApiUrl ?? ''}\n` +
    `AWS_COGNITO_USER_POOL_ID=${cognitoIdpInfo.UserPoolId}\n` +
    `AWS_COGNITO_USER_POOL_CLIENT_ID=${cognitoIdpInfo.UserPoolClientId}\n` +
    `AWS_COGNITO_DOMAIN=${cognitoDomain ?? ''}\n` +
    `COGNITO_CALLBACK_URLS=${callbackUrls}\n` +
    `COGNITO_LOGOUT_URLS=${logoutUrls}\n` +
    `ANALYTICS_ENABLED=${analyticsEnabled ? 'true' : 'false'}\n` +
    `ANALYTICS_ALLOW_DEV=${analyticsAllowDev ? 'true' : 'false'}\n` +
    `ANALYTICS_DEPLOYMENT_ID=${analyticsDeploymentId}\n` +
    `ANALYTICS_SALT=${analyticsSalt}\n` +
    `COST_EXPLORER_ENABLED=${costExplorerEnabled ? 'true' : 'false'}\n`;

  fs.writeFileSync(join(__dirname, '../../config/.env.nuxt'), nuxtConfigurationSettings, {
    encoding: 'utf8',
    flush: true,
  });
}

function isCredentialsError(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? (error as { name?: string }).name : '';
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : '';
  return name === 'CredentialsProviderError' || code === 'CredentialsProviderError';
}

// eslint-disable-next-line no-void
void (async () => {
  try {
    if (process.env.CI_CD === 'true') {
      const awsRegion = process.env.AWS_REGION;
      const envName = process.env.ENV_NAME;
      const envType = process.env.ENV_TYPE;
      const apiGatewayUrl = process.env.AWS_API_GATEWAY_URL;
      const easyGenomicsApiUrl = process.env.AWS_EASY_GENOMICS_API_URL;
      const analyticsEnabled = process.env.ANALYTICS_ENABLED === 'true';
      const analyticsAllowDev = process.env.ANALYTICS_ALLOW_DEV === 'true';
      const costExplorerEnabled = process.env.COST_EXPLORER_ENABLED === 'true';
      if (!awsRegion || !envName || !envType) {
        throw new Error('Missing required CI/CD env vars: AWS_REGION, ENV_NAME, ENV_TYPE.');
      }

      await exportNuxtConfigurationSettings(
        awsRegion,
        envName,
        envType,
        apiGatewayUrl,
        easyGenomicsApiUrl,
        analyticsEnabled,
        analyticsAllowDev,
        costExplorerEnabled,
      );
    } else {
      // @ts-ignore
      const configurations: { [p: string]: ConfigurationSettings }[] = loadConfigurations(
        // `__dirname` here is `packages/front-end`. The repo-level config lives at `config/easy-genomics.yaml`.
        join(__dirname, '../../config/easy-genomics.yaml'),
      );
      const configuration = resolveConfiguration(configurations, getStackEnvName() ?? process.env.ENV_NAME);

      const envName: string | undefined = Object.keys(configuration).shift();
      const configSettings: ConfigurationSettings | undefined = Object.values(configuration).shift() as
        | ConfigurationSettings
        | undefined;

      if (!envName || !configSettings) {
        throw new Error(
          'Easy Genomics Configuration missing / invalid, please check the easy-genomics.yaml configuration',
        );
      }

      const envType: string = configSettings['env-type']; // dev | pre-prod | prod
      const awsRegion: string = configSettings['aws-region'];
      const apiGatewayUrl: string | undefined = process.env.AWS_API_GATEWAY_URL;
      const easyGenomicsApiUrl: string | undefined = configSettings['aws-easy-genomics-api-url'] ?? undefined;
      const analyticsEnabled: boolean = configSettings.analytics?.enabled === true;
      const analyticsAllowDev: boolean = configSettings.analytics?.['allow-dev'] === true;
      const costExplorerEnabled: boolean = configSettings['cost-explorer']?.enabled === true;

      await exportNuxtConfigurationSettings(
        awsRegion,
        envName,
        envType,
        apiGatewayUrl,
        easyGenomicsApiUrl,
        analyticsEnabled,
        analyticsAllowDev,
        costExplorerEnabled,
      );
    }
  } catch (error) {
    if (isCredentialsError(error)) {
      console.error(
        '\nAWS credentials could not be loaded. This script needs credentials to call API Gateway and Cognito.',
      );
      console.error('Configure credentials using one of these methods:\n');
      console.error('  1. Run:  aws configure');
      console.error('     Then set AWS Access Key ID, Secret Access Key, and Default region (e.g. us-west-2).\n');
      console.error('  2. If using AWS SSO, run:  aws sso login');
      console.error('     Then ensure AWS_PROFILE is set or use:  aws sso login --profile YOUR_PROFILE\n');
      console.error('  3. Set environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION');
      console.error('     (and AWS_SESSION_TOKEN if using temporary credentials).\n');
      process.exit(1);
    }
    throw error;
  }
})();
