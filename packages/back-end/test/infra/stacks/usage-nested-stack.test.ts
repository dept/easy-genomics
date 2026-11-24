import { App, Stack } from 'aws-cdk-lib';
import { LambdaConstruct } from '../../../src/infra/constructs/lambda-construct';
import { UsageNestedStack } from '../../../src/infra/stacks/usage-nested-stack';

jest.mock('../../../src/infra/constructs/lambda-construct', () => ({
  LambdaConstruct: jest.fn().mockImplementation(() => ({
    lambdaFunctions: new Map<string, unknown>(),
    logGroupNames: [],
  })),
}));

describe('UsageNestedStack', () => {
  const region = 'us-west-2';
  const account = '123456789012';
  const laboratoryTableArn = `arn:aws:dynamodb:${region}:${account}:table/test-laboratory-table`;

  const createStack = () => {
    const app = new App();
    const parent = new Stack(app, 'parent-stack', { env: { account, region } });
    return new UsageNestedStack(parent, 'usage-nested-stack', {
      env: { account, region },
      constructNamespace: 'test-usage',
      envName: 'test',
      envType: 'dev',
      appDomainName: 'test.example.com',
      namePrefix: 'test',
      jwtSecretKey: 'test',
      sysAdminEmail: 'test@example.com',
      sysAdminPassword: 'test',
      seqeraApiBaseUrl: 'https://seqera.example.com',
      dynamoDBTables: new Map(),
    } as any);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lets the save-limits handler query the lab by id and update only the lab item', () => {
    const stack = createStack();

    const statements = stack.iam
      .getPolicyStatements('/easy-genomics/usage/update-laboratory-run-limits')
      .map((statement) => statement.toStatementJson());

    expect(statements).toEqual([
      { Effect: 'Allow', Action: 'dynamodb:Query', Resource: `${laboratoryTableArn}/index/*` },
      { Effect: 'Allow', Action: 'dynamodb:UpdateItem', Resource: laboratoryTableArn },
    ]);
  });

  it('builds only the usage controllers, with their IAM policies attached', () => {
    const stack = createStack();

    const lambdaProps = (LambdaConstruct as unknown as jest.Mock).mock.calls[0][2];
    expect(lambdaProps.lambdaFunctionsDir).toBe('src/app/controllers/easy-genomics/usage');
    expect(lambdaProps.lambdaFunctionsNamespace).toBe('test-usage');
    expect(lambdaProps.iamPolicyStatements).toBe(stack.iam.policyStatements);
    expect(lambdaProps.environment).toEqual({
      ACCOUNT_ID: account,
      REGION: region,
      DOMAIN_NAME: 'test.example.com',
      ENV_TYPE: 'dev',
      NAME_PREFIX: 'test',
    });
  });
});
