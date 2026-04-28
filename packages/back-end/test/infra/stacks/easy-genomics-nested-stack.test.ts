import { App, Stack } from 'aws-cdk-lib';
import { IamConstruct } from '../../../src/infra/constructs/iam-construct';
import { LambdaConstruct } from '../../../src/infra/constructs/lambda-construct';
import { SesConstruct } from '../../../src/infra/constructs/ses-construct';
import { EasyGenomicsNestedStack } from '../../../src/infra/stacks/easy-genomics-nested-stack';

jest.mock('aws-cdk-lib/aws-lambda-event-sources', () => ({
  SqsEventSource: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/infra/constructs/iam-construct', () => ({
  IamConstruct: jest.fn().mockImplementation(() => ({
    policyStatements: new Map<string, unknown[]>(),
    addPolicyStatements: jest.fn(),
    getPolicyStatements: jest.fn().mockReturnValue([]),
  })),
}));

jest.mock('../../../src/infra/constructs/lambda-construct', () => ({
  LambdaConstruct: jest.fn().mockImplementation(() => ({
    lambdaFunctions: new Map<string, unknown>(),
  })),
}));

jest.mock('../../../src/infra/constructs/ses-construct', () => ({
  SesConstruct: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/infra/constructs/sns-construct', () => ({
  SnsConstruct: jest.fn().mockImplementation(() => ({
    snsTopics: new Map<string, any>([
      ['organization-deletion-topic', { topicArn: 'arn:aws:sns:org', addToResourcePolicy: jest.fn() }],
      ['laboratory-deletion-topic', { topicArn: 'arn:aws:sns:lab', addToResourcePolicy: jest.fn() }],
      ['user-deletion-topic', { topicArn: 'arn:aws:sns:user', addToResourcePolicy: jest.fn() }],
      ['laboratory-run-update-topic', { topicArn: 'arn:aws:sns:run', addToResourcePolicy: jest.fn() }],
      ['user-invite-topic', { topicArn: 'arn:aws:sns:invite', addToResourcePolicy: jest.fn() }],
      ['folder-download-topic', { topicArn: 'arn:aws:sns:folder-download', addToResourcePolicy: jest.fn() }],
    ]),
  })),
}));

jest.mock('../../../src/infra/constructs/sqs-construct', () => ({
  SqsConstruct: jest.fn().mockImplementation(() => ({
    sqsQueues: new Map<string, any>([
      ['organization-management-queue', {}],
      ['laboratory-management-queue', {}],
      ['user-management-queue', {}],
      ['laboratory-run-update-queue', {}],
      ['user-invite-queue', {}],
      ['folder-download-queue', {}],
    ]),
  })),
}));

describe('EasyGenomicsNestedStack environment wiring', () => {
  // Tables live on the parent `EasyGenomicsApiStack` and are injected via
  // props (see that stack's JSDoc for the rationale tied to `cdk import`).
  // The wiring tests below don't exercise table identity, so an empty map
  // is sufficient to satisfy the prop contract.
  const createProps = () =>
    ({
      env: { account: '123456789012', region: 'us-west-2' },
      constructNamespace: 'eg',
      envName: 'sandbox',
      envType: 'dev',
      appDomainName: 'example.com',
      awsHostedZoneId: 'Z12345',
      namePrefix: 'easy-genomics',
      jwtSecretKey: 'secret',
      sysAdminEmail: 'sysadmin@example.com',
      sysAdminPassword: 'Password!123',
      seqeraApiBaseUrl: 'https://seqera.example.com',
      cognitoIdpKmsKey: { keyArn: 'arn:aws:kms:us-west-2:123456789012:key/abc', keyId: 'abc' } as any,
      userPool: { userPoolId: 'pool-id' } as any,
      userPoolClient: { userPoolClientId: 'client-id' } as any,
      dynamoDBTables: new Map(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes ENV_NAME to lambda common environment', () => {
    const app = new App();

    const parentStack = new Stack(app, 'parent-stack');

    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];

    expect(lambdaProps.environment.ENV_TYPE).toBe('dev');
    expect(lambdaProps.environment.ENV_NAME).toBe('sandbox');
  });

  it('wires invitation lambda env with required cognito and jwt values', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];
    const inviteConfig = lambdaProps.lambdaFunctionsResources['/easy-genomics/user/create-user-invitation-request'];

    expect(inviteConfig.environment.COGNITO_USER_POOL_ID).toBe('pool-id');
    expect(inviteConfig.environment.COGNITO_USER_POOL_CLIENT_ID).toBe('client-id');
    expect(inviteConfig.environment.JWT_SECRET_KEY).toBe('secret');
  });

  it('creates SES construct with envType and envName', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const sesConstructMock = SesConstruct as unknown as jest.Mock;
    const sesProps = sesConstructMock.mock.calls[0][2];
    expect(sesProps.envType).toBe('dev');
    expect(sesProps.envName).toBe('sandbox');
  });

  it('adds IAM policy statements for top-level bucket objects endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/file/request-top-level-bucket-objects',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:Query']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['s3:ListBucket']),
        }),
      ]),
    );
  });
});
