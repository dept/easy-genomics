import {
  DeleteItemCommandOutput,
  GetItemCommandOutput,
  PutItemCommandOutput,
  QueryCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryUserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { LaboratoryUserNotFoundError } from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

export class LaboratoryUserService extends DynamoDBService implements Service {
  readonly LABORATORY_USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-user-table`;

  public constructor() {
    super();
  }

  public add = async (laboratoryUser: LaboratoryUser): Promise<LaboratoryUser> => {
    const logRequestMessage = `Add LaboratoryUser LaboratoryId=${laboratoryUser.LaboratoryId}, UserId=${laboratoryUser.UserId} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!LaboratoryUserSchema.safeParse(laboratoryUser).success) throw new Error('Invalid request');

    const response: PutItemCommandOutput = await this.putItem({
      TableName: this.LABORATORY_USER_TABLE_NAME,
      ConditionExpression: 'attribute_not_exists(#LaboratoryId) AND attribute_not_exists(#UserId)',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
        '#UserId': 'UserId',
      },
      Item: marshall(laboratoryUser),
    });

    if (response.$metadata.httpStatusCode === 200) {
      return laboratoryUser;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public get = async (laboratoryId: string, userId: string): Promise<LaboratoryUser> => {
    const logRequestMessage = `Get LaboratoryUser LaboratoryId=${laboratoryId}, UserId=${userId} request`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.LABORATORY_USER_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryId }, // Hash Key / Partition Key
        UserId: { S: userId }, // Sort Key
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Item) {
        return <LaboratoryUser>unmarshall(response.Item);
      } else {
        throw new LaboratoryUserNotFoundError(laboratoryId, userId);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByLaboratoryId = async (laboratoryId: string): Promise<LaboratoryUser[]> => {
    const logRequestMessage = `Query LaboratoryUsers by LaboratoryId=${laboratoryId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_USER_TABLE_NAME,
      KeyConditionExpression: '#LaboratoryId = :laboratoryId',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId', // Hash / Partition Key
      },
      ExpressionAttributeValues: {
        ':laboratoryId': { S: laboratoryId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        return response.Items.map((item) => <LaboratoryUser>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByUserId = async (userId: string): Promise<LaboratoryUser[]> => {
    const logRequestMessage = `Query LaboratoryUsers by UserId=${userId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_USER_TABLE_NAME,
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
        return response.Items.map((item) => <LaboratoryUser>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByOrganizationId = async (organizationId: string): Promise<LaboratoryUser[]> => {
    const logRequestMessage = `Query LaboratoryUsers by OrganizationId=${organizationId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_USER_TABLE_NAME,
      IndexName: 'OrganizationId_Index', // Global Secondary Index
      KeyConditionExpression: '#OrganizationId = :organizationId',
      ExpressionAttributeNames: {
        '#OrganizationId': 'OrganizationId',
      },
      ExpressionAttributeValues: {
        ':organizationId': { S: organizationId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        return response.Items.map((item) => <LaboratoryUser>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public update = async (laboratoryUser: LaboratoryUser): Promise<LaboratoryUser> => {
    const logRequestMessage = `Update LaboratoryUser LaboratoryId=${laboratoryUser.LaboratoryId}, UserId=${laboratoryUser.UserId} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!LaboratoryUserSchema.safeParse(laboratoryUser).success) throw new Error('Invalid request');

    const updateExclusions: string[] = ['LaboratoryId', 'UserId', 'CreatedAt', 'CreatedBy'];

    const expressionAttributeNames: { [p: string]: string } = this.getExpressionAttributeNamesDefinition(
      laboratoryUser,
      updateExclusions,
    );
    const expressionAttributeValues: { [p: string]: any } = this.getExpressionAttributeValuesDefinition(
      laboratoryUser,
      updateExclusions,
    );
    const updateExpression: string = this.getUpdateExpression(expressionAttributeNames, expressionAttributeValues);

    const response: UpdateItemCommandOutput = await this.updateItem({
      TableName: this.LABORATORY_USER_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryUser.LaboratoryId },
        UserId: { S: laboratoryUser.UserId },
      },
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      UpdateExpression: updateExpression,
      ReturnValues: 'ALL_NEW',
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Attributes) {
        return <LaboratoryUser>unmarshall(response.Attributes);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected response`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public delete = async (laboratoryUser: LaboratoryUser): Promise<boolean> => {
    const logRequestMessage = `Delete LaboratoryUser LaboratoryId=${laboratoryUser.LaboratoryId}, UserId=${laboratoryUser.UserId} request`;
    console.info(logRequestMessage);

    const response: DeleteItemCommandOutput = await this.deleteItem({
      TableName: this.LABORATORY_USER_TABLE_NAME,
      Key: {
        LaboratoryId: { S: laboratoryUser.LaboratoryId },
        UserId: { S: laboratoryUser.UserId },
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };
}
