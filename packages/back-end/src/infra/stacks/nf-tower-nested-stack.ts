import { NestedStack } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { NFTowerNestedStackProps } from '../types/back-end-stack';

export class NFTowerNestedStack extends NestedStack {
  props: NFTowerNestedStackProps;
  iam: IamConstruct;
  lambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: NFTowerNestedStackProps) {
    super(scope, id);
    this.props = props;

    this.iam = new IamConstruct(this, `${this.props.constructNamespace}-iam`, {
      ...(<IamConstructProps>props), // Typecast to IamConstructProps
    });
    this.setupIamPolicies();

    this.lambda = new LambdaConstruct(this, `${this.props.constructNamespace}`, {
      ...this.props,
      iamPolicyStatements: this.iam.policyStatements, // Pass declared Auth IAM policies for attaching to respective Lambda function
      lambdaFunctionsDir: 'src/app/controllers/nf-tower',
      lambdaFunctionsNamespace: `${this.props.constructNamespace}`,
      lambdaFunctionsResources: {
        // Used for setting specific resources for a given Lambda function (e.g. environment settings, trigger events)
      },
      environment: {
        // Defines the common environment settings for all lambda functions
        ACCOUNT_ID: this.props.env.account!,
        REGION: this.props.env.region!,
        DOMAIN_NAME: this.props.appDomainName,
        ENV_TYPE: this.props.envType,
        NAME_PREFIX: this.props.namePrefix,
        SEQERA_API_BASE_URL: this.props.seqeraApiBaseUrl,
      },
    });

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

  // NF-Tower specific IAM policies
  private setupIamPolicies = () => {
    // Define common IAM policies for reuse
    this.iam.addPolicyStatements('laboratory-id-query-policy', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);
    this.iam.addPolicyStatements('laboratory-get-ssm-access-token-policy', [
      new PolicyStatement({
        resources: [
          `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/easy-genomics/organization/*/laboratory/*/nf-access-token`,
        ],
        actions: ['ssm:GetParameter'],
        effect: Effect.ALLOW,
      }),
    ]);

    this.iam.addPolicyStatements('laboratory-workflow-access-query-policy', [
      new PolicyStatement({
        resources: [
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-workflow-access-table`,
          `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-workflow-access-table/index/*`,
        ],
        actions: ['dynamodb:Query'],
        effect: Effect.ALLOW,
      }),
    ]);

    // /nf-tower/compute-env/list-compute-envs
    this.iam.addPolicyStatements('/nf-tower/compute-env/list-compute-envs', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
    // /nf-tower/compute-env/read-compute-env
    this.iam.addPolicyStatements('/nf-tower/compute-env/read-compute-env', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);

    // /nf-tower/pipeline/list-pipelines
    this.iam.addPolicyStatements('/nf-tower/pipeline/list-pipelines', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
      ...this.iam.getPolicyStatements('laboratory-workflow-access-query-policy'),
    ]);
    // /nf-tower/pipeline/read-pipeline
    this.iam.addPolicyStatements('/nf-tower/pipeline/read-pipeline', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
      ...this.iam.getPolicyStatements('laboratory-workflow-access-query-policy'),
    ]);
    // /nf-tower/pipeline/read-pipeline-launch-details
    this.iam.addPolicyStatements('/nf-tower/pipeline/read-pipeline-launch-details', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
      ...this.iam.getPolicyStatements('laboratory-workflow-access-query-policy'),
    ]);
    // /nf-tower/pipeline/read-pipeline-schema
    this.iam.addPolicyStatements('/nf-tower/pipeline/read-pipeline-schema', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
      ...this.iam.getPolicyStatements('laboratory-workflow-access-query-policy'),
    ]);

    // /nf-tower/workflow/cancel-workflow-execution
    this.iam.addPolicyStatements('/nf-tower/workflow/cancel-workflow-execution', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
    // /nf-tower/workflow/create-workflow-execution
    this.iam.addPolicyStatements('/nf-tower/workflow/create-workflow-execution', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
      ...this.iam.getPolicyStatements('laboratory-workflow-access-query-policy'),
    ]);
    // /nf-tower/workflow/list-workflows
    this.iam.addPolicyStatements('/nf-tower/workflow/list-workflows', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
    // /nf-tower/workflow/read-workflow
    this.iam.addPolicyStatements('/nf-tower/workflow/read-workflow', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
    // /nf-tower/workflow/read-workflow-metrics
    this.iam.addPolicyStatements('/nf-tower/workflow/read-workflow-metrics', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
    // /nf-tower/workflow/read-workflow-progress
    this.iam.addPolicyStatements('/nf-tower/workflow/read-workflow-progress', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
    // /nf-tower/workflow/read-workflow-reports
    this.iam.addPolicyStatements('/nf-tower/workflow/read-workflow-reports', [
      ...this.iam.getPolicyStatements('laboratory-id-query-policy'),
      ...this.iam.getPolicyStatements('laboratory-get-ssm-access-token-policy'),
    ]);
  };
}
