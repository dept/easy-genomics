import { NestedStack } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IamConstruct, IamConstructProps } from '../constructs/iam-construct';
import { LambdaConstruct } from '../constructs/lambda-construct';
import { UsageNestedStackProps } from '../types/back-end-stack';

/**
 * Usage limits and run costs. Its handlers sit under `controllers/easy-genomics/usage`
 * and are served by the Easy Genomics API, but are built here so the route-heavy
 * EasyGenomicsNestedStack doesn't grow with this domain.
 */
export class UsageNestedStack extends NestedStack {
  props: UsageNestedStackProps;
  iam: IamConstruct;
  lambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: UsageNestedStackProps) {
    super(scope, id);
    this.props = props;

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
        '/easy-genomics/usage/process-refresh-healthomics-rates': {
          callbacks: [
            (lambdaFunction) => {
              new Rule(this, `${this.props.namePrefix}-healthomics-rates-refresh-schedule`, {
                ruleName: `${this.props.namePrefix}-healthomics-rates-refresh-schedule`,
                schedule: Schedule.expression('cron(0 6 ? * MON *)'),
                description: "Weekly refresh of this region's HealthOmics rates from AWS's public price list.",
                targets: [new LambdaFunction(lambdaFunction)],
              });
            },
          ],
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
    const healthOmicsRatesParameterArn = `arn:aws:ssm:${this.props.env.region!}:${this.props.env.account!}:parameter/${this.props.namePrefix}/healthomics-rates/current`;
    const laboratoryTableArn = `arn:aws:dynamodb:${this.props.env.region!}:${this.props.env.account!}:table/${this.props.namePrefix}-laboratory-table`;

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
    this.iam.addPolicyStatements('/easy-genomics/usage/process-refresh-healthomics-rates', [
      new PolicyStatement({
        resources: [healthOmicsRatesParameterArn],
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        effect: Effect.ALLOW,
      }),
    ]);
  };
}
