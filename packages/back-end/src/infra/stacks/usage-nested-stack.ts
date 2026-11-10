import { Duration, NestedStack } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { SqsConstruct } from '../constructs/sqs-construct';
import { UsageNestedStackProps } from '../types/back-end-stack';
import { RUN_COST_CAPTURE_QUEUE } from '../utils/run-cost-capture-queue';

/**
 * Usage limits and run costs. Its handlers sit under `controllers/easy-genomics/usage`
 * and are served by the Easy Genomics API, but are built here so the route-heavy
 * EasyGenomicsNestedStack doesn't grow with this domain.
 */
export class UsageNestedStack extends NestedStack {
  props: UsageNestedStackProps;
  iam: IamConstruct;
  lambda: LambdaConstruct;
  sqs: SqsConstruct;
  /** Published to by process-update-laboratory-run in the main nested stack, which builds its URL from the name prefix. */
  runCostCaptureQueue: Queue;

  constructor(scope: Construct, id: string, props: UsageNestedStackProps) {
    super(scope, id);
    this.props = props;

    // A capture that keeps failing must not sit on the lab's FIFO group and block later runs.
    const runCostCaptureDlq = new Queue(this, `${this.props.namePrefix}-run-cost-capture-dlq`, {
      queueName: `${this.props.namePrefix}-run-cost-capture-dlq.fifo`,
      fifo: true,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });

    // Visibility timeout matches the consumer's 900-second timeout so a slow capture isn't delivered twice.
    this.sqs = new SqsConstruct(this, `${this.props.constructNamespace}-sqs`, {
      namePrefix: this.props.namePrefix,
      envType: this.props.envType,
      queues: {
        [RUN_COST_CAPTURE_QUEUE]: {
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          enforceSSL: true,
          deadLetterQueue: { queue: runCostCaptureDlq, maxReceiveCount: 3 },
        },
      },
    });
    this.runCostCaptureQueue = this.sqs.sqsQueues.get(RUN_COST_CAPTURE_QUEUE)!;

    this.iam = new IamConstruct(this, `${this.props.constructNamespace}-iam`, {
      ...(<IamConstructProps>props), // Typecast to IamConstructProps
    });
    this.setupIamPolicies();

    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements,
      lambdaFunctionsDir: 'src/app/controllers/easy-genomics/usage',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {
        // HealthOmics runs with thousands of tasks take minutes of ListRunTasks paging.
        '/easy-genomics/usage/process-capture-run-cost': {
          events: [new SqsEventSource(this.runCostCaptureQueue, { batchSize: 1 })],
          timeoutSeconds: 900,
          memorySizeMb: 1024,
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
          },
        },
      },
      environment: {
        ACCOUNT_ID: this.props.env.account!,
        REGION: this.props.env.region!,
        DOMAIN_NAME: this.props.appDomainName,
        ENV_TYPE: this.props.envType,
        NAME_PREFIX: this.props.namePrefix,
      },
    });
  }

  private setupIamPolicies = () => {
    const laboratoryTableArn = `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`;
    const laboratoryRunTableArn = `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`;

    // /easy-genomics/usage/update-laboratory-run-limits
    this.iam.addPolicyStatements('/easy-genomics/usage/update-laboratory-run-limits', [
      new PolicyStatement({
        resources: [`${laboratoryTableArn}/index/*`],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [laboratoryTableArn],
        actions: ['dynamodb:UpdateItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/usage/process-capture-run-cost
    this.iam.addPolicyStatements('/easy-genomics/usage/process-capture-run-cost', [
      new PolicyStatement({
        resources: [laboratoryRunTableArn, `${laboratoryRunTableArn}/index/*`],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [laboratoryRunTableArn],
        actions: ['dynamodb:UpdateItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [laboratoryTableArn, `${laboratoryTableArn}/index/*`],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
        ],
        actions: ['ssm:GetParameter'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:iam::${this.props.env.account!}:role/${this.props.namePrefix}-easy-genomics-omics-access-role`,
        ],
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`],
        actions: ['omics:GetRun', 'omics:ListRunTasks'],
        effect: Effect.ALLOW,
      }),
    ]);
  };
}
