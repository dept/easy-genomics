import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { EasyGenomicsApiStack } from '../../../src/infra/stacks/easy-genomics-api-stack';

function mockEmptyNestedStack(className: string) {
  const { NestedStack } = jest.requireActual('aws-cdk-lib');
  return {
    [className]: class extends NestedStack {
      lambda = { lambdaFunctions: new Map(), logGroupNames: [] };
    },
  };
}

jest.mock('../../../src/infra/stacks/easy-genomics-nested-stack', () =>
  mockEmptyNestedStack('EasyGenomicsNestedStack'),
);
jest.mock('../../../src/infra/stacks/usage-nested-stack', () => mockEmptyNestedStack('UsageNestedStack'));
jest.mock('../../../src/infra/stacks/log-retention-nested-stack', () =>
  mockEmptyNestedStack('LogRetentionNestedStack'),
);
jest.mock('../../../src/infra/stacks/data-provisioning-nested-stack', () =>
  mockEmptyNestedStack('DataProvisioningNestedStack'),
);
jest.mock('../../../src/infra/constructs/spec-rest-api-construct', () => ({
  SpecRestApiConstruct: jest.fn().mockImplementation(() => ({ restApi: { url: 'https://api.example.com/' } })),
}));
jest.mock('cdk-nag', () => ({
  NagSuppressions: {
    addResourceSuppressionsByPath: jest.fn(),
    addResourceSuppressions: jest.fn(),
    addStackSuppressions: jest.fn(),
  },
}));

function synthApiStack(): EasyGenomicsApiStack {
  const app = new App();
  const authStack = new Stack(app, 'auth-stack');
  return new EasyGenomicsApiStack(app, 'api-stack', {
    env: { account: '123456789012', region: 'us-west-2' },
    envName: 'test',
    envType: 'dev',
    appDomainName: 'test.example.com',
    namePrefix: 'test',
    jwtSecretKey: 'test',
    sysAdminEmail: 'test@example.com',
    sysAdminPassword: 'test',
    seqeraApiBaseUrl: 'https://seqera.example.com',
    userPool: new UserPool(authStack, 'user-pool'),
  } as any);
}

describe('EasyGenomicsApiStack', () => {
  it('deploys the main nested stack after the usage nested stack, whose queue it publishes to', () => {
    const apiStack = synthApiStack();

    const nestedStacks = Template.fromStack(apiStack).findResources('AWS::CloudFormation::Stack');
    const logicalIdOf = (fragment: string) => Object.keys(nestedStacks).find((id) => id.includes(fragment))!;

    expect(nestedStacks[logicalIdOf('testeasygenomicsnestedstack')].DependsOn).toContain(
      logicalIdOf('testusagenestedstack'),
    );
  });

  it('keeps the daily usage totals in their own retained table, keyed for one query per organization', () => {
    const tables = Template.fromStack(synthApiStack()).findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'test-usage-daily-total-table' },
    });
    const [table] = Object.values(tables);

    expect(Object.keys(tables)).toHaveLength(1);
    expect(table.DeletionPolicy).toBe('Retain');
    expect(table.UpdateReplacePolicy).toBe('Retain');
    expect(table.Properties).toMatchObject({
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'OrganizationId', KeyType: 'HASH' },
        { AttributeName: 'DayLabWorkflow', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'OrganizationId', AttributeType: 'S' },
        { AttributeName: 'DayLabWorkflow', AttributeType: 'S' },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    expect(table.Properties.GlobalSecondaryIndexes).toBeUndefined();
    expect(table.Properties.LocalSecondaryIndexes).toBeUndefined();
    expect(table.Properties.TimeToLiveSpecification).toBeUndefined();
  });
});
