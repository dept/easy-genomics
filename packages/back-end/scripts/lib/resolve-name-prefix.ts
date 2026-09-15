import { join } from 'path';
import type { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import {
  getStackEnvName,
  loadConfigurations,
  resolveConfiguration,
} from '@easy-genomics/shared-lib/src/app/utils/configuration';

export function resolveNamePrefix(): string {
  if (process.env.NAME_PREFIX) {
    return process.env.NAME_PREFIX;
  }

  if (process.env.CI_CD === 'true') {
    const envName = process.env.ENV_NAME;
    const envType = process.env.ENV_TYPE;
    if (!envName || !envType) {
      throw new Error('CI_CD=true but ENV_NAME / ENV_TYPE are not set (needed to derive NAME_PREFIX).');
    }
    return `${envType}-${envName}`;
  }

  const configPath = join(__dirname, '../../../../config/easy-genomics.yaml');
  const configurations: { [p: string]: ConfigurationSettings }[] = loadConfigurations(configPath);
  const configuration = resolveConfiguration(configurations, getStackEnvName() ?? process.env.ENV_NAME);
  const envName = Object.keys(configuration)[0];
  const settings = Object.values(configuration)[0];
  const envType = settings['env-type'];
  if (!envName || !envType) {
    throw new Error('env-name / env-type missing from easy-genomics.yaml (needed to derive NAME_PREFIX).');
  }
  return `${envType}-${envName}`;
}
