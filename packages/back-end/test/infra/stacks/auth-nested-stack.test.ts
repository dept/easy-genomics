import { App, Stack } from 'aws-cdk-lib';
import { CognitoIdpConstruct } from '../../../src/infra/constructs/cognito-idp-construct';
import { IamConstruct } from '../../../src/infra/constructs/iam-construct';
import { LambdaConstruct } from '../../../src/infra/constructs/lambda-construct';
import { AuthNestedStack } from '../../../src/infra/stacks/auth-nested-stack';

jest.mock('../../../src/infra/constructs/iam-construct', () => ({
  IamConstruct: jest.fn().mockImplementation(() => ({
    policyStatements: new Map<string, unknown[]>(),
    addPolicyStatements: jest.fn(),
  })),
}));

jest.mock('../../../src/infra/constructs/dynamodb-construct', () => ({
  DynamoConstruct: jest.fn().mockImplementation(() => ({
    createTable: jest.fn().mockReturnValue({}),
  })),
}));

jest.mock('../../../src/infra/constructs/lambda-construct', () => ({
  LambdaConstruct: jest.fn().mockImplementation(() => ({
    lambdaFunctions: new Map<string, unknown>(),
  })),
}));

jest.mock('../../../src/infra/constructs/cognito-idp-construct', () => ({
  CognitoIdpConstruct: jest.fn().mockImplementation(() => ({})),
}));

describe('AuthNestedStack environment wiring', () => {
  const createProps = () =>
    ({
      env: { account: '123456789012', region: 'us-west-2' },
      constructNamespace: 'eg-auth',
      envName: 'sandbox',
      envType: 'dev',
      appDomainName: 'example.com',
      namePrefix: 'easy-genomics',
      jwtSecretKey: 'secret',
      sysAdminEmail: 'sysadmin@example.com',
      sysAdminPassword: 'Password!123',
      seqeraApiBaseUrl: 'https://seqera.example.com',
      cognitoIdpKmsKey: { keyArn: 'arn:aws:kms:us-west-2:123456789012:key/abc', keyId: 'abc' } as any,
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes ENV_TYPE and ENV_NAME to lambda common environment', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new AuthNestedStack(parentStack, 'auth-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];

    expect(lambdaProps.environment.ENV_TYPE).toBe('dev');
    expect(lambdaProps.environment.ENV_NAME).toBe('sandbox');
  });

  it('wires lambda resource-specific env for custom email sender and pre-token generation', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new AuthNestedStack(parentStack, 'auth-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];

    expect(lambdaProps.lambdaFunctionsResources['/auth/process-custom-email-sender'].environment.JWT_SECRET_KEY).toBe(
      'secret',
    );
    expect(
      lambdaProps.lambdaFunctionsResources['/auth/process-pre-token-generation'].environment.SYSTEM_ADMIN_EMAIL,
    ).toBe('sysadmin@example.com');
  });

  it('registers Cognito construct with custom sender kms key and auth lambda map', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new AuthNestedStack(parentStack, 'auth-test-stack', createProps());

    const cognitoConstructMock = CognitoIdpConstruct as unknown as jest.Mock;
    const cognitoProps = cognitoConstructMock.mock.calls[0][2];

    expect(cognitoProps.customSenderKmsKey.keyArn).toBe('arn:aws:kms:us-west-2:123456789012:key/abc');
    expect(cognitoProps.authLambdaFunctions).toBeDefined();
  });

  it('adds IAM policies for custom email sender lambda', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new AuthNestedStack(parentStack, 'auth-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/auth/process-custom-email-sender',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['kms:CreateGrant', 'kms:Encrypt']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['ses:SendTemplatedEmail']),
        }),
      ]),
    );
  });

  it('adds DynamoDB Query IAM for pre-token generation on user, organization-user, and laboratory-user tables', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new AuthNestedStack(parentStack, 'auth-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/auth/process-pre-token-generation',
      expect.arrayContaining([
        expect.objectContaining({
          actions: ['dynamodb:Query'],
          resources: expect.arrayContaining([
            'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-user-table',
            'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-user-table/index/*',
            'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-organization-user-table',
            'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-organization-user-table/index/*',
            'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-laboratory-user-table',
            'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-laboratory-user-table/index/*',
          ]),
        }),
      ]),
    );
  });
});
