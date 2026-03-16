/**
 * This DynamoDB Services Class is designed to provide a reusable DynamoDB
 * client to support database access instead of creating a new DynamoDB client
 * for each request.
 *
 * This class is intended to be extended by specific management classes to
 * manage the respective DynamoDB objects in their respective tables.
 *
 * e.g.
 *   - organization-service
 *   - user-service
 *   - organization-user-service
 *   - organization-laboratory-service
 *   - laboratory-user-service
 *   - etc...
 */
import {
  BatchGetItemCommand,
  BatchGetItemCommandInput,
  BatchGetItemCommandOutput,
  DeleteItemCommand,
  DeleteItemCommandInput,
  DeleteItemCommandOutput,
  DynamoDBClient,
  DynamoDBServiceException,
  GetItemCommand,
  GetItemCommandInput,
  GetItemCommandOutput,
  PutItemCommand,
  PutItemCommandInput,
  PutItemCommandOutput,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommand,
  ScanCommandInput,
  ScanCommandOutput,
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
  TransactWriteItemsCommandOutput,
  UpdateItemCommand,
  UpdateItemCommandInput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

enum DynamoDBCommand {
  PUT_ITEM = 'put-item', // Create
  TRANSACT_WRITE = 'transact-write', // Create with Transaction
  SCAN_ITEMS = 'scan-items', // List
  BATCH_GET_ITEM = 'batch-get-item', // List
  GET_ITEM = 'get-item', // Read
  QUERY_ITEMS = 'query-items', // Query
  UPDATE_ITEM = 'update-item', // Update
  DELETE_ITEM = 'delete-item', // Delete
}

export class DynamoDBService {
  readonly dynamoDBDocClient;

  public constructor() {
    this.dynamoDBDocClient = DynamoDBDocumentClient.from(new DynamoDBClient());
  }

  protected putItem = async (putItemCommandInput: PutItemCommandInput): Promise<PutItemCommandOutput> => {
    return this.dynamoDBRequest<PutItemCommandInput, PutItemCommandOutput>(
      DynamoDBCommand.PUT_ITEM,
      putItemCommandInput,
    );
  };

  protected transactWriteItems = async (
    transactWriteItemsCommandInput: TransactWriteItemsCommandInput,
  ): Promise<TransactWriteItemsCommandOutput> => {
    return this.dynamoDBRequest<TransactWriteItemsCommandInput, TransactWriteItemsCommandOutput>(
      DynamoDBCommand.TRANSACT_WRITE,
      transactWriteItemsCommandInput,
    );
  };

  protected batchGetItem = async (
    batchGetItemCommandInput: BatchGetItemCommandInput,
  ): Promise<BatchGetItemCommandOutput> => {
    return this.dynamoDBRequest<BatchGetItemCommandInput, BatchGetItemCommandOutput>(
      DynamoDBCommand.BATCH_GET_ITEM,
      batchGetItemCommandInput,
    );
  };

  protected getItem = async (getItemCommandInput: GetItemCommandInput): Promise<GetItemCommandOutput> => {
    return this.dynamoDBRequest<GetItemCommandInput, GetItemCommandOutput>(
      DynamoDBCommand.GET_ITEM,
      getItemCommandInput,
    );
  };

  protected queryItems = async (queryCommandInput: QueryCommandInput): Promise<QueryCommandOutput> => {
    return this.dynamoDBRequest<QueryCommandInput, QueryCommandOutput>(DynamoDBCommand.QUERY_ITEMS, queryCommandInput);
  };

  protected findAll = async (scanCommandInput: ScanCommandInput): Promise<ScanCommandOutput> => {
    return this.dynamoDBRequest<ScanCommandInput, ScanCommandOutput>(DynamoDBCommand.SCAN_ITEMS, scanCommandInput);
  };

  protected updateItem = async (updateItemCommandInput: UpdateItemCommandInput): Promise<UpdateItemCommandOutput> => {
    return this.dynamoDBRequest<UpdateItemCommandInput, UpdateItemCommandOutput>(
      DynamoDBCommand.UPDATE_ITEM,
      updateItemCommandInput,
    );
  };

  protected deleteItem = async (deleteItemCommandInput: DeleteItemCommandInput): Promise<DeleteItemCommandOutput> => {
    return this.dynamoDBRequest<DeleteItemCommandInput, DeleteItemCommandOutput>(
      DynamoDBCommand.DELETE_ITEM,
      deleteItemCommandInput,
    );
  };

  private dynamoDBRequest = async <RequestType, ResponseType>(
    command: DynamoDBCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return (await this.dynamoDBDocClient.send(this.getDynamoDBCommand(command, data))) as ResponseType;
    } catch (error: any) {
      console.error(`[dynamodb-service : dynamoDBRequest] command: ${command} exception encountered:`, error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): DynamoDBServiceException => {
    return error as DynamoDBServiceException; // Base Exception
  };

  /**
   * Helper function returning the appropriate DynamoDB commands.
   *
   * @param command
   * @param data
   */
  private getDynamoDBCommand = <DynamoDBCommandInput>(command: DynamoDBCommand, data: DynamoDBCommandInput): any => {
    switch (command) {
      case DynamoDBCommand.PUT_ITEM:
        return new PutItemCommand(data);
      case DynamoDBCommand.TRANSACT_WRITE:
        return new TransactWriteItemsCommand(data);
      case DynamoDBCommand.SCAN_ITEMS:
        return new ScanCommand(data);
      case DynamoDBCommand.BATCH_GET_ITEM:
        return new BatchGetItemCommand(data);
      case DynamoDBCommand.GET_ITEM:
        return new GetItemCommand(data);
      case DynamoDBCommand.QUERY_ITEMS:
        return new QueryCommand(data);
      case DynamoDBCommand.UPDATE_ITEM:
        return new UpdateItemCommand(data);
      case DynamoDBCommand.DELETE_ITEM:
        return new DeleteItemCommand(data);
      default:
        throw new Error(`Unsupported DynamoDB Command '${command}'`);
    }
  };

  /**
   * Helper service function to assist the generation of the DynamoDB
   * ExpressionAttributeNames from an object's property names.
   * @param object
   */
  public getExpressionAttributeNamesDefinition = <T>(object: T, exclusions?: string[]): { [p: string]: string } => {
    const objectExpressionAttributeNames: { [p: string]: string }[] = Object.keys(object)
      .filter((key: string) => !exclusions?.includes(key))
      .map((key: string) => {
        return { [`#${key}`]: key };
      });
    // @ts-ignore
    return Object.assign({}, ...objectExpressionAttributeNames);
  };

  /**
   * Helper service function to assist the generation of the DynamoDB
   * ExpressionAttributeValues from an object's property values & types.
   *
   * The DynamoDB AttributeValue types supported attempts to cover the available
   * types from:
   *    https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_AttributeValue.html
   *
   * The following types are not currently supported: Binary, Binary Set, Null
   *
   * @param object
   */
  public getExpressionAttributeValuesDefinition = <T>(object: T, exclusions?: string[]): { [p: string]: any } => {
    const objectExpressionAttributeValues: { [p: string]: any }[] = Object.keys(object)
      .filter((key: string) => !exclusions?.includes(key))
      .map((key: string) => {
        const attributeId = `${key.charAt(0).toLowerCase() + key.slice(1)}`; // Camel Case
        const attributeValue = object[key];
        const attributeType = typeof attributeValue;

        if (attributeType === 'boolean') {
          return {
            [`:${attributeId}`]: { BOOL: attributeValue }, // Boolean
          };
        } else if (attributeType === 'number') {
          return {
            [`:${attributeId}`]: { N: attributeValue }, // Number
          };
        } else if (attributeType === 'string') {
          return {
            [`:${attributeId}`]: { S: attributeValue }, // String
          };
        } else if (attributeType === 'object') {
          if (Array.isArray(object[key])) {
            if (object[key].every((_) => typeof _ === 'number')) {
              return {
                [`:${attributeId}`]: { NS: attributeValue }, // Number Set
              };
            } else if (object[key].every((_) => typeof _ === 'string')) {
              return {
                [`:${attributeId}`]: { SS: attributeValue }, // String Set
              };
            } else {
              // Array of objects
              return {
                [`:${attributeId}`]: { L: attributeValue }, // List
              };
            }
          } else {
            return {
              [`:${attributeId}`]: { M: attributeValue }, // Map
            };
          }
        } else {
          throw new Error(`Attribute Type: ${attributeType} not supported`);
        }
      });
    // @ts-ignore
    return Object.assign({}, ...objectExpressionAttributeValues);
  };

  /**
   * Helper service function to assist the generation of the DynamoDB
   * UpdateExpression statement based off the ExpressionAttributeNames
   * and ExpressionAttributeValues.
   * @param attributeNames
   * @param attributeValues
   */
  public getUpdateExpression = <T>(attributeNames: T, attributeValues: T): string => {
    const attributeNameKeys = Object.keys(attributeNames);
    const attributeValueKeys = Object.keys(attributeValues);

    return (
      'SET ' +
      attributeNameKeys
        .map((value: string, index: number) => {
          return `${value} = ${attributeValueKeys[index]}`;
        })
        .join(', ')
    );
  };
}
