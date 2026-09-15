import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { IamConstruct } from '../../../src/infra/constructs/iam-construct';
import { LambdaConstruct } from '../../../src/infra/constructs/lambda-construct';
import { SesConstruct } from '../../../src/infra/constructs/ses-construct';
import { SqsConstruct } from '../../../src/infra/constructs/sqs-construct';
import { EasyGenomicsNestedStack } from '../../../src/infra/stacks/easy-genomics-nested-stack';

jest.mock('aws-cdk-lib/aws-lambda-event-sources', () => ({
  SqsEventSource: jest.fn().mockImplementation(() => ({})),
  SqsDlq: jest.fn().mockImplementation(() => ({})),
  DynamoEventSource: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/infra/constructs/iam-construct', () => ({
  IamConstruct: jest.fn().mockImplementation(() => {
    const policyStatements = new Map<string, unknown[]>();
    return {
      policyStatements,
      // Mirror production Map.set semantics so callers that merge via .get() + set are testable.
      addPolicyStatements: jest.fn((name: string, statements: unknown[]) => {
        policyStatements.set(name, statements);
      }),
      getPolicyStatements: jest.fn((name: string) => policyStatements.get(name) ?? []),
    };
  }),
}));

jest.mock('../../../src/infra/constructs/lambda-construct', () => ({
  LambdaConstruct: jest.fn().mockImplementation(() => ({
    lambdaFunctions: new Map<string, unknown>(),
    logGroupNames: [],
  })),
}));

jest.mock('../../../src/infra/constructs/ses-construct', () => ({
  SesConstruct: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/infra/constructs/sqs-construct', () => ({
  SqsConstruct: jest.fn().mockImplementation(() => ({
    sqsQueues: new Map<string, any>([
      ['organization-management-queue', { queueUrl: 'https://sqs/org', queueArn: 'arn:aws:sqs:org' }],
      ['laboratory-management-queue', { queueUrl: 'https://sqs/lab', queueArn: 'arn:aws:sqs:lab' }],
      ['user-management-queue', { queueUrl: 'https://sqs/user', queueArn: 'arn:aws:sqs:user' }],
      ['laboratory-run-update-queue', { queueUrl: 'https://sqs/run', queueArn: 'arn:aws:sqs:run' }],
      ['laboratory-run-notification-queue', { queueUrl: 'https://sqs/run-notify', queueArn: 'arn:aws:sqs:run-notify' }],
      ['user-invite-queue', { queueUrl: 'https://sqs/invite', queueArn: 'arn:aws:sqs:invite' }],
      [
        'laboratory-run-failure-classification-queue',
        { queueUrl: 'https://sqs/classify', queueArn: 'arn:aws:sqs:classify' },
      ],
      ['folder-download-queue', { queueUrl: 'https://sqs/folder', queueArn: 'arn:aws:sqs:folder' }],
    ]),
  })),
}));

