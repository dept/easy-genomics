import { CfnResource, RemovalPolicy } from 'aws-cdk-lib';
import { Attribute, AttributeType, BillingMode, SchemaOptions, Table } from 'aws-cdk-lib/aws-dynamodb';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export const baseLSIAttributes: Attribute[] = [
  {
    name: 'CreatedAt',
    type: AttributeType.STRING,
  },
  {
    name: 'CreatedBy',
    type: AttributeType.STRING,
  },
  {
    name: 'ModifiedAt',
    type: AttributeType.STRING,
  },
  {
    name: 'ModifiedBy',
    type: AttributeType.STRING,
  },
];

export type DynamoDBTableDetails = {
  partitionKey: Attribute;
  sortKey?: Attribute;
  gsi?: SchemaOptions[];
  lsi?: Attribute[];
  /**
   * DynamoDB TTL attribute name.
   * The attribute value must be a number representing epoch seconds.
   */
  timeToLiveAttribute?: string;
};

export interface DynamoConstructProps {
  envType: string;
}

export class DynamoConstruct extends Construct {
  readonly props: DynamoConstructProps;

  constructor(scope: Construct, id: string, props: DynamoConstructProps) {
    super(scope, id);
    this.props = props;
  }

  public createTable = (envTableName: string, settings: DynamoDBTableDetails) => {
    const partitionKey = { name: settings.partitionKey.name, type: settings.partitionKey.type };
    const sortKey = settings.sortKey ? { name: settings.sortKey.name, type: settings.sortKey.type } : undefined;

    // Data is explicitly retained in EVERY environment (not just prod).
    // Rationale:
    //   1. Generating real AWS HealthOmics workflow runs is expensive, and
    //      losing their metadata (LaboratoryRun rows, Seqera links, etc.)
    //      in dev/demo/staging costs real time and money to recreate.
    //   2. Keeping the policy uniform across envs means that any stack
    //      refactor (e.g. the easy-genomics → easy-genomics-api-stack split)
    //      can be rehearsed end-to-end in lower environments with the exact
    //      same retain + import mechanics that prod will use. If the
    //      migration is broken, we find out before we touch prod.
    //   3. PITR and deletion protection are cheap safety nets that are
    //      equally valuable in non-prod (accidental drop, runaway test).
    //
    // Trade-off: `cdk destroy` will orphan these tables. Fresh sandbox envs
    // need a manual cleanup step (see `docs/EASY_GENOMICS_PROD_MIGRATION.md`
    // "Cleanup / destroy" appendix).
    const removalPolicy = RemovalPolicy.RETAIN;

    const table = new Table(this, envTableName, {
      tableName: envTableName,
      partitionKey: partitionKey,
      sortKey: sortKey,
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: settings.timeToLiveAttribute,
      removalPolicy: removalPolicy,
      deletionProtection: true,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    // Belt-and-braces: explicitly pin both CloudFormation policies on the
    // underlying L1 resource. `RemovalPolicy.RETAIN` already sets these via
    // CDK, but overriding them here guarantees the synthesized template
    // still has them even if a future CDK upgrade changes how RemovalPolicy
    // is rendered. Mis-deploys (stack split, resource rename, etc.) will
    // orphan the physical table instead of deleting or replacing it.
    const cfnTable = table.node.defaultChild as CfnResource;
    cfnTable.applyRemovalPolicy(RemovalPolicy.RETAIN);
    cfnTable.addOverride('DeletionPolicy', 'Retain');
    cfnTable.addOverride('UpdateReplacePolicy', 'Retain');

    // Defense-in-depth: additionally arm deletion protection and PITR via
    // direct AWS SDK calls on every deploy (AwsCustomResource backed by a
    // Lambda). The CDK properties above already set both attributes, so for
    // tables CREATED by this stack this is redundant. Its real value is for
    // tables ADOPTED via `cdk import` (see
    // `docs/EASY_GENOMICS_PROD_MIGRATION.md` Phase 3), where CloudFormation
    // treats the import as a metadata-only operation and does NOT push the
    // `DeletionProtectionEnabled` / `PointInTimeRecoverySpecification`
    // properties onto the existing physical table. The SDK calls below
    // ensure the physical state matches the template intent immediately.
    //
    // Both operations are idempotent at the DynamoDB API level (setting a
    // value that's already set is a no-op). `onDelete` is intentionally
    // omitted so tearing down the stack does NOT un-arm protection; the
    // `Cleanup / destroy` appendix of the migration runbook documents how
    // to opt out when genuinely destroying a sandbox.
    const armDeletionProtection = new AwsCustomResource(this, `${envTableName}-arm-deletion-protection`, {
      onCreate: {
        service: 'DynamoDB',
        action: 'updateTable',
        parameters: {
          TableName: envTableName,
          DeletionProtectionEnabled: true,
        },
        physicalResourceId: PhysicalResourceId.of(`${envTableName}-arm-deletion-protection`),
      },
      onUpdate: {
        service: 'DynamoDB',
        action: 'updateTable',
        parameters: {
          TableName: envTableName,
          DeletionProtectionEnabled: true,
        },
        physicalResourceId: PhysicalResourceId.of(`${envTableName}-arm-deletion-protection`),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [table.tableArn],
      }),
      installLatestAwsSdk: false,
    });
    armDeletionProtection.node.addDependency(table);

    const armPitr = new AwsCustomResource(this, `${envTableName}-arm-pitr`, {
      onCreate: {
        service: 'DynamoDB',
        action: 'updateContinuousBackups',
        parameters: {
          TableName: envTableName,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        },
        physicalResourceId: PhysicalResourceId.of(`${envTableName}-arm-pitr`),
      },
      onUpdate: {
        service: 'DynamoDB',
        action: 'updateContinuousBackups',
        parameters: {
          TableName: envTableName,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        },
        physicalResourceId: PhysicalResourceId.of(`${envTableName}-arm-pitr`),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [table.tableArn],
      }),
      installLatestAwsSdk: false,
    });
    armPitr.node.addDependency(table);

    // Add Global Secondary Indexes if defined
    if (settings.gsi) {
      // NOTE: Global Secondary Indexes can be added / removed from the table as desired
      settings.gsi.forEach((value: SchemaOptions) => {
        table.addGlobalSecondaryIndex({
          indexName: `${value.partitionKey.name}_Index`,
          partitionKey: value.partitionKey,
          sortKey: value.sortKey, // Optional
        });
      });
    }

    // Add Local Secondary Indexes if table has an existing Sort Key
    if (sortKey && settings.lsi) {
      // NOTE: Local Secondary Indexes can only be defined at the initial table creation
      // and cannot be added / removed after the table has been created
      settings.lsi.forEach((value: Attribute) => {
        table.addLocalSecondaryIndex({
          indexName: `${value.name}_Index`,
          sortKey: value,
        });
      });
    }

    return table;
  };
}
