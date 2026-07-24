import { CfnOutput, Stack } from 'aws-cdk-lib';
import { AttributeType, StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { DataProvisioningNestedStack } from './data-provisioning-nested-stack';
import { EasyGenomicsNestedStack } from './easy-genomics-nested-stack';
import { baseLSIAttributes, DynamoConstruct } from '../constructs/dynamodb-construct';
import { SpecRestApiConstruct } from '../constructs/spec-rest-api-construct';
import {
  DataProvisioningNestedStackProps,
  EasyGenomicsApiStackProps,
  EasyGenomicsNestedStackProps,
} from '../types/back-end-stack';

/**
 * Dedicated top-level stack that owns the Easy Genomics REST API, the
 * nine easy-genomics DynamoDB tables, and all route registrations. It was
 * split out of `BackEndStack` because the Easy Genomics route set alone was
 * enough to push the shared back-end stack past the 500-resource
 * CloudFormation limit (see `split_easy_api_*.plan.md`).
 *
 * Contained nested stacks:
 *  - `EasyGenomicsNestedStack`: lambdas, SNS, SQS, SES, IAM. Receives the
 *    `dynamoDBTables` map from this stack as a prop; it does NOT create
 *    its own tables. See "Why tables live here" below.
 *  - `DataProvisioningNestedStack`: co-located here rather than in
 *    `BackEndStack` so it can keep using the in-process `Map<string, Table>`
 *    without creating a large number of CloudFormation exports.
 *
 * Why tables live in this top-level stack (not the nested stack):
 *  The CDK CLI's `cdk import` walks a SINGLE CloudFormation template per
 *  invocation — it does not recurse into nested stacks. If the eight
 *  easy-genomics tables were created inside `EasyGenomicsNestedStack`,
 *  `cdk import "${this.stackName}"` would never offer them as adoption
 *  candidates and the documented migration runbook
 *  (`docs/operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md`) would silently fail to adopt
 *  any tables. Hosting the tables at the parent stack scope keeps them in
 *  this top-level template where the importer can see them.
 *
 * IMPORTANT - migration from the pre-split stack layout:
 *  - For **fresh** deploys (brand-new environments with no existing tables),
 *    the refactor is safe: CDK creates this stack and its tables from
 *    scratch.
 *  - For **existing** deploys in ANY environment (dev, demo, pre-prod, prod),
 *    the nine easy-genomics DynamoDB tables carry real data AND are pinned
 *    to `RemovalPolicy.RETAIN` with deletion protection (see
 *    `dynamodb-construct.ts`). A naive `cdk deploy --all` will fail because
 *    the retained tables still hold the fixed physical names that the new
 *    stack wants to create. The supported migration path is documented in
 *    `docs/operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md` (retain → detach → `cdk import`).
 *    That runbook is intentionally environment-agnostic so the prod rollout
 *    is a rehearsed repeat of non-prod rollouts.
 */
export class EasyGenomicsApiStack extends Stack {
  readonly props: EasyGenomicsApiStackProps;
  readonly apiGateway: SpecRestApiConstruct;
  readonly dynamoDB: DynamoConstruct;
  readonly dynamoDBTables: Map<string, Table> = new Map();
  readonly easyGenomicsNestedStack: EasyGenomicsNestedStack;

  constructor(scope: Construct, id: string, props: EasyGenomicsApiStackProps) {
    // NOTE: Do not pass `env` to super here. `BackEndStack` uses the CDK
    // environment-agnostic default; passing a concrete env here would make the
    // two sibling top-level stacks deploy to "different" environments from
    // CDK's perspective and break cross-stack references to Cognito/VPC.
    super(scope, id);
    this.props = props;

    // DynamoDB tables are created at this top-level stack scope (not in the
    // nested stack) so that `cdk import` can adopt them during the documented
    // split-stack migration. See class-level JSDoc for the full rationale.
    this.dynamoDB = new DynamoConstruct(this, `${this.props.namePrefix}-easy-genomics-dynamodb`, {
      envType: this.props.envType,
    });
    this.setupDynamoDBTables();

    // The nested stack builds the Lambda functions and no longer registers HTTP
    // routes; the SpecRestApiConstruct below consumes its `lambdaFunctions` map.
    const easyGenomicsNestedStackProps: EasyGenomicsNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.namePrefix}-easy-genomics`,
      dynamoDBTables: this.dynamoDBTables,
    };
    this.easyGenomicsNestedStack = new EasyGenomicsNestedStack(
      this,
      `${this.props.envName}-easy-genomics-nested-stack`,
      easyGenomicsNestedStackProps,
    );

    // Dedicated API Gateway for the Easy Genomics domain, deployed directly from
    // easy-genomics-api.yaml via SpecRestApi. Keeping the API at this stack level
    // means its resources land in this template (not `BackEndStack`); reusing the
    // exact construct id the previous RestApi used preserves the REST API logical
    // id, so the deployed API physical id and invoke URL are unchanged on upgrade
    // (Easy Genomics runs in customer-owned accounts — a new URL would break them).
    this.apiGateway = new SpecRestApiConstruct(this, `${this.props.namePrefix}-easy-genomics-apigw`, {
      description: 'Easy Genomics API Gateway',
      lambdaFunctions: this.easyGenomicsNestedStack.lambda.lambdaFunctions,
      userPool: this.props.userPool,
      includePathPrefixes: ['/easy-genomics'],
    });

    const dataProvisioningNestedStackProps: DataProvisioningNestedStackProps = {
      ...this.props,
      constructNamespace: `${this.props.namePrefix}-data-provisioning`,
      userPool: this.props.userPool,
      userPoolSystemAdminGroupName: this.props.userPoolSystemAdminGroupName,
      dynamoDBTables: this.dynamoDBTables,
    };
    new DataProvisioningNestedStack(this, 'data-provisioning-nested-stack', dataProvisioningNestedStackProps);

    // Emit the Easy Genomics API URL. Kept as a distinct output so the
    // front-end `EASY_GENOMICS_API_URL` env var can resolve to this invoke URL
    // in non-prod, and a custom domain alias in prod (when configured).
    new CfnOutput(this, 'EasyGenomicsApiUrl', {
      key: 'EasyGenomicsApiUrl',
      value: this.apiGateway.restApi.url,
    });

    this.applyNagSuppressions();
  }

  /**
   * Nag suppressions relocated from `BackEndStack` so their hardcoded
   * construct paths resolve against this stack's tree after the split.
   * These paths are stack-relative: they start with this stack's name.
   */
  private applyNagSuppressions = () => {
    const stackPath = `/${this.stackName}`;
    const nestedId = `${this.props.envName}-easy-genomics-nested-stack`;
    const easyGenomicsId = `${this.props.namePrefix}-easy-genomics`;

    // NOTE: The previous per-method AwsSolutions-APIG4/COG4 suppressions for the
    // public routes (list-api-docs, confirm-user-invitation-request,
    // create/confirm-user-forgot-password-request) were removed. Under SpecRestApi
    // the individual `AWS::ApiGateway::Method` resources no longer exist as
    // CloudFormation resources, so those per-method rules no longer evaluate.
    // The public routes' unauthenticated status now lives in the spec
    // (`security: []`) and is guarded by openapi-guard.test.ts. If a CDK_AUDIT
    // run surfaces a RestApi-level APIG4/COG4 finding for the spec-defined
    // authorizer, add a single RestApi-scoped suppression here.

    // Lambda execution roles that require broader S3 access (signed URLs,
    // bucket listing, multi-object downloads, etc.).
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-file-download-url/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-list-bucket-objects/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-top-level-bucket-objects/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-laboratory-bucket-objects/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-search-bucket-objects/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-folder-download-job/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-request-folder-download-job-status/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-process-folder-download-job/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-update-laboratory/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-list-buckets/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-create-file-upload-request/ServiceRole/DefaultPolicy/Resource`,
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-create-file-upload-sample-sheet/ServiceRole/DefaultPolicy/Resource`,
      ],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Require access to S3',
        },
      ],
      true,
    );

    // Lab Runs processor needs access to read any omics run to fetch status.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      [
        `${stackPath}/${nestedId}/${easyGenomicsId}/${easyGenomicsId}-process-update-laboratory-run/ServiceRole/DefaultPolicy/Resource`,
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
  };

  // Easy Genomics specific DynamoDB tables.
  //
  // Hosted on this top-level stack (not the nested stack) so that
  // `cdk import "${this.stackName}"` can adopt them during the documented
  // split-stack migration. See the class-level JSDoc for the full rationale.
  // The resulting `Map<string, Table>` is passed as a prop into both
  // `EasyGenomicsNestedStack` and `DataProvisioningNestedStack` so all
  // downstream readers continue to see the same table set.
  private setupDynamoDBTables = () => {
    /** Update the definitions below to update / add additional DynamoDB tables **/
    // Organization table
    const organizationTableName = `${this.props.namePrefix}-organization-table`;
    const organizationTable = this.dynamoDB.createTable(organizationTableName, {
      partitionKey: {
        name: 'OrganizationId',
        type: AttributeType.STRING,
      },
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(organizationTableName, organizationTable);

    // Laboratory table
    const laboratoryTableName = `${this.props.namePrefix}-laboratory-table`;
    const laboratoryTable = this.dynamoDB.createTable(laboratoryTableName, {
      partitionKey: {
        name: 'OrganizationId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'LaboratoryId',
        type: AttributeType.STRING,
      },
      gsi: [
        {
          partitionKey: {
            name: 'LaboratoryId', // Global Secondary Index to support REST API get / update / delete requests
            type: AttributeType.STRING,
          },
        },
      ],
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(laboratoryTableName, laboratoryTable);

    // User table
    const userTableName = `${this.props.namePrefix}-user-table`;
    const userTable = this.dynamoDB.createTable(userTableName, {
      partitionKey: {
        name: 'UserId',
        type: AttributeType.STRING,
      },
      gsi: [
        {
          partitionKey: {
            name: 'Email', // Global Secondary Index to support lookup by Email requests
            type: AttributeType.STRING,
          },
        },
      ],
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(userTableName, userTable);

    // Organization User table
    const organizationUserTableName = `${this.props.namePrefix}-organization-user-table`;
    const organizationUserTable = this.dynamoDB.createTable(organizationUserTableName, {
      partitionKey: {
        name: 'OrganizationId', // UUID
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'UserId', // UUID
        type: AttributeType.STRING,
      },
      gsi: [
        {
          partitionKey: {
            name: 'UserId', // Global Secondary Index to support Organization lookup by UserId requests
            type: AttributeType.STRING,
          },
        },
      ],
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(organizationUserTableName, organizationUserTable);

    // Laboratory User table
    const laboratoryUserTableName = `${this.props.namePrefix}-laboratory-user-table`;
    const laboratoryUserTable = this.dynamoDB.createTable(laboratoryUserTableName, {
      partitionKey: {
        name: 'LaboratoryId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'UserId',
        type: AttributeType.STRING,
      },
      gsi: [
        {
          partitionKey: {
            name: 'UserId', // Global Secondary Index to support Laboratory lookup by UserId requests
            type: AttributeType.STRING,
          },
        },
        {
          partitionKey: {
            name: 'OrganizationId', // Global Secondary Index to support lookup by OrganizationId requests
            type: AttributeType.STRING,
          },
        },
      ],
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(laboratoryUserTableName, laboratoryUserTable);

    // Laboratory Run table
    const laboratoryRunTableName = `${this.props.namePrefix}-laboratory-run-table`;
    const laboratoryRunTable = this.dynamoDB.createTable(laboratoryRunTableName, {
      partitionKey: {
        name: 'LaboratoryId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'RunId',
        type: AttributeType.STRING,
      },
      timeToLiveAttribute: 'ExpiresAt',
      // OLD_IMAGE stream drives the laboratory-run REMOVE subscriber that keeps the data
      // tagging table's `LaboratoryRunUsages` map in sync when run rows disappear (via TTL
      // or manual delete). OLD_IMAGE is sufficient — the subscriber needs the row's
      // `InputFileKeys` from the deleted record, never the new image (none exists for
      // REMOVE events).
      stream: StreamViewType.OLD_IMAGE,
      gsi: [
        {
          partitionKey: {
            name: 'RunId', // Global Secondary Index to support Laboratory lookup by RunId requests
            type: AttributeType.STRING,
          },
        },
        {
          partitionKey: {
            name: 'UserId', // Global Secondary Index to support Laboratory lookup by UserId requests
            type: AttributeType.STRING,
          },
        },
        {
          partitionKey: {
            name: 'OrganizationId', // Global Secondary Index to support lookup by OrganizationId requests
            type: AttributeType.STRING,
          },
        },
        {
          partitionKey: {
            // Sparse GSI: only runs currently non-terminal carry this attribute, so the index
            // stays small regardless of total historical run volume. Backs the notification
            // poller's "every active run" query.
            name: 'PollStatus',
            type: AttributeType.STRING,
          },
        },
      ],
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(laboratoryRunTableName, laboratoryRunTable);

    // Unique-Reference table
    const uniqueReferenceTableName = `${this.props.namePrefix}-unique-reference-table`;
    const uniqueReferenceTable = this.dynamoDB.createTable(uniqueReferenceTableName, {
      partitionKey: {
        name: 'Value',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Type',
        type: AttributeType.STRING,
      },
    });
    this.dynamoDBTables.set(uniqueReferenceTableName, uniqueReferenceTable);

    // Laboratory workflow access allowlist (HealthOmics + Seqera)
    const laboratoryWorkflowAccessTableName = `${this.props.namePrefix}-laboratory-workflow-access-table`;
    const laboratoryWorkflowAccessTable = this.dynamoDB.createTable(laboratoryWorkflowAccessTableName, {
      partitionKey: {
        name: 'LaboratoryId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'WorkflowKey',
        type: AttributeType.STRING,
      },
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(laboratoryWorkflowAccessTableName, laboratoryWorkflowAccessTable);

    // Laboratory data tagging (user-defined tags on S3 objects within the lab prefix)
    const laboratoryDataTaggingTableName = `${this.props.namePrefix}-laboratory-data-tagging-table`;
    const laboratoryDataTaggingTable = this.dynamoDB.createTable(laboratoryDataTaggingTableName, {
      partitionKey: {
        name: 'LaboratoryId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Sk',
        type: AttributeType.STRING,
      },
      gsi: [
        {
          partitionKey: {
            name: 'Gsi1Pk',
            type: AttributeType.STRING,
          },
          sortKey: {
            name: 'Gsi1Sk',
            type: AttributeType.STRING,
          },
        },
      ],
      lsi: baseLSIAttributes,
    });
    this.dynamoDBTables.set(laboratoryDataTaggingTableName, laboratoryDataTaggingTable);
  };
}