describe('EasyGenomicsNestedStack environment wiring', () => {
  // Tables live on the parent `EasyGenomicsApiStack` and are injected via
  // props (see that stack's JSDoc for the rationale tied to `cdk import`).
  // The wiring tests below don't exercise table identity, but the nested stack
  // does require `laboratory-run-table` for the DynamoDB-stream event source it
  // wires up; we inject a minimal fake here that satisfies the surface area used
  // (DynamoEventSource calls `tableStreamArn` / `grantStreamRead`).
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
      dynamoDBTables: new Map<string, any>([
        [
          'easy-genomics-laboratory-run-table',
          {
            tableName: 'easy-genomics-laboratory-run-table',
            tableArn: 'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-laboratory-run-table',
            tableStreamArn:
              'arn:aws:dynamodb:us-west-2:123456789012:table/easy-genomics-laboratory-run-table/stream/2026-01-01T00:00:00.000',
            grantStreamRead: jest.fn(),
          },
        ],
      ]),
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

  it('passes the org-email-assets CloudFront domain to lambda common environment', () => {
    // Common, not per-lambda: default-email-branding.ts is reached from four different senders
    // (notification-service, user-invite-service, process-custom-email-sender and
    // request-organization-branding-test-email), so a per-lambda variable would render
    // https://undefined/... in whichever one was missed.
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');

    const nestedStack = new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];

    // A bare Token.isUnresolved() check can't tell this value apart from the bucket's own
    // bucketDomainName/bucketRegionalDomainName, which are also unresolved tokens on the same
    // construct and would silently point email images back at the private S3 bucket. Pin the
    // token to the CloudFront distribution's own logical id instead.
    const template = Template.fromStack(nestedStack);
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const distributionLogicalIds = Object.keys(distributions);
    expect(distributionLogicalIds).toHaveLength(1);
    const [distributionLogicalId] = distributionLogicalIds;

    expect(nestedStack.resolve(lambdaProps.environment.ORG_EMAIL_ASSETS_CDN_DOMAIN)).toEqual({
      'Fn::GetAtt': [distributionLogicalId, 'DomainName'],
    });
    // Guards against the common env being replaced rather than extended.
    expect(lambdaProps.environment.NAME_PREFIX).toBe('easy-genomics');
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

  it('wires the notification queue with a dead-letter queue', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const sqsConstructMock = SqsConstruct as unknown as jest.Mock;
    const sqsProps = sqsConstructMock.mock.calls[0][2];
    const notificationQueueConfig = sqsProps.queues['laboratory-run-notification-queue'];

    expect(notificationQueueConfig.fifo).toBe(true);
    expect(notificationQueueConfig.deadLetterQueue).toBeDefined();
    expect(notificationQueueConfig.deadLetterQueue.maxReceiveCount).toBe(3);
  });

  it('wires the new notification queue URL into the existing process-update-laboratory-run lambda', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];
    const triggerConfig =
      lambdaProps.lambdaFunctionsResources['/easy-genomics/laboratory/run/process-update-laboratory-run'];

    expect(triggerConfig.environment.SQS_LABORATORY_RUN_NOTIFICATION_QUEUE_URL).toBe('https://sqs/run-notify');
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

  it('adds IAM policy statements for create-organization-logo-upload-request endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/organization/create-organization-logo-upload-request',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['s3:PutObject']),
        }),
      ]),
    );
  });

  it('adds IAM policy statements for request-organization-branding-test-email endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/organization/request-organization-branding-test-email',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['ses:SendTemplatedEmail']),
        }),
      ]),
    );
  });

  it('adds IAM policy statements for process-notify-laboratory-run-completion endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/laboratory/run/process-notify-laboratory-run-completion',
      expect.arrayContaining([
        expect.objectContaining({
          resources: expect.arrayContaining([expect.stringContaining('organization-table')]),
          actions: expect.arrayContaining(['dynamodb:GetItem']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['ses:SendTemplatedEmail']),
        }),
      ]),
    );
  });

  it('adds IAM policy statements for request-unlinked-bucket-objects endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/data-collections/request-unlinked-bucket-objects',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:GetItem']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['s3:ListBucket']),
        }),
      ]),
    );
  });

  it('adds IAM policy statements for create-sample endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/data-collections/create-sample',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:GetItem']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['s3:ListBucket']),
        }),
      ]),
    );
  });

  it('adds omics:GetConfiguration IAM policy for create-laboratory endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/laboratory/create-laboratory',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['omics:GetConfiguration']),
        }),
      ]),
    );
  });

  it('adds omics:GetConfiguration IAM policy for update-laboratory endpoint', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/laboratory/update-laboratory',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['omics:GetConfiguration']),
        }),
      ]),
    );
  });

  it('appends laboratory-s3-access IAM without replacing update-laboratory base policies', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;
    const updateLaboratoryPolicies = iamInstance.policyStatements.get('/easy-genomics/laboratory/update-laboratory');

    expect(updateLaboratoryPolicies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:Query', 'dynamodb:PutItem']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['ssm:GetParameter', 'ssm:PutParameter']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query']),
        }),
        expect.objectContaining({
          actions: expect.arrayContaining(['s3:ListAllMyBuckets', 's3:GetBucketTagging']),
        }),
      ]),
    );
  });

  it('grants create-laboratory PutItem on laboratory-s3-access-table', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/laboratory/create-laboratory',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:PutItem']),
          resources: expect.arrayContaining([expect.stringContaining('laboratory-s3-access-table')]),
        }),
      ]),
    );
  });

  it('grants edit-s3-access-batch PutItem on laboratory-table to clear default buckets', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;
    const policies = iamInstance.policyStatements.get('/easy-genomics/organization/s3-access/edit-s3-access-batch');

    expect(policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['dynamodb:Query', 'dynamodb:PutItem']),
          resources: expect.arrayContaining([expect.stringContaining('laboratory-table')]),
        }),
      ]),
    );
  });

  it('appends GetBucketTagging and s3-access Query to enforcement routes', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    for (const route of [
      '/easy-genomics/file/request-list-bucket-objects',
      '/easy-genomics/file/request-file-download-url',
      '/easy-genomics/data-collections/edit-batch',
      '/easy-genomics/upload/create-file-upload-request',
    ]) {
      const policies = iamInstance.policyStatements.get(route);
      expect(policies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: expect.arrayContaining(['dynamodb:Query']),
            resources: expect.arrayContaining([expect.stringContaining('laboratory-s3-access-table')]),
          }),
          expect.objectContaining({
            actions: expect.arrayContaining(['s3:GetBucketTagging']),
          }),
        ]),
      );
    }
  });

  it('adds sqs:SendMessage IAM policy for process-poll-active-runs to re-enqueue status checks', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const iamConstructMock = IamConstruct as unknown as jest.Mock;
    const iamInstance = iamConstructMock.mock.results[0].value;

    expect(iamInstance.addPolicyStatements).toHaveBeenCalledWith(
      '/easy-genomics/laboratory/run/process-poll-active-runs',
      expect.arrayContaining([
        expect.objectContaining({
          actions: expect.arrayContaining(['sqs:SendMessage']),
        }),
      ]),
    );
  });

  it('schedules the active-run poller on a 2-minute interval', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];
    const pollerConfig = lambdaProps.lambdaFunctionsResources['/easy-genomics/laboratory/run/process-poll-active-runs'];

    expect(pollerConfig).toBeDefined();
    expect(pollerConfig.environment.SQS_LABORATORY_RUN_UPDATE_QUEUE_URL).toBe('https://sqs/run');
    expect(pollerConfig.callbacks).toHaveLength(1);
  });

  it('wires the notification sender to the notification queue', () => {
    const app = new App();
    const parentStack = new Stack(app, 'parent-stack');
    new EasyGenomicsNestedStack(parentStack, 'easy-genomics-test-stack', createProps());

    const lambdaConstructMock = LambdaConstruct as unknown as jest.Mock;
    const lambdaProps = lambdaConstructMock.mock.calls[0][2];
    const senderConfig =
      lambdaProps.lambdaFunctionsResources['/easy-genomics/laboratory/run/process-notify-laboratory-run-completion'];

    expect(senderConfig).toBeDefined();
    expect(senderConfig.events).toHaveLength(1);
  });
});
