import {
  AttributeValue,
  GetItemCommandOutput,
  QueryCommandOutput,
  ScanCommandOutput,
  TransactWriteItemsCommandOutput,
  UpdateItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { InvalidRequestError, LaboratoryNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { LaboratorySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
import { Laboratory, LaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { Service } from '../../types/service';
import { DynamoDBService } from '../dynamodb-service';

export class LaboratoryService extends DynamoDBService implements Service<Laboratory> {
  readonly LABORATORY_TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-table`;
  readonly UNIQUE_REFERENCE_TABLE_NAME: string = `${process.env.NAME_PREFIX}-unique-reference-table`;

  public constructor() {
    super();
  }

  public add = async (laboratory: Laboratory): Promise<Laboratory> => {
    const logRequestMessage = `Add Laboratory OrganizationId=${laboratory.OrganizationId}, LaboratoryId=${laboratory.LaboratoryId}, Name=${laboratory.Name} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!LaboratorySchema.safeParse(laboratory).success) throw new InvalidRequestError();

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.LABORATORY_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#OrganizationId) AND attribute_not_exists(#LaboratoryId)',
            ExpressionAttributeNames: {
              '#OrganizationId': 'OrganizationId',
              '#LaboratoryId': 'LaboratoryId',
            },
            Item: marshall(laboratory, { removeUndefinedValues: true }),
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
              Value: laboratory.Name.toLowerCase(),
              Type: `organization-${laboratory.OrganizationId}-laboratory-name`,
            }),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return laboratory;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public get = async (organizationId: string, laboratoryId: string): Promise<Laboratory> => {
    const logRequestMessage = `Get Laboratory OrganizationId=${organizationId}, LaboratoryId=${laboratoryId} request`;
    console.info(logRequestMessage);

    const response: GetItemCommandOutput = await this.getItem({
      TableName: this.LABORATORY_TABLE_NAME,
      Key: {
        OrganizationId: { S: organizationId }, // Hash Key / Partition Key
        LaboratoryId: { S: laboratoryId }, // Sort Key
      },
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Item) {
        return <Laboratory>unmarshall(response.Item);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public queryByLaboratoryId = async (laboratoryId: string): Promise<Laboratory> => {
    const logRequestMessage = `Query Laboratory by LaboratoryId=${laboratoryId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_TABLE_NAME,
      IndexName: 'LaboratoryId_Index', // Global Secondary Index
      KeyConditionExpression: '#LaboratoryId = :laboratoryId',
      ExpressionAttributeNames: {
        '#LaboratoryId': 'LaboratoryId',
      },
      ExpressionAttributeValues: {
        ':laboratoryId': { S: laboratoryId },
      },
      ScanIndexForward: false,
    });

    if (response.$metadata.httpStatusCode === 200) {
      if (response.Items) {
        if (response.Items.length === 1) {
          return <Laboratory>unmarshall(response.Items.shift()!);
        } else if (response.Items.length === 0) {
          throw new LaboratoryNotFoundError();
        } else {
          throw new Error(`${logRequestMessage} unsuccessful: Returned unexpected ${response.Items.length} items`);
        }
      } else {
        throw new LaboratoryNotFoundError();
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Scans the entire laboratory table and returns all laboratory records. Used by maintenance
   * lambdas/scripts (e.g. the scheduled S3 data-retention cleanup) that need to iterate every
   * lab without a per-organization fan-out. Not intended for hot read paths.
   */
  public listAllLaboratories = async (): Promise<Laboratory[]> => {
    const results: Laboratory[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const response: ScanCommandOutput = await this.findAll({
        TableName: this.LABORATORY_TABLE_NAME,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });
      for (const item of response.Items || []) {
        results.push(unmarshall(item) as Laboratory);
      }
      lastKey = response.LastEvaluatedKey as Record<string, any> | undefined;
    } while (lastKey);
    return results;
  };

  public queryByOrganizationId = async (organizationId: string): Promise<Laboratory[]> => {
    const logRequestMessage = `Query Laboratory by OrganizationId=${organizationId} request`;
    console.info(logRequestMessage);

    const response: QueryCommandOutput = await this.queryItems({
      TableName: this.LABORATORY_TABLE_NAME,
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
        return response.Items.map((item) => <Laboratory>unmarshall(item));
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: Resource not found`);
      }
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  /**
   * Updates the lab's attributes in place rather than replacing the item, and never writes RunLimits. Run limits are
   * saved only by updateRunLimits; a full-item put here would write back the RunLimits read at the start of this
   * request and undo a limits save made in the meantime.
   */
  public update = async (laboratory: Laboratory, existing: Laboratory): Promise<Laboratory> => {
    const logRequestMessage = `Update Laboratory OrganizationId=${laboratory.OrganizationId}, LaboratoryId=${laboratory.LaboratoryId}, Name=${laboratory.Name} request`;
    console.info(logRequestMessage);

    // Data validation safety check
    if (!LaboratorySchema.safeParse(laboratory).success) throw new InvalidRequestError();

    const laboratoryUpdate = {
      TableName: this.LABORATORY_TABLE_NAME,
      Key: marshall({ OrganizationId: laboratory.OrganizationId, LaboratoryId: laboratory.LaboratoryId }),
      ConditionExpression: 'attribute_exists(#OrganizationId) AND attribute_exists(#LaboratoryId)',
      ...buildLaboratoryUpdateExpression(laboratory, existing),
    };

    // Check if Laboratory Name is unchanged
    if (laboratory.Name === existing.Name) {
      // Perform normal update request
      const response: UpdateItemCommandOutput = await this.updateItem({ ...laboratoryUpdate, ReturnValues: 'ALL_NEW' });
      if (response.$metadata.httpStatusCode === 200 && response.Attributes) {
        return <Laboratory>unmarshall(response.Attributes);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
      }
    } else {
      // Perform transaction update request to include updating the Laboratory Name and enforce uniqueness
      const response: TransactWriteItemsCommandOutput = await this.transactWriteItems({
        TransactItems: [
          { Update: laboratoryUpdate },
          {
            Delete: {
              TableName: this.UNIQUE_REFERENCE_TABLE_NAME,
              Key: {
                Value: { S: existing.Name.toLowerCase() },
                Type: { S: `organization-${existing.OrganizationId}-laboratory-name` },
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
                Value: laboratory.Name.toLowerCase(),
                Type: `organization-${laboratory.OrganizationId}-laboratory-name`,
              }),
            },
          },
        ],
      });
      if (response.$metadata.httpStatusCode === 200) {
        // Transaction Updates do not return the updated Organization details, so explicitly retrieve it
        return this.queryByLaboratoryId(laboratory.LaboratoryId);
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
      }
    }
  };

  /**
   * Writes only the RunLimits attribute, so it never overwrites lab settings saved at the same time.
   * Clearing every limit removes the attribute, so the lab looks exactly like one that never had limits.
   */
  public updateRunLimits = async (
    laboratory: Laboratory,
    runLimits: LaboratoryRunLimits,
    modifiedBy: string,
  ): Promise<Laboratory> => {
    const logRequestMessage = `Update Laboratory Run Limits OrganizationId=${laboratory.OrganizationId}, LaboratoryId=${laboratory.LaboratoryId} request`;
    console.info(logRequestMessage);

    const marshalledRunLimits = marshall(runLimits, { removeUndefinedValues: true });
    const hasRunLimits = Object.keys(marshalledRunLimits).length > 0;
    const setModified = 'SET #ModifiedAt = :modifiedAt, #ModifiedBy = :modifiedBy';

    const response: UpdateItemCommandOutput = await this.updateItem({
      TableName: this.LABORATORY_TABLE_NAME,
      Key: marshall({ OrganizationId: laboratory.OrganizationId, LaboratoryId: laboratory.LaboratoryId }),
      ConditionExpression: 'attribute_exists(#OrganizationId) AND attribute_exists(#LaboratoryId)',
      UpdateExpression: hasRunLimits ? `${setModified}, #RunLimits = :runLimits` : `REMOVE #RunLimits ${setModified}`,
      ExpressionAttributeNames: {
        '#OrganizationId': 'OrganizationId',
        '#LaboratoryId': 'LaboratoryId',
        '#RunLimits': 'RunLimits',
        '#ModifiedAt': 'ModifiedAt',
        '#ModifiedBy': 'ModifiedBy',
      },
      ExpressionAttributeValues: {
        ...(hasRunLimits ? { ':runLimits': { M: marshalledRunLimits } } : {}),
        ':modifiedAt': { S: new Date().toISOString() },
        ':modifiedBy': { S: modifiedBy },
      },
      // The LaboratoryId index is eventually consistent, so reading the lab back through it could miss this write.
      ReturnValues: 'ALL_NEW',
    });

    if (response.$metadata.httpStatusCode === 200 && response.Attributes) {
      return <Laboratory>unmarshall(response.Attributes);
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  };

  public delete = async (laboratory: Laboratory): Promise<boolean> => {
    const logRequestMessage = `Delete Laboratory OrganizationId=${laboratory.OrganizationId}, LaboratoryId=${laboratory.LaboratoryId}, Name=${laboratory.Name} request`;
    console.info(logRequestMessage);

    const response: TransactWriteItemsCommandOutput = await this.transactWriteItems({
      TransactItems: [
        {
          Delete: {
            TableName: this.LABORATORY_TABLE_NAME,
            Key: {
              OrganizationId: { S: laboratory.OrganizationId },
              LaboratoryId: { S: laboratory.LaboratoryId },
            },
          },
        },
        {
          Delete: {
            TableName: this.UNIQUE_REFERENCE_TABLE_NAME,
            Key: {
              Value: { S: laboratory.Name.toLowerCase() },
              Type: { S: `organization-${laboratory.OrganizationId}-laboratory-name` },
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

const KEY_ATTRIBUTES = ['OrganizationId', 'LaboratoryId'];
// Attributes with a dedicated writer, which a general lab update must leave untouched.
const SEPARATELY_WRITTEN_ATTRIBUTES = ['RunLimits'];

/**
 * SETs every attribute `laboratory` has and REMOVEs the ones only `existing` has, matching what replacing the item
 * would store, apart from the key and separately written attributes.
 */
function buildLaboratoryUpdateExpression(laboratory: Laboratory, existing: Laboratory) {
  const skipped = [...KEY_ATTRIBUTES, ...SEPARATELY_WRITTEN_ATTRIBUTES];
  const values = marshall(laboratory, { removeUndefinedValues: true });
  const setNames = Object.keys(values).filter((name) => !skipped.includes(name));
  const removeNames = Object.keys(marshall(existing, { removeUndefinedValues: true })).filter(
    (name) => !skipped.includes(name) && !(name in values),
  );

  const expressionAttributeNames: Record<string, string> = {
    '#OrganizationId': 'OrganizationId',
    '#LaboratoryId': 'LaboratoryId',
  };
  const expressionAttributeValues: Record<string, AttributeValue> = {};
  const setClauses = setNames.map((name, index) => {
    expressionAttributeNames[`#set${index}`] = name;
    expressionAttributeValues[`:set${index}`] = values[name];
    return `#set${index} = :set${index}`;
  });
  const removeClauses = removeNames.map((name, index) => {
    expressionAttributeNames[`#remove${index}`] = name;
    return `#remove${index}`;
  });

  const updateExpression = [
    setClauses.length ? `SET ${setClauses.join(', ')}` : '',
    removeClauses.length ? `REMOVE ${removeClauses.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ...(setClauses.length ? { ExpressionAttributeValues: expressionAttributeValues } : {}),
  };
}
