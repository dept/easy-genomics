import {
  DeleteItemCommandOutput,
  GetItemCommandOutput,
  PutItemCommandOutput,
  QueryCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { OrganizationUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { OrganizationUserNotFoundError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

export class OrganizationUserService extends DynamoDBService implements Service {
  readonly ORGANIZATION_USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-organization-user-table`;

  public constructor() {
    super();
  }

  public add = async (organizationUser: OrganizationUser): Promise<OrganizationUser> => {
    const logRequestMessage = `Add OrganizationUser OrganizationId=${organizationUser.OrganizationId}, UserId=${organizationUser.UserId} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!OrganizationUserSchema.safeParse(organizationUser).success) throw new Error('Invalid request');

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.ORGANIZATION_USER_TABLE_NAME,
      ConditionExpression: 'attribute_not_exists(#OrganizationId) AND attribute_not_exists(#UserId)',
      ExpressionAttributeNames: {
        '#OrganizationId': 'OrganizationId',
        '#UserId': 'UserId',
      },
      Item: marshall(organizationUser),
    });

    if (response.$metadata.httpStatusCode === 200) {
      return organizationUser;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public get = async (organizationId: string, userId: string): Promise<OrganizationUser> => {
    const logRequestMessage = `Get OrganizationUser OrganizationId=${organizationId}, UserId=${userId} request`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.ORGANIZATION_USER_TABLE_NAME,
      Key: {
        OrganizationId: { S: organizationId }, // Hash Key / Partition Key
        UserId: { S: userId }, // Sort Key
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Item) {
        return <OrganizationUser>unmarshall(response.Item);
      } else {
        throw new OrganizationUserNotFoundError(organizationId, userId);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByOrganizationId = async (organizationId: string): Promise<OrganizationUser[]> => {
    const logRequestMessage = `Query OrganizationUsers by OrganizationId=${organizationId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.ORGANIZATION_USER_TABLE_NAME,
      KeyConditionExpression: '#OrganizationId = :organizationId',
      ExpressionAttributeNames: {
        '#OrganizationId': 'OrganizationId', // Hash / Partition Key
      },
      ExpressionAttributeValues: {
        ':organizationId': { S: organizationId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        return response.Items.map((item) => <OrganizationUser>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByUserId = async (userId: string): Promise<OrganizationUser[]> => {
    const logRequestMessage = `Query OrganizationUsers by UserId=${userId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.ORGANIZATION_USER_TABLE_NAME,
      IndexName: 'UserId_Index', // Global Secondary Index
      KeyConditionExpression: '#UserId = :userId',
      ExpressionAttributeNames: {
        '#UserId': 'UserId',
      },
      ExpressionAttributeValues: {
        ':userId': { S: userId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        return response.Items.map((item) => <OrganizationUser>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public update = async (organizationUser: OrganizationUser): Promise<OrganizationUser> => {
    const logRequestMessage = `Update OrganizationUser OrganizationId=${organizationUser.OrganizationId}, UserId=${organizationUser.UserId} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!OrganizationUserSchema.safeParse(organizationUser).success) throw new Error('Invalid request');

    const updateExclusions: string[] = ['OrganizationId', 'UserId', 'CreatedAt', 'CreatedBy'];

    const expressionAttributeNames: { [p: string]: string } = this.getExpressionAttributeNamesDefinition(
      organizationUser,
      updateExclusions,
    );
    const expressionAttributeValues: { [p: string]: any } = this.getExpressionAttributeValuesDefinition(
      organizationUser,
      updateExclusions,
    );
    const updateExpression: string = this.getUpdateExpression(expressionAttributeNames, expressionAttributeValues);

    const response: UpdateItemCommandOutput = await this.updateItem({
      TableName: this.ORGANIZATION_USER_TABLE_NAME,
      Key: {
        OrganizationId: { S: organizationUser.OrganizationId },
        UserId: { S: organizationUser.UserId },
      },
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues: 'ALL_NEW',
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Attributes) {
        return <OrganizationUser>unmarshall(response.Attributes);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected response`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public delete = async (organizationUser: OrganizationUser): Promise<boolean> => {
    const logRequestMessage = `Delete OrganizationUser OrganizationId=${organizationUser.OrganizationId}, UserId=${organizationUser.UserId} request`;
    console.info(logRequestMessage);

    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.ORGANIZATION_USER_TABLE_NAME,
      Key: {
        OrganizationId: { S: organizationUser.OrganizationId },
        UserId: { S: organizationUser.UserId },
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };
}
