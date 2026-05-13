import { Duration, NestedStack } from 'aws-cdk-lib';
import { Effect, PolicyStatement, StarPrincipal } from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { SesConstruct } from '../constructs/ses-construct';
import { SnsConstruct, TopicDetails, Topics } from '../constructs/sns-construct';
import { QueueDetails, Queues, SqsConstruct } from '../constructs/sqs-construct';
import { EasyGenomicsNestedStackProps } from '../types/back-end-stack';

/**
 * Easy Genomics nested stack: lambdas, SNS, SQS, SES, IAM, route registration.
 *
 * NOTE: This stack does NOT own the easy-genomics DynamoDB tables. Tables are
 * created by the parent `EasyGenomicsApiStack` and injected here via
 * `props.dynamoDBTables` so that:
 *   1. `cdk import` (which only walks a single template per invocation) can
 *      adopt the tables during the documented split-stack migration. See
 *      `docs/EASY_GENOMICS_PROD_MIGRATION.md`.
 *   2. The same `Map<string, Table>` reference is shared in-process with
 *      `DataProvisioningNestedStack` without needing CloudFormation exports.
 *
 * IAM policy statements in this nested stack reference table ARNs by string
 * template (built from `props.namePrefix`), so they continue to work
 * regardless of which stack physically owns the table resources.
 */
export class EasyGenomicsNestedStack extends NestedStack {
  readonly props: EasyGenomicsNestedStackProps;

  iam: IamConstruct;
  lambda: LambdaConstruct;
  ses: SesConstruct;
  sns: SnsConstruct;
  sqs: SqsConstruct;

