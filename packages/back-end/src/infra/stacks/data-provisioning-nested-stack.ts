import { marshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import {
  labManagerUser,
  labManagerUserLaboratoryMapping,
  labManagerUserOrganizationMapping,
  laboratory,
  labTechnicianUser,
  labTechnicianUserLaboratoryMapping,
  labTechnicianUserOrganizationMapping,
  orgAdminUser,
  orgAdminUserOrganizationMapping,
  organization,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sample-data';
import { UniqueReference } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/unique-reference';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { TestUserDetails } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { NestedStack, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { AwsCustomResource, AwsCustomResourcePolicy } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { CognitoUserConstruct } from '../constructs/cognito-user-construct';
import { S3Construct } from '../constructs/s3-construct';
import { DataProvisioningNestedStackProps } from '../types/back-end-stack';

export class DataProvisioningNestedStack extends NestedStack {
  private props: DataProvisioningNestedStackProps;
  private cognitoUserConstruct: CognitoUserConstruct;
  private s3Construct: S3Construct;
  private uniqueReferences: UniqueReference[] = [];

  constructor(scope: Construct, id: string, props: DataProvisioningNestedStackProps) {
    super(scope, id);
    this.props = props;

    // Setup Cognito User Construct
    this.cognitoUserConstruct = new CognitoUserConstruct(this, `${this.props.constructNamespace}-cognito-user`, {
      constructNamespace: this.props.constructNamespace,
      envType: this.props.envType,
      userPool: this.props.userPool,
    });
    // Setup S3 Construct
    this.s3Construct = new S3Construct(this, `${this.props.constructNamespace}-s3-bucket`, {});

    if (this.props.sysAdminEmail && this.props.sysAdminPassword) {
      try {
        // Add System Admin User Account
        this.cognitoUserConstruct.addUser(
          this.props.sysAdminEmail,
          this.props.sysAdminPassword,
          this.props.userPoolSystemAdminGroupName,
        );
      } catch (err: unknown) {
        console.error('Unable to create System Admin User Account: ', err);
      }
    }

    // Only seed platform data and provision default S3 Bucket for Laboratory uploads for Non-Prod deployments
    if (this.props.envType !== 'prod') {
      // Only for Non-Prod
      Tags.of(this.s3Construct).add('easy-genomics:s3-bucket-type', 'data');

      // S3 Bucket Names must be globally unique and less than 63 in length
      const s3BucketFullName = `${this.props.env.account!}-${this.props.namePrefix}-lab-bucket`;
      if (s3BucketFullName && s3BucketFullName.length > 63) {
        throw new Error(`S3 Bucket Name: "${s3BucketFullName}" is too long`);
      }
      this.s3Construct.createBucket(s3BucketFullName, this.props.envType);

      // Add seed data to DynamoDB Tables
      this.addDynamoDBSeedData<Organization>(
        organization.OrganizationId,
        `${this.props.namePrefix}-organization-table`,
        organization,
      );
      this.uniqueReferences.push({
        Value: organization.Name.toLowerCase(),
        Type: 'organization-name',
      });

      this.addDynamoDBSeedData<Laboratory>(laboratory.LaboratoryId, `${this.props.namePrefix}-laboratory-table`, {
        ...laboratory,
        S3Bucket: s3BucketFullName, // Save the shared S3 Bucket's Full Name in Laboratory DynamoDB record
      });
      this.uniqueReferences.push({
        Value: laboratory.Name.toLowerCase(),
        Type: `organization-${laboratory.OrganizationId}-laboratory-name`,
      });

      // Seed User accounts for development and testing
      const testUsers: TestUserDetails[] | undefined = this.props.testUsers;
      if (testUsers) {
        testUsers.forEach((testUser: TestUserDetails) => {
          // Add Test User to Cognito User Pool
          this.cognitoUserConstruct.addUser(testUser.UserEmail, testUser.UserPassword);

          // Add Test User's necessary User Record, OrganizationUser Mapping Record, LaboratoryUser Mapping Record
          switch (testUser.Access) {
            case 'OrganizationAdmin':
              this.addOrgAdmin(testUser);
              break;
            case 'LabManager':
              this.addLabManager(testUser);
              break;
            case 'LabTechnician':
              this.addLabTechnician(testUser);
              break;
          }

          // Add Test User's email to Unique References list to prevent duplicates
          this.uniqueReferences.push({
            Value: testUser.UserEmail.toLowerCase(),
            Type: 'user-email',
          });
        });

        // Bulk add unique references to UniqueReferences DynamoDB Table
        this.bulkAddDynamoDBSeedData<UniqueReference>(
          `${this.props.namePrefix}-unique-reference-table`,
          this.uniqueReferences,
        );
      }
    }
  }

  // Seeds Org Admin User for development and testing
  private addOrgAdmin(testUser: TestUserDetails) {
    this.addDynamoDBSeedData<User>(orgAdminUser.UserId, `${this.props.namePrefix}-user-table`, {
      ...orgAdminUser,
      Email: testUser.UserEmail,
    });
    // Add User mapping data to DynamoDB Tables
    this.addDynamoDBSeedData<OrganizationUser>(
      orgAdminUser.UserId,
      `${this.props.namePrefix}-organization-user-table`,
      orgAdminUserOrganizationMapping,
    );
  }

  // Seeded Lab Manager User for development and testing
  private addLabManager(testUser: TestUserDetails) {
    this.addDynamoDBSeedData<User>(labManagerUser.UserId, `${this.props.namePrefix}-user-table`, {
      ...labManagerUser,
      Email: testUser.UserEmail,
    });
    // Add User mapping data to DynamoDB Tables
    this.addDynamoDBSeedData<OrganizationUser>(
      labManagerUser.UserId,
      `${this.props.namePrefix}-organization-user-table`,
      labManagerUserOrganizationMapping,
    );
    this.addDynamoDBSeedData<LaboratoryUser>(
      labManagerUser.UserId,
      `${this.props.namePrefix}-laboratory-user-table`,
      labManagerUserLaboratoryMapping,
    );
  }

  // Seeded Lab Technician User for development and testing
  private addLabTechnician(testUser: TestUserDetails) {
    this.addDynamoDBSeedData<User>(labTechnicianUser.UserId, `${this.props.namePrefix}-user-table`, {
      ...labTechnicianUser,
      Email: testUser.UserEmail,
    });
    // Add User mapping data to DynamoDB Tables
    this.addDynamoDBSeedData<OrganizationUser>(
      labTechnicianUser.UserId,
      `${this.props.namePrefix}-organization-user-table`,
      labTechnicianUserOrganizationMapping,
    );
    this.addDynamoDBSeedData<LaboratoryUser>(
      labTechnicianUser.UserId,
      `${this.props.namePrefix}-laboratory-user-table`,
      labTechnicianUserLaboratoryMapping,
    );
  }

  private addDynamoDBSeedData<T>(recordId: string, tableName: string, testRecord: T) {
    const table: Table | undefined = this.props.dynamoDBTables.get(tableName);

    if (table) {
      new AwsCustomResource(this, `${tableName}-${recordId}_InitData`, {
        onCreate: {
          service: 'DynamoDB',
          action: 'putItem',
          parameters: {
            TableName: tableName,
            Item: marshall(testRecord),
          },
          physicalResourceId: {
            id: `${tableName}_InitData`,
          },
        },
        installLatestAwsSdk: false,
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [table.tableArn],
        }),
        removalPolicy: RemovalPolicy.DESTROY,
      });
    }
  }

  private bulkAddDynamoDBSeedData<T>(tableName: string, testRecords: T[]) {
    const table: Table | undefined = this.props.dynamoDBTables.get(tableName);

    if (table) {
      const batchItems = testRecords.map((testRecord) => {
        return { PutRequest: { Item: marshall(testRecord) } };
      });

      new AwsCustomResource(this, `${tableName}_InitData`, {
        onCreate: {
          service: 'DynamoDB',
          action: 'batchWriteItem',
          parameters: {
            RequestItems: {
              [tableName]: batchItems,
            },
          },
          physicalResourceId: {
            id: `${tableName}_InitData`,
          },
        },
        installLatestAwsSdk: false,
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: [table.tableArn],
        }),
        removalPolicy: RemovalPolicy.DESTROY,
      });
    }
  }
}
