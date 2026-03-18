import { NestedStack } from 'aws-cdk-lib';
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
  Policy,
  ArnPrincipal,
} from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { AwsHealthOmicsNestedStackProps } from '../types/back-end-stack';

export class AwsHealthOmicsNestedStack extends NestedStack {
  readonly props: AwsHealthOmicsNestedStackProps;
  iam: IamConstruct;
  lambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: AwsHealthOmicsNestedStackProps) {
    super(scope, id);
    this.props = props;

    this.iam = new IamConstruct(this, `${this.props.constructNamespace}-iam`, {
      ...(<IamConstructProps>props), // Typecast to IamConstructProps
    });

    // The following setup order of IAM definitions is mandatory
    this.setupPolicyStatements();
    this.setupPolicyDocuments(); // Depends on policy statements
    this.setupRoles(); // Depends on policy documents
    this.setupLambdaPolicyStatements(); // Depends on policy documents / statements / roles

    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements, // Pass declared Auth IAM policies for attaching to respective Lambda function
      lambdaFunctionsDir: 'src/app/controllers/aws-healthomics',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {}, // Used for setting specific resources for a given Lambda function (e.g. environment settings, trigger events)
      environment: {
        // Defines the common environment settings for all lambda functions
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
      // Allow StartRun only when request tags match principal tags for lab and org
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:StartRun'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'aws:RequestTag/LaboratoryId': '${aws:PrincipalTag/LaboratoryId}',
            'aws:RequestTag/OrganizationId': '${aws:PrincipalTag/OrganizationId}',
          },
        },
      }),
      // Allow GetRun, ListRuns, and CancelRun only for Runs tagged with the same LaboratoryId as the principal
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:GetRun', 'omics:ListRuns', 'omics:CancelRun'],
        effect: Effect.ALLOW,
        conditions: {
          StringEquals: {
            'aws:ResourceTag/LaboratoryId': '${aws:PrincipalTag/LaboratoryId}',
          },
        },
      }),
      // Allow read-only workflow and share APIs without additional tag conditions
      new PolicyStatement({
        resources: ['*'],
        actions: ['omics:ListWorkflows', 'omics:GetWorkflow', 'omics:ListShares'],
        effect: Effect.ALLOW,
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
    // /aws-healthomics/workflow/list-private-workflows
    this.iam.addPolicyStatements('/aws-healthomics/workflow/list-private-workflows', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
      }),
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
      new PolicyStatement({
        resources: [`arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`],
        actions: ['omics:ListWorkflowVersions'],
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
        actions: ['sts:AssumeRole'],
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
        actions: ['sts:AssumeRole'],
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
        actions: ['sts:AssumeRole'],
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
      new PolicyStatement({
        resources: [
          `arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`,
          `arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:workflow/*`,
        ],
        actions: ['omics:StartRun'],
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
        actions: ['sts:AssumeRole'],
        effect: Effect.ALLOW,
      }),
    ]);
  }
}
