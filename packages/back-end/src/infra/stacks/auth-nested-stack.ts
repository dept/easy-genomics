import { NestedStack } from 'aws-cdk-lib';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { CognitoIdpConstruct } from '../constructs/cognito-idp-construct';
import { DynamoConstruct } from '../constructs/dynamodb-construct';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { AuthNestedStackProps } from '../types/back-end-stack';

export class AuthNestedStack extends NestedStack {
  readonly props: AuthNestedStackProps;
  readonly dynamoDBTables: Map<string, Table> = new Map();
  dynamoDB: DynamoConstruct;
  iam: IamConstruct;
  lambda: LambdaConstruct;
  cognito: CognitoIdpConstruct;

  constructor(scope: Construct, id: string, props: AuthNestedStackProps) {
    super(scope, id);
    this.props = props;

    this.iam = new IamConstruct(this, `${this.props.constructNamespace}-iam`, {
      ...(<IamConstructProps>props), // Typecast to IamConstructProps
    });
    this.setupIamPolicies();

    this.dynamoDB = new DynamoConstruct(this, `${this.props.constructNamespace}-dynamodb`, {
      envType: this.props.envType,
    });
    this.setupDynamoDBTables();

    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}-lambdas`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements, // Pass declared Auth IAM policies for attaching to respective Lambda function
      lambdaFunctionsDir: 'src/app/controllers/auth',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {
        // Used for setting specific resources for a given Lambda function (e.g. environment settings, trigger events)
        '/auth/process-custom-email-sender': {
          environment: {
            JWT_SECRET_KEY: this.props.jwtSecretKey,
          },
        },
        '/auth/process-pre-token-generation': {
          environment: {
            SYSTEM_ADMIN_EMAIL: this.props.sysAdminEmail || '',
          },
        },
      },
      environment: {
        // Defines the common environment settings for all lambda functions
        ACCOUNT_ID: this.props.env.account!,
        REGION: this.props.env.region!,
        DOMAIN_NAME: this.props.appDomainName,
        NAME_PREFIX: this.props.namePrefix,
      },
    });

    // Setup Cognito IDP and make it accessible by other Nested Stacks
    this.cognito = new CognitoIdpConstruct(this, `${this.props.constructNamespace}-cognito-idp`, {
      ...this.props,
      constructNamespace: this.props.constructNamespace,
      authLambdaFunctions: this.lambda.lambdaFunctions, // Pass Auth Lambda functions for registering with Cognito Event triggers
      customSenderKmsKey: this.props.cognitoIdpKmsKey,
      googleClientId: this.props.googleClientId,
      googleClientSecret: this.props.googleClientSecret,
      callbackUrls: this.props.callbackUrls,
      logoutUrls: this.props.logoutUrls,
      cognitoDomainPrefix: this.props.cognitoDomainPrefix,
    });
  }

  // Auth specific IAM policies
  private setupIamPolicies = () => {
    // /auth/process-custom-email-sender
    this.iam.addPolicyStatements('/auth/process-custom-email-sender', [
      new PolicyStatement({
        resources: [this.props.cognitoIdpKmsKey?.keyArn!],
        actions: ['kms:CreateGrant', 'kms:Encrypt'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'aws:SourceAccount': `${this.props.env.account!}`,
          },
        },
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
    // /auth/process-post-authentication
    this.iam.addPolicyStatements('/auth/process-post-authentication', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-authentication-log-table`,
        ],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /auth/process-pre-token-generation
    this.iam.addPolicyStatements('/auth/process-pre-token-generation', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /auth/process-pre-signup
    this.iam.addPolicyStatements('/auth/process-pre-signup', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-user-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);
  };

  // Auth specific DynamoDB tables
  private setupDynamoDBTables = () => {
    /** Update the definitions below to update / add additional DynamoDB tables **/
    // Authentication-Log Table
    const authenticationLogTableName = `${this.props.namePrefix}-authentication-log-table`;
    const authenticationLogTable = this.dynamoDB.createTable(authenticationLogTableName, {
      partitionKey: {
        name: 'UserName',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'DateTime',
        type: AttributeType.NUMBER,
      },
    });
    this.dynamoDBTables.set(authenticationLogTableName, authenticationLogTable);
  };
}
