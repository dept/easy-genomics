import { NestedStack } from 'aws-cdk-lib';
import { AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Match, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaFunctionTarget } from 'aws-cdk-lib/aws-events-targets';
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Policy,
  ArnPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { DynamoConstruct } from '../constructs/dynamodb-construct';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { AwsHealthOmicsNestedStackProps } from '../types/back-end-stack';

export class AwsHealthOmicsNestedStack extends NestedStack {
  readonly props: AwsHealthOmicsNestedStackProps;
  dynamoDB: DynamoConstruct;
  iam: IamConstruct;
  lambda: LambdaConstruct;

  private readonly workflowSchemaTableName: string;
  private readonly workflowSchemaTableArn: string;
  private readonly githubPatSecretArn: string;
  private readonly githubPatSecretName: string;
  private readonly workflowTagRule: Rule;

  constructor(scope: Construct, id: string, props: AwsHealthOmicsNestedStackProps) {
    super(scope, id);
    this.props = props;

    // --- DynamoDB: workflow-schema-table ---
    // Caches the nf-core JSON Schema fetched from GitHub per workflow.
    // PK: WorkflowId, SK: Version
    this.dynamoDB = new DynamoConstruct(this, `${this.props.constructNamespace}-dynamodb`, {
      envType: this.props.envType,
    });

    this.workflowSchemaTableName = `${this.props.namePrefix}-workflow-schema-table`;
    const workflowSchemaTable = this.dynamoDB.createTable(this.workflowSchemaTableName, {
      partitionKey: {
        name: 'WorkflowId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Version',
        type: AttributeType.STRING,
      },
    });
    this.workflowSchemaTableArn = workflowSchemaTable.tableArn;

    // --- Secrets Manager: GitHub Fine-Grained PAT ---
    // If github-pat-secret-name is configured (yaml or CI/CD env), import the existing secret.
    // Otherwise, create a placeholder secret — set its value after deploy:
    //   aws secretsmanager put-secret-value --secret-id <name> --secret-string '<token>'
    let githubPatSecret: ISecret;
    if (this.props.githubPatSecretName) {
      githubPatSecret = Secret.fromSecretNameV2(
        this,
        `${this.props.namePrefix}-github-pat-secret`,
        this.props.githubPatSecretName,
      );
    } else {
      githubPatSecret = new Secret(this, `${this.props.namePrefix}-github-pat-secret`, {
        secretName: `${this.props.namePrefix}-github-pat-secret`,
        description:
          'GitHub Fine-Grained PAT (Contents: Read-only) for fetching nextflow_schema.json from workflow repos. ' +
          'Set the secret value after deploy.',
      });
    }
    this.githubPatSecretArn = githubPatSecret.secretArn;
    this.githubPatSecretName = githubPatSecret.secretName;

    // --- EventBridge rule: watch github-repo-url tag changes on HealthOmics workflows ---
    // Primary event source: aws.tag "Tag Change on Resource".
    // Note: if aws.tag events prove unreliable for HealthOmics, an alternative is to
    // capture omics:TagResource via CloudTrail → EventBridge using source: ["aws.cloudtrail"]
    // and detail.eventName: ["TagResource"].
    this.workflowTagRule = new Rule(this, `${this.props.namePrefix}-workflow-schema-tag-rule`, {
      ruleName: `${this.props.namePrefix}-workflow-schema-tag-rule`,
      description: 'Triggers schema fetch when github-repo-url tag is set or updated on a HealthOmics workflow',
      eventPattern: {
        source: ['aws.tag'],
        detailType: ['Tag Change on Resource'],
        // Filter to HealthOmics workflow ARNs only
        resources: Match.prefix(`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/`),
        // Fire only when the github-repo-url tag key was part of the change
        detail: {
          'changed-tag-keys': ['github-repo-url'],
        },
      },
    });

    // --- IAM ---
    this.iam = new IamConstruct(this, `${this.props.constructNamespace}-iam`, {
      ...(<IamConstructProps>props),
    });

    // The following setup order of IAM definitions is mandatory
    this.setupPolicyStatements();
    this.setupPolicyDocuments(); // Depends on policy statements
    this.setupRoles(); // Depends on policy documents
    this.setupLambdaPolicyStatements(); // Depends on policy documents / statements / roles

    // --- Lambda construct ---
    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements,
      lambdaFunctionsDir: 'src/app/controllers/aws-healthomics',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {
        // Schema fetcher: triggered by EventBridge when github-repo-url tag changes
        '/aws-healthomics/workflow/process-fetch-workflow-schema': {
          callbacks: [
            (fn: IFunction) => {
              this.workflowTagRule.addTarget(new LambdaFunctionTarget(fn));
            },
          ],
          environment: {
            GITHUB_PAT_SECRET_NAME: this.githubPatSecretName,
          },
        },
        // Schema server: GET endpoint called when user starts a workflow run
        '/aws-healthomics/workflow/read-workflow-schema': {
          environment: {
            GITHUB_PAT_SECRET_NAME: this.githubPatSecretName,
          },
        },
      },
      environment: {
        ACCOUNT_ID: this.props.env.account!,
        REGION: this.props.env.region!,
        DOMAIN_NAME: this.props.appDomainName,
        NAME_PREFIX: this.props.namePrefix,
      },
    });

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Need access to all omics runs and workflows',
          appliesTo: [
            `Resource::arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`,
            `Resource::arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`,
          ],
        },
      ],
      true,
    );
  }

  // AWS HealthOmics specific IAM policies
  private setupPolicyStatements = () => {
    // iam-get-role-pass-role-policy-statement
    this.iam.addPolicyStatements('iam-get-role-pass-role-policy-statement', [
      new PolicyStatement({
        resources: ['arn:aws:iam:::role/*', `arn:aws:iam::${this.props.env.account!}:role/*`],
        actions: ['iam:GetRole', 'iam:PassRole'],
        effect: Effect.ALLOW,
      }),
    ]);

    // omics-full-access-policy-statement
    this.iam.addPolicyStatements('omics-full-access-policy-statement', [
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:*'],
        effect: Effect.ALLOW,
      }),
    ]);

    // omics-start-run-policy-statement
    this.iam.addPolicyStatements('omics-start-run-policy-statement', [
      new PolicyStatement({
        resources: [
          `arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`,
          `arn:aws:omics:${this.props.env.region!}::workflow/*`,
        ],
        actions: ['omics:StartRun'],
        effect: Effect.ALLOW,
      }),
    ]);

    // omics-log-policy-statement
    this.iam.addPolicyStatements('omics-log-policy-statement', [
      new PolicyStatement({
        resources: [
          `arn:aws:logs:${this.props.env.region!}:${this.props.env.account!}:log-group:/aws/omics/WorkflowLog:*`,
        ],
        actions: ['logs:CreateLogGroup'],
        effect: Effect.ALLOW,
      }),
    ]);
    // omics-log-stream-policy-statement
    this.iam.addPolicyStatements('omics-log-stream-policy-statement', [
      new PolicyStatement({
        resources: [
          `arn:aws:logs:${this.props.env.region!}:${this.props.env.account!}:log-group:/aws/omics/WorkflowLog:log-stream:*`,
        ],
        actions: ['logs:DescribeLogStreams', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        effect: Effect.ALLOW,
      }),
    ]);

    // omics-ecr-policy-statement
    this.iam.addPolicyStatements('omics-ecr-policy-statement', [
      new PolicyStatement({
        resources: [`arn:aws:ecr:${this.props.env.region!}:${this.props.env.account!}:repository/*`],
        actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability'],
        effect: Effect.ALLOW,
      }),
    ]);
    // omics-iam-pass-role-policy-statement
    this.iam.addPolicyStatements('omics-iam-pass-role-policy-statement', [
      new PolicyStatement({
        resources: ['*'],
        actions: ['iam:PassRole'],
        effect: Effect.ALLOW,
        conditions: {
          stringEquals: {
            'iam:PassedToService': 'omics.amazonaws.com',
          },
        },
      }),
    ]);

    // omics-s3-bucket-policy-statement
    this.iam.addPolicyStatements('omics-s3-bucket-policy-statement', [
      new PolicyStatement({
        resources: ['arn:aws:s3:::*/*'],
        actions: ['s3:GetObject', 's3:PutObject'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: ['arn:aws:s3:::*'],
        actions: ['s3:ListBucket'],
        effect: Effect.ALLOW,
      }),
    ]);

    // omics-access-role-permissions-policy-statement
    // Permissions for the Omics access role assumed by Easy Genomics Lambdas
    this.iam.addPolicyStatements('omics-access-role-permissions-policy-statement', [
      // Allow StartRun and TagResource only when request tags match principal tags for lab and org
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:StartRun', 'omics:TagResource'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'aws:RequestTag/LaboratoryId': '${aws:PrincipalTag/LaboratoryId}',
            'aws:RequestTag/OrganizationId': '${aws:PrincipalTag/OrganizationId}',
          },
        },
      }),
      // Allow GetRun, ListRuns, and CancelRun only for Runs tagged with the same LaboratoryId and OrganizationId as the principal
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:GetRun', 'omics:ListRuns', 'omics:CancelRun'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'aws:ResourceTag/LaboratoryId': '${aws:PrincipalTag/LaboratoryId}',
            'aws:ResourceTag/OrganizationId': '${aws:PrincipalTag/OrganizationId}',
          },
        },
      }),
      // Allow read-only workflow and share APIs without additional tag conditions
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:ListWorkflows', 'omics:GetWorkflow', 'omics:ListShares'],
        effect: Effect.ALLOW,
      }),
      // Allow passing the workflow run role to HealthOmics when starting a run
      new PolicyStatement({
        resources: [
          `arn:aws:iam::${this.props.env.account!}:role/${this.props.namePrefix}-easy-genomics-healthomics-workflow-run-role`,
        ],
        actions: ['iam:PassRole'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'omics.amazonaws.com',
          },
        },
      }),
    ]);
  };

  private setupPolicyDocuments() {
    // omics-service-role-policy-document
    this.iam.addPolicyDocument(
      'omics-service-role-policy-document',
      new PolicyDocument({
        statements: [
          // Omics Full Access Policy
          ...this.iam.getPolicyStatements('omics-full-access-policy-statement'),
          // Omics Logging Policies
          ...this.iam.getPolicyStatements('omics-log-policy-statement'),
          ...this.iam.getPolicyStatements('omics-log-stream-policy-statement'),
          // Omics ECR Policy for private/custom workflows
          ...this.iam.getPolicyStatements('omics-ecr-policy-statement'),
          // Omics S3 Policies
          ...this.iam.getPolicyStatements('omics-s3-bucket-policy-statement'),
          // Omics Pass Role
          ...this.iam.getPolicyStatements('iam-get-role-pass-role-policy-statement'),
        ],
      }),
    );

    // omics-access-role-policy-document
    this.iam.addPolicyDocument(
      'omics-access-role-policy-document',
      new PolicyDocument({
        statements: [...this.iam.getPolicyStatements('omics-access-role-permissions-policy-statement')],
      }),
    );
  }

  private setupRoles() {
    // easy-genomics-healthomics-workflow-run-role
    const role = new Role(this, `${this.props.namePrefix}-easy-genomics-healthomics-workflow-run-role`, {
      roleName: `${this.props.namePrefix}-easy-genomics-healthomics-workflow-run-role`,
      assumedBy: new ServicePrincipal('omics.amazonaws.com', {
        region: `${this.props.env.region!}`,
        conditions: {
          StringEquals: {
            'aws:SourceAccount': `${this.props.env.account!}`,
          },
          ArnLike: {
            'aws:SourceArn': `arn:aws:omics:${this.props.env.region}:${this.props.env.account!}:run/*`,
          },
        },
      }),
      description: 'Service Role that the Omics Service can use access resources from other services.',
    });

    // Create a Policy and attach it to the Role
    new Policy(this, `${this.props.namePrefix}-omics-service-role-policy`, {
      policyName: `${this.props.namePrefix}-omics-service-role-policy`,
      statements: this.iam
        .getPolicyDocument('omics-service-role-policy-document')
        .toJSON()
        .Statement.map((stmt: any) => PolicyStatement.fromJson(stmt)),
      roles: [role],
    });

    this.iam.addRole('easy-genomics-healthomics-workflow-run-role', role);

    // easy-genomics-omics-access-role
    // Role assumed by Easy Genomics Lambda functions (via STS) to call AWS HealthOmics
    // with lab-scoped access enforced by IAM conditions on principal and resource tags.
    const omicsAccessRole = new Role(this, `${this.props.namePrefix}-easy-genomics-omics-access-role`, {
      roleName: `${this.props.namePrefix}-easy-genomics-omics-access-role`,
      // Trust any IAM principal in this account; permissions policy still constrains what can be done.
      assumedBy: new ArnPrincipal(`arn:aws:iam::${this.props.env.account!}:root`),
      description:
        'Role assumed by Easy Genomics Lambdas to access AWS HealthOmics with laboratory-scoped IAM enforcement.',
    });

    // Allow sts:TagSession in the trust policy so Lambdas can pass session tags when assuming this role
    omicsAccessRole.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        principals: [new ArnPrincipal(`arn:aws:iam::${this.props.env.account!}:root`)],
        actions: ['sts:TagSession'],
        effect: Effect.ALLOW,
      }),
    );

    new Policy(this, `${this.props.namePrefix}-omics-access-role-policy`, {
      policyName: `${this.props.namePrefix}-omics-access-role-policy`,
      statements: this.iam
        .getPolicyDocument('omics-access-role-policy-document')
        .toJSON()
        .Statement.map((stmt: any) => PolicyStatement.fromJson(stmt)),
      roles: [omicsAccessRole],
    });

    this.iam.addRole('easy-genomics-omics-access-role', omicsAccessRole);
  }

  private setupLambdaPolicyStatements() {
    const laboratoryWorkflowAccessTableArn = `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-workflow-access-table`;
    const laboratoryWorkflowAccessTableAnyIndex = `${laboratoryWorkflowAccessTableArn}/index/*`;
    const workflowAccessQuery = () =>
      new PolicyStatement({
        resources: [laboratoryWorkflowAccessTableArn, laboratoryWorkflowAccessTableAnyIndex],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      });

    // /aws-healthomics/workflow/list-private-workflows
    this.iam.addPolicyStatements('/aws-healthomics/workflow/list-private-workflows', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      workflowAccessQuery(),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:ListWorkflows'],
        effect: Effect.ALLOW,
      }),
    ]);
    // /aws-healthomics/workflow/list-shared-workflows
    this.iam.addPolicyStatements('/aws-healthomics/workflow/list-shared-workflows', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      workflowAccessQuery(),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:/shares`],
        actions: ['omics:ListShares'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /aws-healthomics/workflow/read-private-workflow
    this.iam.addPolicyStatements('/aws-healthomics/workflow/read-private-workflow', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      workflowAccessQuery(),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:GetWorkflow'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /aws-healthomics/workflow/list-workflow-versions
    this.iam.addPolicyStatements('/aws-healthomics/workflow/list-workflow-versions', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      workflowAccessQuery(),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:ListWorkflowVersions'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /aws-healthomics/workflow/process-fetch-workflow-schema (EventBridge triggered)
    this.iam.addPolicyStatements('/aws-healthomics/workflow/process-fetch-workflow-schema', [
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:GetWorkflow'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [this.githubPatSecretArn],
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [this.workflowSchemaTableArn],
        actions: ['dynamodb:PutItem'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /aws-healthomics/workflow/read-workflow-schema (API Gateway GET)
    this.iam.addPolicyStatements('/aws-healthomics/workflow/read-workflow-schema', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:ListWorkflowVersions'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [this.workflowSchemaTableArn],
        actions: ['dynamodb:GetItem'],
        effect: Effect.ALLOW,
      }),
      // Permissions below are used by the GitHub fallback path only
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:GetWorkflow'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [this.githubPatSecretArn],
        actions: ['secretsmanager:GetSecretValue'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /aws-healthomics/run/list-runs
    this.iam.addPolicyStatements('/aws-healthomics/run/list-runs', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`],
        actions: ['omics:ListRuns'],
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
    // /aws-healthomics/run/read-run
    this.iam.addPolicyStatements('/aws-healthomics/run/read-run', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
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
    // /aws-healthomics/run/cancel-run-execution
    this.iam.addPolicyStatements('/aws-healthomics/run/cancel-run-execution', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`],
        actions: ['omics:CancelRun'],
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
    // /aws-healthomics/run/create-run-execution
    this.iam.addPolicyStatements('/aws-healthomics/run/create-run-execution', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
      workflowAccessQuery(),
      new PolicyStatement({
        resources: [
          `arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`,
          `arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`,
        ],
        actions: ['omics:StartRun', 'omics:TagResource'],
        effect: Effect.ALLOW,
      }),
      new PolicyStatement({
        resources: [
          `arn:aws:iam::${this.props.env.account!}:role/${this.props.namePrefix}-easy-genomics-healthomics-workflow-run-role`,
        ],
        actions: ['iam:PassRole'],
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
  }
}