  constructor(scope: Construct, id: string, props: EasyGenomicsNestedStackProps) {
    super(scope, id);
    this.props = props;

    // The enforceSSL option for sns topics is currently broken, that may get fixed in the
    // future. In the meantime we will apply a policy enforcing ssl in the policies section.
    this.sns = new SnsConstruct(this, `${this.props.constructNamespace}-sns`, {
      namePrefix: this.props.namePrefix,
      topics: <Topics>{
        ['organization-deletion-topic']: <TopicDetails>{ fifo: true, enforceSSL: true },
        ['laboratory-deletion-topic']: <TopicDetails>{ fifo: true, enforceSSL: true },
        ['user-deletion-topic']: <TopicDetails>{ fifo: true, enforceSSL: true },
        ['laboratory-run-update-topic']: <TopicDetails>{ fifo: true, enforceSSL: true },
        ['user-invite-topic']: <TopicDetails>{ fifo: true, enforceSSL: true },
        ['folder-download-topic']: <TopicDetails>{ fifo: true, enforceSSL: true },
      },
    });

    this.sqs = new SqsConstruct(this, `${this.props.constructNamespace}-sqs`, {
      namePrefix: this.props.namePrefix,
      envType: this.props.envType,
      queues: <Queues>{
        ['organization-management-queue']: <QueueDetails>{
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          snsTopics: [this.sns.snsTopics.get('organization-deletion-topic')],
          enforceSSL: true,
        },
        ['laboratory-management-queue']: <QueueDetails>{
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          snsTopics: [this.sns.snsTopics.get('laboratory-deletion-topic')],
          enforceSSL: true,
        },
        ['user-management-queue']: <QueueDetails>{
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          snsTopics: [this.sns.snsTopics.get('user-deletion-topic')],
          enforceSSL: true,
        },
        ['laboratory-run-update-queue']: <QueueDetails>{
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          snsTopics: [this.sns.snsTopics.get('laboratory-run-update-topic')],
          enforceSSL: true,
        },
        ['user-invite-queue']: <QueueDetails>{
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          snsTopics: [this.sns.snsTopics.get('user-invite-topic')],
          enforceSSL: true,
        },
        ['folder-download-queue']: <QueueDetails>{
          fifo: true,
          retentionPeriod: Duration.days(1),
          visibilityTimeout: Duration.minutes(15),
          snsTopics: [this.sns.snsTopics.get('folder-download-topic')],
          enforceSSL: true,
        },
      },
    });

    this.iam = new IamConstruct(this, `${this.props.constructNamespace}-iam`, {
      ...(<IamConstructProps>props), // Typecast to IamConstructProps
    });
    this.setupIamPolicies();

    // DynamoDB tables are created by the parent `EasyGenomicsApiStack` and
    // injected via `props.dynamoDBTables`. See class JSDoc for the rationale
    // (this layout is required for `cdk import` to be able to adopt the
    // tables during the documented split-stack migration).

    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements, // Pass declared Easy Genomics IAM policies for attaching to respective Lambda function
      lambdaFunctionsDir: 'src/app/controllers/easy-genomics',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {
        // Used for setting specific resources for a given Lambda function (e.g. environment settings, trigger events)
        '/easy-genomics/user/create-user-invitation-request': {
          environment: {
            COGNITO_USER_POOL_CLIENT_ID: this.props.userPoolClient?.userPoolClientId!,
            COGNITO_USER_POOL_ID: this.props.userPool?.userPoolId!,
            JWT_SECRET_KEY: this.props.jwtSecretKey,
          },
        },
        '/easy-genomics/user/create-bulk-user-invitation-requests': {
          environment: {
            SNS_USER_INVITE_TOPIC: this.sns.snsTopics.get('user-invite-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/user/process-create-user-invites': {
          events: [new SqsEventSource(this.sqs.sqsQueues.get('user-invite-queue')!, { batchSize: 10 })],
          environment: {
            COGNITO_USER_POOL_CLIENT_ID: this.props.userPoolClient?.userPoolClientId!,
            COGNITO_USER_POOL_ID: this.props.userPool?.userPoolId!,
            JWT_SECRET_KEY: this.props.jwtSecretKey,
            SNS_USER_INVITE_TOPIC: this.sns.snsTopics.get('user-invite-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/user/confirm-user-invitation-request': {
          environment: {
            COGNITO_KMS_KEY_ID: this.props.cognitoIdpKmsKey?.keyId!,
            COGNITO_KMS_KEY_ARN: this.props.cognitoIdpKmsKey?.keyArn!,
            COGNITO_USER_POOL_CLIENT_ID: this.props.userPoolClient?.userPoolClientId!,
            COGNITO_USER_POOL_ID: this.props.userPool?.userPoolId!,
            JWT_SECRET_KEY: this.props.jwtSecretKey,
          },
          methodOptions: {
            // apiKeyRequired: true,
            authorizer: undefined, // Explicitly remove authorizer
          },
        },
        '/easy-genomics/user/create-user-forgot-password-request': {
          environment: {
            COGNITO_USER_POOL_CLIENT_ID: this.props.userPoolClient?.userPoolClientId!,
            COGNITO_USER_POOL_ID: this.props.userPool?.userPoolId!,
          },
          methodOptions: {
            // apiKeyRequired: true,
            authorizer: undefined, // Explicitly remove authorizer
          },
        },
        '/easy-genomics/user/confirm-user-forgot-password-request': {
          environment: {
            COGNITO_KMS_KEY_ID: this.props.cognitoIdpKmsKey?.keyId!,
            COGNITO_KMS_KEY_ARN: this.props.cognitoIdpKmsKey?.keyArn!,
            COGNITO_USER_POOL_CLIENT_ID: this.props.userPoolClient?.userPoolClientId!,
            COGNITO_USER_POOL_ID: this.props.userPool?.userPoolId!,
            JWT_SECRET_KEY: this.props.jwtSecretKey,
          },
          methodOptions: {
            // apiKeyRequired: true,
            authorizer: undefined, // Explicitly remove authorizer
          },
        },
        '/easy-genomics/user/delete-user-request': {
          environment: {
            COGNITO_USER_POOL_CLIENT_ID: this.props.userPoolClient?.userPoolClientId!,
            COGNITO_USER_POOL_ID: this.props.userPool?.userPoolId!,
            JWT_SECRET_KEY: this.props.jwtSecretKey,
            SNS_USER_DELETION_TOPIC: this.sns.snsTopics.get('user-deletion-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/user/process-delete-user': {
          events: [new SqsEventSource(this.sqs.sqsQueues.get('user-management-queue')!, { batchSize: 1 })],
          environment: {
            SNS_USER_DELETION_TOPIC: this.sns.snsTopics.get('user-deletion-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/organization/create-organization': {
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
          },
        },
        '/easy-genomics/organization/update-organization': {
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
          },
        },
        '/easy-genomics/organization/delete-organization': {
          environment: {
            SNS_ORGANIZATION_DELETION_TOPIC: this.sns.snsTopics.get('organization-deletion-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/organization/process-delete-organization': {
          events: [new SqsEventSource(this.sqs.sqsQueues.get('organization-management-queue')!, { batchSize: 1 })],
          environment: {
            SNS_ORGANIZATION_DELETION_TOPIC: this.sns.snsTopics.get('organization-deletion-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/laboratory/create-laboratory': {
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
          },
        },
        '/easy-genomics/laboratory/update-laboratory': {
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
          },
        },
        '/easy-genomics/laboratory/delete-laboratory': {
          environment: {
            SNS_LABORATORY_DELETION_TOPIC: this.sns.snsTopics.get('laboratory-deletion-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/laboratory/process-delete-laboratory': {
          events: [new SqsEventSource(this.sqs.sqsQueues.get('laboratory-management-queue')!, { batchSize: 1 })],
          environment: {
            SNS_LABORATORY_DELETION_TOPIC: this.sns.snsTopics.get('laboratory-deletion-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/laboratory/run/create-laboratory-run': {
          environment: {
            SNS_LABORATORY_RUN_UPDATE_TOPIC: this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/laboratory/run/update-laboratory-run': {
          environment: {
            SNS_LABORATORY_RUN_UPDATE_TOPIC: this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/laboratory/run/process-update-laboratory-run': {
          events: [new SqsEventSource(this.sqs.sqsQueues.get('laboratory-run-update-queue')!, { batchSize: 5 })],
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
            SNS_LABORATORY_RUN_UPDATE_TOPIC: this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/laboratory/run/request-laboratory-run-status-check': {
          environment: {
            SNS_LABORATORY_RUN_UPDATE_TOPIC: this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/organization/workflow-access/list-workflow-catalog': {
          environment: {
            SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
          },
          timeoutSeconds: 60,
          memorySizeMb: 1024,
        },
        '/easy-genomics/file/request-folder-download-job': {
          environment: {
            SNS_FOLDER_DOWNLOAD_TOPIC: this.sns.snsTopics.get('folder-download-topic')?.topicArn || '',
          },
        },
        '/easy-genomics/file/process-folder-download-job': {
          events: [new SqsEventSource(this.sqs.sqsQueues.get('folder-download-queue')!, { batchSize: 1 })],
          timeoutSeconds: 900,
          memorySizeMb: 3008,
        },
      },
      environment: {
        // Defines the common environment settings for all lambda functions
        ACCOUNT_ID: this.props.env.account!,
        REGION: this.props.env.region!,
        DOMAIN_NAME: this.props.appDomainName,
        ENV_TYPE: this.props.envType,
        ENV_NAME: this.props.envName,
        NAME_PREFIX: this.props.namePrefix,
      },
    });

    this.ses = new SesConstruct(this, `${this.props.constructNamespace}-ses`, {
      awsAccount: this.props.env.account!,
      awsRegion: this.props.env.region!,
      appDomainName: this.props.appDomainName,
      awsHostedZoneId: this.props.awsHostedZoneId,
      emailSender: `no.reply@${this.props.appDomainName}`,
      envType: this.props.envType,
      envName: this.props.envName,
    });

    // Nag Suppressions
    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Need access to all organization and laboratory nf token parameters',
          appliesTo: [
            `Resource::arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
          ], // optional
        },
      ],
      true,
    );
  }

  // Easy Genomics specific IAM policies
  private setupIamPolicies = () => {
    // Currently the enforceSSL option for SNS topics is broken
    // We have to apply the policy ourselves.
    this.sns.snsTopics.forEach((snsTopic: Topic) => {
      snsTopic.addToResourcePolicy(
        new PolicyStatement({
          resources: [`${snsTopic.topicArn}`],
          actions: ['sns:Publish'],
          conditions: {
            StringEquals: {
              'aws:SecureTransport': false,
            },
          },
          effect: Effect.DENY,
          principals: [new StarPrincipal()],
        }),
      );
    });

    // /easy-genomics/organization/create-organization
    this.iam.addPolicyStatements('/easy-genomics/organization/create-organization', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/organization/read-organization
    this.iam.addPolicyStatements('/easy-genomics/organization/read-organization', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/organization/list-organizations
    this.iam.addPolicyStatements('/easy-genomics/organization/list-organizations', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
        ],
        actions: ['dynamodb:Scan'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/organization/update-organization
    this.iam.addPolicyStatements('/easy-genomics/organization/update-organization', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/organization/delete-organization
    this.iam.addPolicyStatements('/easy-genomics/organization/delete-organization', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table/index/*`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('organization-deletion-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/organization/process-delete-organization
    this.iam.addPolicyStatements('/easy-genomics/organization/process-delete-organization', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/organization/user/add-organization-user
    this.iam.addPolicyStatements('/easy-genomics/organization/user/add-organization-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:PutItem'],
      }),
    ]);
    // /easy-genomics/organization/user/edit-organization-user
    this.iam.addPolicyStatements('/easy-genomics/organization/user/edit-organization-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/organization/user/list-organization-users
    this.iam.addPolicyStatements('/easy-genomics/organization/user/list-organization-users', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
    ]);
    // /easy-genomics/organization/user/list-organization-users-details
    this.iam.addPolicyStatements('/easy-genomics/organization/user/list-organization-users-details', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table/index/*`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:BatchGetItem'],
      }),
    ]);
    // /easy-genomics/organization/user/request-organization-user
    this.iam.addPolicyStatements('/easy-genomics/organization/user/request-organization-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
      }),
    ]);
    // /easy-genomics/organization/user/remove-organization-user
    this.iam.addPolicyStatements('/easy-genomics/organization/user/remove-organization-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/create-laboratory
    this.iam.addPolicyStatements('/easy-genomics/laboratory/create-laboratory', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/github-access-token`,
        ],
        actions: ['ssm:PutParameter'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/read-laboratory
    this.iam.addPolicyStatements('/easy-genomics/laboratory/read-laboratory', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/github-access-token`,
        ],
        actions: ['ssm:GetParameter'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/request-laboratory
    this.iam.addPolicyStatements('/easy-genomics/laboratory/request-laboratory', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/list-laboratories
    this.iam.addPolicyStatements('/easy-genomics/laboratory/list-laboratories', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/update-laboratory
    this.iam.addPolicyStatements('/easy-genomics/laboratory/update-laboratory', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:GetBucketLocation'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/github-access-token`,
        ],
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/delete-laboratory
    this.iam.addPolicyStatements('/easy-genomics/laboratory/delete-laboratory', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/github-access-token`,
        ],
        actions: ['ssm:DeleteParameter'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('laboratory-deletion-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/process-delete-laboratory
    this.iam.addPolicyStatements('/easy-genomics/laboratory/process-delete-laboratory', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/user/add-laboratory-user
    this.iam.addPolicyStatements('/easy-genomics/laboratory/user/add-laboratory-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/user/edit-laboratory-user
    this.iam.addPolicyStatements('/easy-genomics/laboratory/user/edit-laboratory-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/user/list-laboratory-users
    this.iam.addPolicyStatements('/easy-genomics/laboratory/user/list-laboratory-users', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
    ]);
    // /easy-genomics/laboratory/user/list-laboratory-users-details
    this.iam.addPolicyStatements('/easy-genomics/laboratory/user/list-laboratory-users-details', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:BatchGetItem'],
      }),
    ]);
    // /easy-genomics/laboratory/user/remove-laboratory-user
    this.iam.addPolicyStatements('/easy-genomics/laboratory/user/remove-laboratory-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/laboratory/user/request-laboratory-user
    this.iam.addPolicyStatements('/easy-genomics/laboratory/user/request-laboratory-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
      }),
    ]);

    // /easy-genomics/user/list-all-users
    this.iam.addPolicyStatements('/easy-genomics/user/list-all-users', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
        ],
        actions: ['dynamodb:Scan'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/list-user-self
    this.iam.addPolicyStatements('/easy-genomics/user/list-user-self', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/update-user-request
    this.iam.addPolicyStatements('/easy-genomics/user/update-user-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table/index/*`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/update-user-last-accessed-info
    this.iam.addPolicyStatements('/easy-genomics/user/update-user-last-accessed-info', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/delete-user-request
    this.iam.addPolicyStatements('/easy-genomics/user/delete-user-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table/index/*`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table/index/*`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:cognito-idp:${this.props.env.region!}:${this.props.env.account!}:userpool/${this.props.userPool?.userPoolId}`,
        ],
        actions: ['cognito-idp:AdminDeleteUser'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('user-deletion-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/user/process-delete-user
    this.iam.addPolicyStatements('/easy-genomics/user/process-delete-user', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/create-laboratory-run
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/create-laboratory-run', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      // Data tagging table: best-effort association of input files with the workflow tag.
      // create-laboratory-run reads/writes TAG/FILE/MAP rows via LaboratoryDataTaggingService.
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-data-tagging-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-data-tagging-table/index/*`,
        ],
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
        ],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/read-laboratory-run
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/read-laboratory-run', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/list-laboratory-runs
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/list-laboratory-runs', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/request-laboratory-run-status-check
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/request-laboratory-run-status-check', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/request-apply-run-retention-policy
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/request-apply-run-retention-policy', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/update-laboratory-run
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/update-laboratory-run', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/process-update-laboratory-run
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/process-update-laboratory-run', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
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
        resources: [`${this.sns.snsTopics.get('laboratory-run-update-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`],
        actions: ['omics:GetRun'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:iam::${this.props.env.account!}:role/${this.props.namePrefix}-easy-genomics-omics-access-role`,
        ],
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/laboratory/run/delete-laboratory-run
    this.iam.addPolicyStatements('/easy-genomics/laboratory/run/delete-laboratory-run', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:DeleteItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/user/create-user-invitation-request
    this.iam.addPolicyStatements('/easy-genomics/user/create-user-invitation-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:cognito-idp:${this.props.env.region!}:${this.props.env.account!}:userpool/${this.props.userPool?.userPoolId}`,
        ],
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminUpdateUserAttributes'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ses:${this.props.env.region!}:${this.props.env.account!}:identity/${this.props.appDomainName}`,
          `arn:aws:ses:${this.props.env.region!}:${this.props.env.account!}:identity/*@*`,
          `arn:aws:ses:${this.props.env.region!}:${this.props.env.account!}:template/*`,
        ],
        actions: ['ses:SendTemplatedEmail'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'ses:FromAddress': `no.reply@${this.props.appDomainName}`,
          },
        },
      }),
    ]);
    // /easy-genomics/user/create-bulk-user-invitation-requests
    this.iam.addPolicyStatements('/easy-genomics/user/create-bulk-user-invitation-requests', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('user-invite-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/process-create-user-invites
    this.iam.addPolicyStatements('/easy-genomics/user/process-create-user-invites', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:cognito-idp:${this.props.env.region!}:${this.props.env.account!}:userpool/${this.props.userPool?.userPoolId}`,
        ],
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminUpdateUserAttributes'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ses:${this.props.env.region!}:${this.props.env.account!}:identity/${this.props.appDomainName}`,
          `arn:aws:ses:${this.props.env.region!}:${this.props.env.account!}:identity/*@*`,
          `arn:aws:ses:${this.props.env.region!}:${this.props.env.account!}:template/*`,
        ],
        actions: ['ses:SendTemplatedEmail'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'ses:FromAddress': `no.reply@${this.props.appDomainName}`,
          },
        },
      }),
    ]);
    // /easy-genomics/user/confirm-user-invitation-request
    this.iam.addPolicyStatements('/easy-genomics/user/confirm-user-invitation-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-unique-reference-table`,
        ],
        actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-organization-user-table/index/*`,
        ],
        actions: ['dynamodb:Query', 'dynamodb:GetItem', 'dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [this.props.cognitoIdpKmsKey?.keyArn!],
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:cognito-idp:${this.props.env.region!}:${this.props.env.account!}:userpool/${this.props.userPool?.userPoolId}`,
        ],
        actions: [
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUpdateUserAttributes',
        ],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/create-user-forgot-password-request
    this.iam.addPolicyStatements('/easy-genomics/user/create-user-forgot-password-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:cognito-idp:${this.props.env.region!}:${this.props.env.account!}:userpool/${this.props.userPool!.userPoolId}`,
        ],
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:ForgotPassword'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/user/confirm-user-forgot-password-request
    this.iam.addPolicyStatements('/easy-genomics/user/confirm-user-forgot-password-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [this.props.cognitoIdpKmsKey?.keyArn!],
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:cognito-idp:${this.props.env.region!}:${this.props.env.account!}:userpool/${this.props.userPool!.userPoolId}`,
        ],
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:ConfirmForgotPassword'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/list-buckets
    this.iam.addPolicyStatements('/easy-genomics/list-buckets', [
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListAllMyBuckets', 's3:GetBucketTagging'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/file/request-file-download-url
    this.iam.addPolicyStatements('/easy-genomics/file/request-file-download-url', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:GetBucketLocation', 's3:ListBucket'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*/*'],
        actions: ['s3:GetObject'], // Required to generate pre-signed S3 Urls for downloading with GetObject request
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/file/request-list-bucket-objects
    this.iam.addPolicyStatements('/easy-genomics/file/request-list-bucket-objects', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/file/request-top-level-bucket-objects
    this.iam.addPolicyStatements('/easy-genomics/file/request-top-level-bucket-objects', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-run-table`,
        ],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/file/request-search-bucket-objects
    this.iam.addPolicyStatements('/easy-genomics/file/request-search-bucket-objects', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/file/request-folder-download-job
    this.iam.addPolicyStatements('/easy-genomics/file/request-folder-download-job', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*/*'],
        actions: ['s3:PutObject'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [`${this.sns.snsTopics.get('folder-download-topic')?.topicArn || ''}`],
        actions: ['sns:Publish'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/file/request-folder-download-job-status
    this.iam.addPolicyStatements('/easy-genomics/file/request-folder-download-job-status', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*/*'],
        actions: ['s3:GetObject'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/file/process-folder-download-job
    this.iam.addPolicyStatements('/easy-genomics/file/process-folder-download-job', [
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*/*'],
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/upload/create-file-upload-request
    this.iam.addPolicyStatements('/easy-genomics/upload/create-file-upload-request', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:GetBucketLocation'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*/*'],
        actions: ['s3:PutObject'], // Required to generate pre-signed S3 Urls for uploading with PutObject request
        effect: Effect.ALLOW,
      }),
    ]);
    // /easy-genomics/upload/create-file-upload-sample-sheet
    this.iam.addPolicyStatements('/easy-genomics/upload/create-file-upload-sample-sheet', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: [
          's3:GetBucketLocation',
          's3:ListBucket', // Required for HeadObject command
          's3:GetObject', // Required for HeadObject command
          's3:HeadObject',
          's3:PutObject',
        ],
        effect: Effect.ALLOW,
      }),
    ]);

    const laboratoryWorkflowAccessTableArn = `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-workflow-access-table`;
    const laboratoryWorkflowAccessTableAnyIndex = `${laboratoryWorkflowAccessTableArn}/index/*`;

    // /easy-genomics/organization/workflow-access/list-workflow-catalog
    this.iam.addPolicyStatements('/easy-genomics/organization/workflow-access/list-workflow-catalog', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:ListWorkflows', 'omics:ListShares'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
        ],
        actions: ['ssm:GetParameter'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /easy-genomics/organization/workflow-access/list-workflow-access-assignments
    this.iam.addPolicyStatements('/easy-genomics/organization/workflow-access/list-workflow-access-assignments', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [laboratoryWorkflowAccessTableArn, laboratoryWorkflowAccessTableAnyIndex],
        actions: ['dynamodb:Query'],
      }),
    ]);

    // /easy-genomics/organization/workflow-access/edit-workflow-access-batch
    this.iam.addPolicyStatements('/easy-genomics/organization/workflow-access/edit-workflow-access-batch', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [laboratoryWorkflowAccessTableArn, laboratoryWorkflowAccessTableAnyIndex],
        actions: ['dynamodb:PutItem', 'dynamodb:DeleteItem'],
      }),
    ]);

    const laboratoryDataTaggingTableArn = `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-data-tagging-table`;
    const laboratoryDataTaggingTableAnyIndex = `${laboratoryDataTaggingTableArn}/index/*`;

    const laboratoryDataTaggingDynamoResources = [laboratoryDataTaggingTableArn, laboratoryDataTaggingTableAnyIndex];
    const laboratoryDataTaggingDynamoActions = [
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:Query',
      'dynamodb:BatchGetItem',
    ];

    const laboratoryReadForDataCollections = [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
    ];

    // /easy-genomics/data-collections/list-tags
    this.iam.addPolicyStatements('/easy-genomics/data-collections/list-tags', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: ['dynamodb:Query'],
      }),
    ]);

    // /easy-genomics/data-collections/create-tag
    this.iam.addPolicyStatements('/easy-genomics/data-collections/create-tag', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/update-tag
    this.iam.addPolicyStatements('/easy-genomics/data-collections/update-tag', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/delete-tag
    this.iam.addPolicyStatements('/easy-genomics/data-collections/delete-tag', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/request-list-file-tags
    this.iam.addPolicyStatements('/easy-genomics/data-collections/request-list-file-tags', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/add-tags-to-files
    this.iam.addPolicyStatements('/easy-genomics/data-collections/add-tags-to-files', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/edit-batch
    this.iam.addPolicyStatements('/easy-genomics/data-collections/edit-batch', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/list-files-by-tag
    this.iam.addPolicyStatements('/easy-genomics/data-collections/list-files-by-tag', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: laboratoryDataTaggingDynamoResources,
        actions: laboratoryDataTaggingDynamoActions,
      }),
    ]);

    // /easy-genomics/data-collections/request-laboratory-bucket-objects
    this.iam.addPolicyStatements('/easy-genomics/data-collections/request-laboratory-bucket-objects', [
      ...laboratoryReadForDataCollections,
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
    ]);
  };
}
