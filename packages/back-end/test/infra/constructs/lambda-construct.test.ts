import { App, Stack } from 'aws-cdk-lib';
import { LambdaConstruct, LambdaConstructProps } from '../../../src/infra/constructs/lambda-construct';

const FIXTURES_DIR = 'test/infra/constructs/fixtures/lambda-construct';

describe('LambdaConstruct excludeDirs', () => {
  const buildLambdaConstruct = (excludeDirs?: string[]) => {
    // Bundling off: these tests only check which handlers are discovered.
    const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
    const stack = new Stack(app, 'lambda-construct-test-stack', { env: { account: '123456789012', region: 'us-west-2' } });
    const props = {
      env: { account: '123456789012', region: 'us-west-2' },
      constructNamespace: 'test',
      envName: 'test',
      envType: 'dev',
      appDomainName: 'test.example.com',
      namePrefix: 'test',
      lambdaFunctionsDir: FIXTURES_DIR,
      lambdaFunctionsNamespace: 'test',
      lambdaFunctionsResources: {},
      excludeDirs,
    } as unknown as LambdaConstructProps;
    return new LambdaConstruct(stack, 'test-lambdas', props);
  };

  const routeKeys = (construct: LambdaConstruct) => [...construct.lambdaFunctions.keys()];

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds the handlers of every subfolder when excludeDirs is omitted', () => {
    const keys = routeKeys(buildLambdaConstruct());

    expect(keys).toHaveLength(2);
    expect(keys.some((key) => key.endsWith('/usage/update-fixture-limits'))).toBe(true);
    expect(keys.some((key) => key.endsWith('/laboratory/read-fixture-laboratory'))).toBe(true);
  });

  it('skips the handlers of an excluded folder and keeps its siblings', () => {
    const keys = routeKeys(buildLambdaConstruct(['usage']));

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/\/laboratory\/read-fixture-laboratory$/);
  });
});
