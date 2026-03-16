import {
  GetItemCommandOutput,
  ScanCommandOutput,
  TransactWriteItemsCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { OrganizationSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

export class OrganizationService extends DynamoDBService implements Service {
  readonly ORGANIZATION_TABLE_NAME: string = `${process.env.NAME_PREFIX}-organization-table`;
  readonly UNIQUE_REFERENCE_TABLE_NAME: string = `${process.env.NAME_PREFIX}-unique-reference-table`;

  public constructor() {
    super();
  }

  public add = async (organization: Organization): Promise<Organization> => {
    const logRequestMessage = `Add Organization OrganizationId=${organization.OrganizationId}, Name=${organization.Name} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!OrganizationSchema.safeParse(organization).success) throw new Error('Invalid request');

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.ORGANIZATION_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#OrganizationId)',
            ExpressionAttributeNames: {
              '#OrganizationId': 'OrganizationId',
            },
            Item: marshall(organization),
          },
        },
        {
          Put: {
            TableName: this.UNIQUE_REFERENCE_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#Value) AND attribute_not_exists(#Type)',
            ExpressionAttributeNames: {
              '#Value': 'Value',
              '#Type': 'Type',
            },
            Item: marshall({
              Value: organization.Name.toLowerCase(),
              Type: 'organization-name',
            }),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return organization;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public get = async (organizationId: string): Promise<Organization> => {
    const logRequestMessage = `Get Organization OrganizationId=${organizationId} request`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.ORGANIZATION_TABLE_NAME,
      Key: {
        OrganizationId: { S: organizationId }, // Hash Key / Partition Key
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Item) {
        return <Organization>unmarshall(response.Item);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public list = async (): Promise<Organization[]> => {
    const logRequestMessage = 'List Organizations request';
    console.info(logRequestMessage);

    const response: ScanCommandOutput = await this.findAll({
      TableName: this.ORGANIZATION_TABLE_NAME,
    });

    if (response.$metadata.httpStatusCode === 200) {
      return <Organization[]>response.Items?.map((item) => unmarshall(item));
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public update = async (organization: Organization, existing: Organization): Promise<Organization> => {
    const logRequestMessage = `Update Organization OrganizationId=${organization.OrganizationId}, Name=${organization.Name} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!OrganizationSchema.safeParse(organization).success) throw new Error('Invalid request');

    const updateExclusions: string[] = ['OrganizationId', 'CreatedAt', 'CreatedBy'];

    const expressionAttributeNames: { [p: string]: string } = this.getExpressionAttributeNamesDefinition(
      organization,
      updateExclusions,
    );
    const expressionAttributeValues: { [p: string]: any } = this.getExpressionAttributeValuesDefinition(
      organization,
      updateExclusions,
    );
    const updateExpression: string = this.getUpdateExpression(expressionAttributeNames, expressionAttributeValues);

    // Check if Organization Name is unchanged
    if (organization.Name === existing.Name) {
      // Perform normal update request
      const response: UpdateItemCommandOutput = await this.updateItem({
        TableName: this.ORGANIZATION_TABLE_NAME,
        Key: {
          OrganizationId: { S: organization.OrganizationId },
        },
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        UpdateExpression: updateExpression,
        ReturnValues: 'ALL_NEW',
      });
      if (response.$metadata.httpStatusCode === 200) {
        if (response.Attributes) {
          return <Organization>unmarshall(response.Attributes);
        } else {
          throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected response`);
        }
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
      }
    } else {
      // Perform transaction update request to include updating the Organization Name and enforce uniqueness
      const response: TransactWriteItemsCommandOutput = await this.transactWriteItems({
        TransactItems: [
          {
            Update: {
              TableName: this.ORGANIZATION_TABLE_NAME,
              Key: {
                OrganizationId: { S: organization.OrganizationId },
              },
              ExpressionAttributeNames: expressionAttributeNames,
              ExpressionAttributeValues: expressionAttributeValues,
              UpdateExpression: updateExpression,
              ReturnValues: 'ALL_NEW',
            },
          },
          {
            Delete: {
              TableName: this.UNIQUE_REFERENCE_TABLE_NAME,
              Key: {
                Value: { S: existing.Name.toLowerCase() },
                Type: { S: 'organization-name' },
              },
            },
          },
          {
            Put: {
              TableName: this.UNIQUE_REFERENCE_TABLE_NAME,
              ConditionExpression: 'attribute_not_exists(#Value) AND attribute_not_exists(#Type)',
              ExpressionAttributeNames: {
                '#Value': 'Value',
                '#Type': 'Type',
              },
              Item: marshall({
                Value: organization.Name.toLowerCase(),
                Type: 'organization-name',
              }),
            },
          },
        ],
      });
      if (response.$metadata.httpStatusCode === 200) {
        // Transaction Updates do not return the updated Organization details, so explicitly retrieve it
        return this.get(organization.OrganizationId);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
      }
    }
  };

  public delete = async (organization: Organization): Promise<boolean> => {
    const logRequestMessage = `Delete Organization OrganizationId=${organization.OrganizationId}, Name=${organization.Name} request`;
    console.info(logRequestMessage);

    const response: TransactWriteItemsCommandOutput = await this.transactWriteItems({
      TransactItems: [
        {
          Delete: {
            TableName: this.ORGANIZATION_TABLE_NAME,
            Key: {
              OrganizationId: { S: organization.OrganizationId },
            },
          },
        },
        {
          Delete: {
            TableName: this.UNIQUE_REFERENCE_TABLE_NAME,
            Key: {
              Value: { S: organization.Name.toLowerCase() },
              Type: { S: 'organization-name' },
            },
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };
}
