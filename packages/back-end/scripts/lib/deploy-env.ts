import { join } from 'path';
import { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import {
  getStackEnvName,
  loadConfigurations,
  resolveConfiguration,
} from '@easy-genomics/shared-lib/src/app/utils/configuration';

export type DeployEnv = {
  envName: string;
  envType: string;
  awsRegion: string;
  namePrefix: string;
};

const CONFIG_PATH = join(__dirname, '../../../../config/easy-genomics.yaml');

/**
 * Resolve the env this deploy is targeting. Shared by preflight, GSI waves,
 * and other scripts that must match `packages/back-end/src/main.ts`.
 */
export function resolveDeployEnv(label: string): DeployEnv {
  if (process.env.CI_CD === 'true') {
    const envName = process.env.ENV_NAME;
    const envType = process.env.ENV_TYPE;
    const awsRegion = process.env.AWS_REGION;
    if (!envName || !envType || !awsRegion) {
      throw new Error(
        `${label}: CI_CD=true but ENV_NAME / ENV_TYPE / AWS_REGION are not all set. ` +
          'Fix the CI environment or run locally without CI_CD=true to fall back to easy-genomics.yaml.',
      );
    }
    return { envName, envType, awsRegion, namePrefix: `${envType}-${envName}` };
  }

  const configurations: { [p: string]: ConfigurationSettings }[] = loadConfigurations(CONFIG_PATH);
  const configuration = resolveConfiguration(configurations, getStackEnvName() ?? process.env.ENV_NAME);
  const envName = Object.keys(configuration)[0];
  const settings = Object.values(configuration)[0];
  const envType = settings['env-type'];
  const awsRegion = settings['aws-region'];
  if (!envName || !envType || !awsRegion) {
    throw new Error(`${label}: env-name / env-type / aws-region missing from easy-genomics.yaml.`);
  }
  return { envName, envType, awsRegion, namePrefix: `${envType}-${envName}` };
}
