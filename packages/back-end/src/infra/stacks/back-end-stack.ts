import { BackEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Key, KeySpec } from 'aws-cdk-lib/aws-kms';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { AuthNestedStack } from './auth-nested-stack';
import { AwsHealthOmicsNestedStack } from './aws-healthomics-nested-stack';
import { NFTowerNestedStack } from './nf-tower-nested-stack';
import { ApiGatewayConstruct } from '../constructs/api-gateway-construct';
import { VpcConstruct, VpcConstructProps } from '../constructs/vpc-construct';
import { AuthNestedStackProps, AwsHealthOmicsNestedStackProps, NFTowerNestedStackProps } from '../types/back-end-stack';

/**
 * Orchestrator stack for shared platform infrastructure and the non-easy-genomics
 * domains (AWS HealthOmics and NF-Tower) that are small enough to stay on a
 * shared API Gateway.
 *
 * This stack provisions:
 *  - Shared KMS key used by Cognito.
 *  - Shared VPC + endpoints.
 *  - Shared API Gateway REST API used by AWS HealthOmics and NF-Tower.
 *  - Auth / AWS HealthOmics / NF-Tower nested stacks.
 *
 * The Easy Genomics domain has been moved out into its own top-level
 * `EasyGenomicsApiStack` to keep this stack comfortably below the
 * 500-resource CloudFormation limit. Cognito, VPC and the KMS key are exposed
 * as public members so `main.ts` can pass them to the easy-genomics stack
 * as cross-stack references.
 */
export class BackEndStack extends Stack {
  readonly kmsKeys: Map<string, Key> = new Map();
  readonly props: BackEndStackProps;
  protected apiGateway!: ApiGatewayConstruct;
  protected vpcConstruct: VpcConstruct;

  // Public surface exposed to other top-level stacks (currently EasyGenomicsApiStack).
  // Kept narrow on purpose — only share what the consuming stack actually needs,
  // so we avoid sprawling CloudFormation Export / Fn::ImportValue pairs.
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly userPoolSystemAdminGroupName: string | undefined;
  public readonly vpc: IVpc;
  public readonly cognitoIdpKmsKey: Key;
  // Exposed so a sibling `ApiDomainStack` can attach base-path mappings to the
  // AWS HealthOmics + NF-Tower REST API without taking over ownership.
  public readonly apiGatewayRestApi: RestApi;

  constructor(scope: Construct, id: string, props: BackEndStackProps) {
    super(scope, id);
    this.props = props;

    const cognitoIdpKmsKey = new Key(this, `${this.props.constructNamespace}-cognito-idp-kms-key`, {
      alias: `${this.props.constructNamespace}-cognito-idp-kms-key`,
      keySpec: KeySpec.SYMMETRIC_DEFAULT,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.kmsKeys.set('cognito-idp-kms-key', cognitoIdpKmsKey);
    this.cognitoIdpKmsKey = cognitoIdpKmsKey;

    const vpcConstructProps: VpcConstructProps = {
      ...this.props,
    };
    this.vpcConstruct = new VpcConstruct(this, `${this.props.constructNamespace}-vpc`, vpcConstructProps);
    this.vpc = this.vpcConstruct.vpc;

    // Shared API Gateway for the remaining (smaller) back-end domains.
    // Easy Genomics has its own API Gateway in EasyGenomicsApiStack.
    this.apiGateway = new ApiGatewayConstruct(this, `${this.props.constructNamespace}-apigw`, {
      description: 'Easy Genomics Platform API Gateway (AWS HealthOmics + NF-Tower)',
    });
    this.apiGatewayRestApi = this.apiGateway.restApi;

    // Auth nested stack owns Cognito and must be built before any stack that
    // needs the user pool (including EasyGenomicsApiStack).
    const authNestedStackProps: AuthNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.constructNamespace}-auth`,
      cognitoIdpKmsKey: cognitoIdpKmsKey,
    };
    const authNestedStack = new AuthNestedStack(this, `${this.props.envName}-auth-nested-stack`, authNestedStackProps);

    this.userPool = authNestedStack.cognito.userPool;
    this.userPoolClient = authNestedStack.cognito.userPoolClient;
    this.userPoolSystemAdminGroupName = authNestedStack.cognito.userPoolGroup.groupName;

    const awsHealthOmicsNestedStackProps: AwsHealthOmicsNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.namePrefix}-aws-healthomics`,
      restApi: this.apiGateway.restApi,
      userPool: authNestedStack.cognito.userPool,
      userPoolClient: authNestedStack.cognito.userPoolClient,
      vpc: this.vpcConstruct.vpc,
    };
    new AwsHealthOmicsNestedStack(
      this,
      `${this.props.envName}-aws-healthomics-nested-stack`,
      awsHealthOmicsNestedStackProps,
    );

    const nfTowerNestedStackProps: NFTowerNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.namePrefix}-nf-tower`,
      restApi: this.apiGateway.restApi,
      userPool: authNestedStack.cognito.userPool,
      userPoolClient: authNestedStack.cognito.userPoolClient,
      vpc: this.vpcConstruct.vpc,
    };
    new NFTowerNestedStack(this, `${this.props.envName}-nf-tower-nested-stack`, nfTowerNestedStackProps);

    new CfnOutput(this, 'CognitoUserPoolId', {
      key: 'CognitoUserPoolId',
      value: authNestedStack.cognito.userPool.userPoolId,
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      key: 'CognitoUserPoolClientId',
      value: authNestedStack.cognito.userPoolClient.userPoolClientId,
    });

    // Shared platform API URL (AWS HealthOmics + NF-Tower). Retains the
    // historical output name to avoid breaking CI/deploy scripts that read
    // `ApiGatewayRestApiUrl`. In prod, this URL can sit behind the same
    // custom domain as the Easy Genomics API (base-path-mapped).
    new CfnOutput(this, 'ApiGatewayRestApiUrl', {
      key: 'ApiGatewayRestApiUrl',
      value: this.apiGateway.restApi.url,
    });

    this.applyNagSuppressions();
  }

  /**
   * Nag suppressions for resources that remain in this stack after the split.
   * Suppressions for easy-genomics resources have moved to EasyGenomicsApiStack.
   */
  private applyNagSuppressions = () => {
    const stackPath = `/${this.stackName}`;
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `${stackPath}/${this.props.envName}-aws-healthomics-nested-stack/${this.props.namePrefix}-easy-genomics-healthomics-workflow-run-role/Resource`,
      ],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Require access to S3',
        },
      ],
      true,
    );
  };
}
