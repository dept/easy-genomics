import { CfnResource, RemovalPolicy } from 'aws-cdk-lib';
import { Attribute, AttributeType, BillingMode, SchemaOptions, Table } from 'aws-cdk-lib/aws-dynamodb';
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

    // Note: deletion protection and PITR are armed in two ways already:
    //   1. The `Table` props above render `DeletionProtectionEnabled: true`
    //      and `PointInTimeRecoverySpecification` directly into the CFN
    //      template, so tables CREATED by this stack are armed at create
    //      time.
    //   2. `packages/back-end/scripts/preflight-deletion-protection.ts`
    //      runs before every `cdk deploy` (wired into the projen
    //      `deploy` / `build-and-deploy` tasks). It calls
    //      `dynamodb:UpdateTable DeletionProtectionEnabled=true` and
    //      `dynamodb:UpdateContinuousBackups PointInTimeRecoveryEnabled=true`
    //      out-of-band on every easy-genomics table, including ones
    //      adopted via `cdk import` whose CloudFormation-managed metadata
    //      may not match physical state.
    //
    // We previously also added an in-stack `AwsCustomResource` per table
    // as defense-in-depth, but DynamoDB's `UpdateTable` response includes
    // the full TableDescription, which exceeds CloudFormation's 4096-byte
    // custom-resource response limit on tables with several GSIs. That
    // tripped a `Response object is too long` error and rolled back the
    // entire stack on first deploy. Removing it brings synth back under
    // the 500-resource ceiling we're trying to relieve in this PR and
    // hands sole responsibility for arming to the preflight script (which
    // has no such response-size limit).

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
