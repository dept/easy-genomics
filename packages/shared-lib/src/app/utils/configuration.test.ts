import { findConfiguration, getStackEnvName, resolveConfiguration } from './configuration';
import { ConfigurationSettings } from '../types/configuration';

/**
 * Builds a minimal configuration entry. findConfiguration / resolveConfiguration only
 * inspect the env-name key, so the settings payload can be an empty stub.
 */
function configEntry(envName: string): { [p: string]: ConfigurationSettings } {
  return { [envName]: {} as ConfigurationSettings };
}

describe('getStackEnvName', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('returns the value following --stack', () => {
    process.argv = ['node', 'script.js', '--stack', 'myenv'];
    expect(getStackEnvName()).toBe('myenv');
  });

  it('returns the first --stack value when --stack appears among other args', () => {
    process.argv = ['node', 'script.js', '--other', 'x', '--stack', 'prod-env', '--more', 'y'];
    expect(getStackEnvName()).toBe('prod-env');
  });

  it('returns undefined when --stack is absent', () => {
    process.argv = ['node', 'script.js', '--cdk-out', 'cdk.out'];
    expect(getStackEnvName()).toBeUndefined();
  });

  it('returns undefined when --stack is the final argument with no value', () => {
    process.argv = ['node', 'script.js', '--stack'];
    expect(getStackEnvName()).toBeUndefined();
  });

  it('returns undefined when there are no extra arguments', () => {
    process.argv = ['node', 'script.js'];
    expect(getStackEnvName()).toBeUndefined();
  });
});

describe('findConfiguration', () => {
  const configurations = [configEntry('dev'), configEntry('prod')];

  it('returns the configuration whose key matches envName', () => {
    expect(findConfiguration('prod', configurations)).toEqual(configEntry('prod'));
  });

  it('throws when envName does not match any configuration', () => {
    expect(() => findConfiguration('staging', configurations)).toThrow(
      'Easy Genomics Configuration Settings for "staging" stack not found',
    );
  });

  it('throws when the configurations list is empty', () => {
    expect(() => findConfiguration('dev', [])).toThrow(
      'Easy Genomics Configuration Settings for "dev" stack not found',
    );
  });
});

describe('resolveConfiguration', () => {
  it('throws when there are no configurations', () => {
    expect(() => resolveConfiguration([])).toThrow('missing / invalid');
  });

  it('returns the single configuration without consulting envName', () => {
    const configurations = [configEntry('only-env')];
    expect(resolveConfiguration(configurations)).toEqual(configEntry('only-env'));
    // envName is intentionally ignored for single-config files.
    expect(resolveConfiguration(configurations, 'does-not-match')).toEqual(configEntry('only-env'));
  });

  it('returns the matching configuration when multiple exist and envName is supplied', () => {
    const configurations = [configEntry('dev'), configEntry('prod')];
    expect(resolveConfiguration(configurations, 'dev')).toEqual(configEntry('dev'));
  });

  it('throws when multiple configurations exist and envName is missing', () => {
    const configurations = [configEntry('dev'), configEntry('prod')];
    expect(() => resolveConfiguration(configurations)).toThrow('a target environment name is required');
  });

  it('throws when multiple configurations exist and envName does not match', () => {
    const configurations = [configEntry('dev'), configEntry('prod')];
    expect(() => resolveConfiguration(configurations, 'staging')).toThrow(
      'Easy Genomics Configuration Settings for "staging" stack not found',
    );
  });
});
