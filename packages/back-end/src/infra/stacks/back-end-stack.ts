import { BackEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Key, KeySpec } from 'aws-cdk-lib/aws-kms';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { AuthNestedStack } from './auth-nested-stack';
import { AwsHealthOmicsNestedStack } from './aws-healthomics-nested-stack';
import { DataProvisioningNestedStack } from './data-provisioning-nested-stack';
import { EasyGenomicsNestedStack } from './easy-genomics-nested-stack';
import { NFTowerNestedStack } from './nf-tower-nested-stack';
import { ApiGatewayConstruct } from '../constructs/api-gateway-construct';
import { VpcConstruct, VpcConstructProps } from '../constructs/vpc-construct';
import {
  AuthNestedStackProps,
  AwsHealthOmicsNestedStackProps,
  DataProvisioningNestedStackProps,
  EasyGenomicsNestedStackProps,
  NFTowerNestedStackProps,
} from '../types/back-end-stack';

/**
 * This Back-End Stack serves as an orchestrator to provision required AWS
 * infrastructure and shares the resource references to satisfy the dependencies
 * of other AWS infrastructure.
 *
 * It will provision an API Gateway REST API instance which is then supplied to
 * will the Nested Stacks:
 *  - Auth
 *  - Easy Genomics
 *  - AWS HealthOmics
 *  - NF Tower
 *
 * Each Nested Stack is responsible for declaring its required IAM policies,
 * Lambda Functions, DynamoDB tables, etc. in order to make easier to maintain
 * and extend.
 */
export class BackEndStack extends Stack {
  readonly kmsKeys: Map<string, Key> = new Map();
  readonly props: BackEndStackProps;
  protected apiGateway!: ApiGatewayConstruct;
  protected vpcConstruct: VpcConstruct;

