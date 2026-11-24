import { Duration, NestedStack } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { SqsConstruct } from '../constructs/sqs-construct';
import { UsageNestedStackProps } from '../types/back-end-stack';
import { RUN_COST_CAPTURE_QUEUE } from '../utils/run-cost-capture-queue';

const DEFAULT_HEALTHOMICS_RATES_REFRESH_SCHEDULE = 'cron(0 6 ? * MON *)';
const EVENTBRIDGE_SCHEDULE_EXPRESSION = /^(cron|rate)\(.+\)$/;

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

    const ratesRefreshEnabled = props.healthomicsRatesRefresh?.enabled !== false;
    const ratesRefreshSchedule = props.healthomicsRatesRefresh?.schedule || DEFAULT_HEALTHOMICS_RATES_REFRESH_SCHEDULE;
    if (!EVENTBRIDGE_SCHEDULE_EXPRESSION.test(ratesRefreshSchedule)) {
      throw new Error(
        `Invalid healthomics-rates-refresh.schedule '${ratesRefreshSchedule}': expected an EventBridge cron(...) or rate(...) expression`,
      );
    }

    // A capture that keeps failing moves here after three attempts instead of being retried forever.
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
    this.setupIamPolicies(ratesRefreshEnabled);

    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements,
      lambdaFunctionsDir: 'src/app/controllers/easy-genomics/usage',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {
        '/easy-genomics/usage/process-refresh-healthomics-rates': ratesRefreshEnabled
          ? {
              callbacks: [
                (lambdaFunction) => {
                  new Rule(this, `${this.props.namePrefix}-healthomics-rates-refresh-schedule`, {
                    ruleName: `${this.props.namePrefix}-healthomics-rates-refresh-schedule`,
                    schedule: Schedule.expression(ratesRefreshSchedule),
                    description: "Refreshes this region's HealthOmics rates from AWS's public price list.",
                    targets: [new LambdaFunction(lambdaFunction)],
                  });
                },
              ],
            }
          : { skip: true },
        // HealthOmics runs with thousands of tasks take minutes of ListRunTasks paging.
        '/easy-genomics/usage/process-capture-run-cost': {
          events: [new SqsEventSource(this.runCostCaptureQueue, { batchSize: 1 })],
          timeoutSeconds: 900,
          memorySizeMb: 1024,
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
            HEALTHOMICS_RATES_REFRESH_ENABLED: String(ratesRefreshEnabled),
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

  private setupIamPolicies = (ratesRefreshEnabled: boolean) => {
    const healthOmicsRatesParameterArn = `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/${this.props.namePrefix}/healthomics-rates/current`;
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

    // /easy-genomics/usage/process-refresh-healthomics-rates
    if (ratesRefreshEnabled) {
      this.iam.addPolicyStatements('/easy-genomics/usage/process-refresh-healthomics-rates', [
        new PolicyStatement({
          resources: [healthOmicsRatesParameterArn],
          actions: ['ssm:GetParameter', 'ssm:PutParameter'],
          effect: Effect.ALLOW,
        }),
      ]);
    }

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
      // Prices HealthOmics runs with the rates process-refresh-healthomics-rates stores.
      new PolicyStatement({
        resources: [healthOmicsRatesParameterArn],
        actions: ['ssm:GetParameter'],
        effect: Effect.ALLOW,
      }),
    ]);
  };
}
