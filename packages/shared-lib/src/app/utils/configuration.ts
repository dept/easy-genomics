import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { ConfigurationSettingsSchema } from '../schema/configuration';
import { Configuration, ConfigurationSettings } from '../types/configuration';

function getNestedProperty<T>(obj: Record<string, unknown>, path: string): T | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current as T | undefined;
}

/**
 * Shared function to read the command line argument: --stack {env-name}
 */
export function getStackEnvName(): string | undefined {
  const args: (string | undefined)[] = process.argv.map((arg: string, index: number) => {
    return arg === '--stack' && process.argv.length > index + 1 ? process.argv[index + 1] : undefined;
  });

  const envName: string | undefined = args.flatMap((c) => (!!c ? [c] : [])).shift();
  if (envName) {
    console.log(`Using supplied --stack {env-name}: ${envName}`);
  }
  return envName;
}

/**
 * Shared function to load the specified configuration file settings.
 * @param filePath
 */
export function loadConfigurations(filePath: string): { [p: string]: ConfigurationSettings }[] {
  const yamlConfigs: Record<string, any> = loadYamlConfigFile(filePath);

  const configurations: Configuration[] | undefined = getNestedProperty<Configuration[]>(
    yamlConfigs as Record<string, unknown>,
    'easy-genomics.configurations',
  );
  if (!configurations) {
    throw new Error('Easy Genomics Configuration(s) missing / invalid, please update: easy-genomics.yaml');
  }

  return loadValidConfigurations(configurations);
}

/**
 * Shared function to find a specific configuration by the supplied envName.
 * @param envName
 * @param configurations
 */
export function findConfiguration(
  envName: string,
  configurations: { [p: string]: ConfigurationSettings }[],
): { [p: string]: ConfigurationSettings } {
  const configuration: { [p: string]: ConfigurationSettings } | undefined = configurations
    .filter((c: { [p: string]: ConfigurationSettings }) => Object.keys(c).shift() === envName)
    .shift();

  if (!configuration) {
    throw new Error(`Easy Genomics Configuration Settings for "${envName}" stack not found`);
  }
  return configuration;
}

/**
 * Private function reading specified YAML configuration file.
 * @param filePath
 */
function loadYamlConfigFile(filePath: string): Record<string, any> {
  return yaml.load(readFileSync(filePath, 'utf8')) as Record<string, any>;
}

/**
 * Private function returning only validated ConfigurationSettings.
 * @param configurations
 */
function loadValidConfigurations(configurations: Configuration[]): { [p: string]: ConfigurationSettings }[] {
  const validConfigurations: ({ [p: string]: ConfigurationSettings } | null)[] = configurations.map((config) => {
    const envName: string | undefined = Object.keys(config).shift();
    const configurationSettings: ConfigurationSettings | undefined = Object.values(config).shift();

    if (envName && configurationSettings) {
      if (ConfigurationSettingsSchema.safeParse(configurationSettings).success) {
        return { [envName]: configurationSettings };
      }
    }
    return null;
  });

  // Return only validated configurations
  return validConfigurations.flatMap((c) => (!!c ? [c] : []));
}