  constructor(scope: Construct, id: string, props: BackEndStackProps) {
    super(scope, id);
    this.props = props;

    // Create KMS symmetric encryption key for Cognito to generate secrets - temporary passwords, verification codes, confirmation codes
    this.kmsKeys.set(
      'cognito-idp-kms-key',
      new Key(this, `${this.props.constructNamespace}-cognito-idp-kms-key`, {
        alias: `${this.props.constructNamespace}-cognito-idp-kms-key`,
        keySpec: KeySpec.SYMMETRIC_DEFAULT,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    );

    // Setup VPC
    const vpcConstructProps: VpcConstructProps = {
      ...this.props,
    };
    this.vpcConstruct = new VpcConstruct(this, `${this.props.constructNamespace}-vpc`, vpcConstructProps);

    // API Gateway for REST APIs
    this.apiGateway = new ApiGatewayConstruct(this, `${this.props.constructNamespace}-apigw`, {
      description: 'Easy Genomics API Gateway',
    });

    // Initiate Nested Stacks for Auth, Easy Genomics, AWS HealthOmics, Nextflow Tower
    this.initiateNestedStacks();

    // Nag Suppressions
    // Note: these path based suppressions can only be applied after the path is created

    // User signup and password recovery endpoints endpoints
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.namePrefix}-easy-genomics-apigw/${this.props.namePrefix}-easy-genomics-apigw/Default/easy-genomics/user/confirm-user-invitation-request/POST/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.namePrefix}-easy-genomics-apigw/${this.props.namePrefix}-easy-genomics-apigw/Default/easy-genomics/user/create-user-forgot-password-request/POST/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.namePrefix}-easy-genomics-apigw/${this.props.namePrefix}-easy-genomics-apigw/Default/easy-genomics/user/confirm-user-forgot-password-request/POST/Resource`,
      ],
      [
        {
          id: 'AwsSolutions-APIG4',
          reason: 'These are used for user signup or password recovery and do not require an authorizer',
        },
      ],
      true,
    );

    // User signup and password recovery endpoints endpoints
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.namePrefix}-easy-genomics-apigw/${this.props.namePrefix}-easy-genomics-apigw/Default/easy-genomics/user/confirm-user-invitation-request/POST/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.namePrefix}-easy-genomics-apigw/${this.props.namePrefix}-easy-genomics-apigw/Default/easy-genomics/user/create-user-forgot-password-request/POST/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.namePrefix}-easy-genomics-apigw/${this.props.namePrefix}-easy-genomics-apigw/Default/easy-genomics/user/confirm-user-forgot-password-request/POST/Resource`,
      ],
      [
        {
          id: 'AwsSolutions-COG4',
          reason: 'These are used for user signup or password recovery and do not require an authorizer',
        },
      ],
      true,
    );

    // User signup and password recovery endpoints endpoints
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-request-file-download-url/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-request-list-bucket-objects/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-request-search-bucket-objects/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-update-laboratory/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-list-buckets/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-create-file-upload-request/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-create-file-upload-sample-sheet/ServiceRole/DefaultPolicy/Resource`,
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-aws-healthomics-nested-stack/${this.props.namePrefix}-easy-genomics-healthomics-workflow-run-role/Resource`,
      ],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Require access to S3',
        },
      ],
      true,
    );

    // Lab Runs processor needs access to read omics runs
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `/${this.props.namePrefix}-main-back-end-stack/${this.props.envName}-easy-genomics-nested-stack/${this.props.namePrefix}-easy-genomics/${this.props.namePrefix}-easy-genomics-process-update-laboratory-run/ServiceRole/DefaultPolicy/Resource`,
      ],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Needs access to all omics runs to fetch their current status',
          appliesTo: [`Resource::arn:aws:omics:${this.props.env.region!}:${this.props.env.account!}:run/*`],
        },
      ],
      true,
    );
  }

  private initiateNestedStacks = () => {
    const authNestedStackProps: AuthNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.constructNamespace}-auth`, // Overriding value
      cognitoIdpKmsKey: this.kmsKeys.get('cognito-idp-kms-key'),
    };
    const authNestedStack = new AuthNestedStack(this, `${this.props.envName}-auth-nested-stack`, authNestedStackProps);

    const easyGenomicsNestedStackProps: EasyGenomicsNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.namePrefix}-easy-genomics`, // Overriding value
      restApi: this.apiGateway.restApi,
      userPool: authNestedStack.cognito.userPool,
      userPoolClient: authNestedStack.cognito.userPoolClient,
      cognitoIdpKmsKey: this.kmsKeys.get('cognito-idp-kms-key'),
      vpc: this.vpcConstruct.vpc,
    };
    const easyGenomicsNestedStack = new EasyGenomicsNestedStack(
      this,
      `${this.props.envName}-easy-genomics-nested-stack`,
      easyGenomicsNestedStackProps,
    );

    const awsHealthOmicsNestedStackProps: AwsHealthOmicsNestedStackProps = {
      ...easyGenomicsNestedStackProps,
      constructNamespace: `${this.props.namePrefix}-aws-healthomics`, // Overriding value
      restApi: this.apiGateway.restApi,
    };

    new AwsHealthOmicsNestedStack(
      this,
      `${this.props.envName}-aws-healthomics-nested-stack`,
      awsHealthOmicsNestedStackProps,
    );

    const nfTowerNestedStackProps: NFTowerNestedStackProps = {
      ...easyGenomicsNestedStackProps,
      constructNamespace: `${this.props.namePrefix}-nf-tower`, // Overriding value
      restApi: this.apiGateway.restApi,
    };

    new NFTowerNestedStack(this, `${this.props.envName}-nf-tower-nested-stack`, nfTowerNestedStackProps);

    const dataProvisioningNestedStackProps: DataProvisioningNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.namePrefix}-data-provisioning`, // Overriding value
      userPool: authNestedStack.cognito.userPool,
      userPoolSystemAdminGroupName: authNestedStack.cognito.userPoolGroup.groupName,
      dynamoDBTables: easyGenomicsNestedStack.dynamoDBTables,
    };

    new DataProvisioningNestedStack(this, 'data-provisioning-nested-stack', dataProvisioningNestedStackProps);

    new CfnOutput(this, 'CognitoUserPoolId', {
      key: 'CognitoUserPoolId',
      value: authNestedStack.cognito.userPool.userPoolId,
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      key: 'CognitoUserPoolClientId',
      value: authNestedStack.cognito.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, 'ApiGatewayRestApiUrl', { key: 'ApiGatewayRestApiUrl', value: this.apiGateway.restApi.url });
  };
}
