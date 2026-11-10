import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LambdaConstruct } from '../../../src/infra/constructs/lambda-construct';
import { UsageNestedStack } from '../../../src/infra/stacks/usage-nested-stack';

jest.mock('aws-cdk-lib/aws-lambda-event-sources', () => ({
  SqsEventSource: jest.fn().mockImplementation(() => ({})),
}));

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

  it('lets the run costs report read the totals and the organization labs, and nothing else', () => {
    const stack = createStack();

    const statements = stack.iam
      .getPolicyStatements('/easy-genomics/usage/list-run-costs')
      .map((statement) => statement.toStatementJson());

    expect(statements).toEqual([
      {
        Effect: 'Allow',
        Action: 'dynamodb:Query',
        Resource: `arn:aws:dynamodb:${region}:${account}:table/test-usage-daily-total-table`,
      },
      { Effect: 'Allow', Action: 'dynamodb:Query', Resource: laboratoryTableArn },
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

  describe('run-cost capture', () => {
    const consumer = '/easy-genomics/usage/process-capture-run-cost';
    const runTableArn = `arn:aws:dynamodb:${region}:${account}:table/test-laboratory-run-table`;

    it('creates the capture queue and its dead-letter queue as FIFO queues', () => {
      const template = Template.fromStack(createStack());

      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'test-run-cost-capture-dlq.fifo',
        FifoQueue: true,
        MessageRetentionPeriod: 1209600,
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'test-run-cost-capture-queue.fifo',
        FifoQueue: true,
        VisibilityTimeout: 900,
        RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
      });
    });

    it('consumes the capture queue one message at a time within a 15-minute timeout', () => {
      const stack = createStack();

      const lambdaProps = (LambdaConstruct as unknown as jest.Mock).mock.calls[0][2];
      const consumerConfig = lambdaProps.lambdaFunctionsResources[consumer];
      expect(consumerConfig.timeoutSeconds).toBe(900);
      expect(consumerConfig.environment).toEqual({ SEQERA_API_BASE_URL: 'https://seqera.example.com' });
      expect(consumerConfig.events).toHaveLength(1);
      expect(SqsEventSource).toHaveBeenCalledWith(stack.runCostCaptureQueue, { batchSize: 1 });
    });

    it('grants the consumer only what capture and the totals add need', () => {
      const stack = createStack();

      const statements = stack.iam.getPolicyStatements(consumer).map((statement) => statement.toStatementJson());

      expect(statements).toEqual([
        { Effect: 'Allow', Action: 'dynamodb:Query', Resource: [runTableArn, `${runTableArn}/index/*`] },
        { Effect: 'Allow', Action: 'dynamodb:UpdateItem', Resource: runTableArn },
        {
          Effect: 'Allow',
          Action: 'dynamodb:UpdateItem',
          Resource: `arn:aws:dynamodb:${region}:${account}:table/test-usage-daily-total-table`,
        },
        {
          Effect: 'Allow',
          Action: 'dynamodb:Query',
          Resource: [laboratoryTableArn, `${laboratoryTableArn}/index/*`],
        },
        {
          Effect: 'Allow',
          Action: 'ssm:GetParameter',
          Resource: `arn:aws:ssm:${region}:${account}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
        },
        {
          Effect: 'Allow',
          Action: ['sts:AssumeRole', 'sts:TagSession'],
          Resource: `arn:aws:iam::${account}:role/test-easy-genomics-omics-access-role`,
        },
        {
          Effect: 'Allow',
          Action: ['omics:GetRun', 'omics:ListRunTasks'],
          Resource: `arn:aws:omics:${region}:${account}:run/*`,
        },
      ]);
    });
  });
});
