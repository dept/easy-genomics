import { marshall } from '@aws-sdk/util-dynamodb';
import { OrgUserStatus } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import {
  LaboratoryAccess,
  LaboratoryAccessDetails,
  OrganizationAccess,
  OrganizationAccessDetails,
  User,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { DynamoDBService } from '../dynamodb-service';

export class PlatformUserService extends DynamoDBService {
  readonly LABORATORY_USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-user-table`;
  readonly USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-user-table`;
  readonly UNIQUE_REFERENCE_TABLE_NAME: string = `${process.env.NAME_PREFIX}-unique-reference-table`;
  readonly ORGANIZATION_USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-organization-user-table`;

  public constructor() {
    super();
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - add a new User record and set their new Organization as their Default Organization
   *  - add an Unique-Reference record to reserve the new User's email as taken
   *  - add an Organization-User access mapping record for the new User to access the Organization
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid data inconsistency.
   *
   * @param newUser
   * @param organizationUser
   */
  async addNewUserToOrganization(newUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Add New User To Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    const user: User = {
      ...newUser,
      DefaultOrganization: organizationUser.OrganizationId,
      OrganizationAccess: {
        [organizationUser.OrganizationId]: {
          Status: organizationUser.Status,
          LaboratoryAccess: {},
          OrganizationAdmin: false,
        },
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
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
              Value: newUser.Email.toLowerCase(),
              Type: 'user-email',
            }),
          },
        },
        {
          Put: {
            TableName: this.ORGANIZATION_USER_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#OrganizationId) AND attribute_not_exists(#UserId)',
            ExpressionAttributeNames: {
              '#OrganizationId': 'OrganizationId',
              '#UserId': 'UserId',
            },
            Item: marshall(organizationUser),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to add OrganizationAccess meta-data simplify and improve data retrieval
   *  - add an Organization-User access mapping record for the existing User to access the Organization
   *  - set the DefaultOrganization if the current User's DefaultOrganization is not defined yet / empty
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param organizationUser
   */
  async addExistingUserToOrganization(existingUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Add Existing User To Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    const defaultOrganization: string | undefined =
      !existingUser.DefaultOrganization || existingUser.DefaultOrganization === ''
        ? organizationUser.OrganizationId
        : existingUser.DefaultOrganization;

    // Retrieve the User's OrganizationAccess metadata to update
    const user: User = {
      ...existingUser,
      DefaultOrganization: defaultOrganization,
      OrganizationAccess: <OrganizationAccess>{
        ...existingUser.OrganizationAccess,
        [organizationUser.OrganizationId]: <OrganizationAccessDetails>{
          Status: organizationUser.Status,
          OrganizationAdmin: organizationUser.OrganizationAdmin,
          LaboratoryAccess: <LaboratoryAccess>{},
        },
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
          },
        },
        {
          Put: {
            TableName: this.ORGANIZATION_USER_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#OrganizationId) AND attribute_not_exists(#UserId)',
            ExpressionAttributeNames: {
              '#OrganizationId': 'OrganizationId',
              '#UserId': 'UserId',
            },
            Item: marshall(organizationUser),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to remove the OrganizationAccess meta-data to remove the tracking for the Organization
   *  - remove the User's DefaultOrganization if it is the same Organization, and replace with the next available Organization
   *  - delete the Organization-User access mapping record for the existing User to remove access to the Organization
   *  - delete the existing Laboratory-User access mappings records associated with the removed Organization access
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param organizationUser
   */
  async removeExistingUserFromOrganization(existingUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Remove Existing User From Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    // Retrieve the User's OrganizationAccess metadata to update
    const organizationAccess: OrganizationAccess | undefined = existingUser.OrganizationAccess;
    // Retrieve the current Organization's OrganizationAccessDetails for use in the update
    const organizationAccessDetails: OrganizationAccessDetails | undefined =
      organizationAccess && organizationAccess[organizationUser.OrganizationId]
        ? organizationAccess[organizationUser.OrganizationId]
        : undefined;
    // Retrieve the current Organization's LaboratoryAccess details for use in the update
    const laboratoryAccess: LaboratoryAccess | undefined = organizationAccessDetails
      ? organizationAccessDetails.LaboratoryAccess
      : undefined;

    if (organizationAccess) {
      delete organizationAccess[organizationUser.OrganizationId];
    }

    // Replace User's existing DefaultOrganization if it is the same Organization access being removed
    const defaultOrganization: string | undefined =
      existingUser.DefaultOrganization === organizationUser.OrganizationId
        ? Object.keys(organizationAccess)
            .filter((organizationId) => organizationId !== organizationUser.OrganizationId)
            .shift()
        : existingUser.DefaultOrganization;

    const user = {
      ...existingUser,
      DefaultOrganization: defaultOrganization,
      OrganizationAccess: <OrganizationAccess>{
        ...organizationAccess,
      },
    };

    // Generate array of Delete transaction items to remove the User's associated LaboratoryUser mappings
    const laboratoryUserDeletions = laboratoryAccess
      ? Object.keys(laboratoryAccess).map((laboratoryId) => {
          return {
            Delete: {
              TableName: this.LABORATORY_USER_TABLE_NAME,
              Key: {
                LaboratoryId: { S: laboratoryId },
                UserId: { S: user.UserId },
              },
            },
          };
        })
      : [];

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user, { removeUndefinedValues: true }),
          },
        },
        {
          Delete: {
            TableName: this.ORGANIZATION_USER_TABLE_NAME,
            Key: {
              OrganizationId: { S: organizationUser.OrganizationId },
              UserId: { S: organizationUser.UserId },
            },
          },
        },
        ...laboratoryUserDeletions,
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to update the OrganizationAccess meta-data Status to 'Active' or 'Inactive'
   *  - update the Organization-User access mapping record Status to 'Active' or 'Inactive'
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param organizationUser
   */
  async editExistingUserAccessToOrganization(existingUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Edit Existing User To Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    // Retrieve the User's OrganizationAccess metadata to update
    const organizationAccess: OrganizationAccess | undefined = existingUser.OrganizationAccess;
    // Retrieve the current Organization's OrganizationAccessDetails for use in the update
    const organizationAccessDetails: OrganizationAccessDetails | undefined =
      organizationAccess && organizationAccess[organizationUser.OrganizationId]
        ? organizationAccess[organizationUser.OrganizationId]
        : undefined;

    const user: User = {
      ...existingUser,
      OrganizationAccess: <OrganizationAccess>{
        ...organizationAccess,
        [organizationUser.OrganizationId]: <OrganizationAccessDetails>{
          ...organizationAccessDetails,
          Status: organizationUser.Status,
          OrganizationAdmin: organizationUser.OrganizationAdmin,
        },
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
          },
        },
        {
          // Using PutItem request to update the existing OrganizationUser record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.ORGANIZATION_USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#OrganizationId) AND attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#OrganizationId': 'OrganizationId',
              '#UserId': 'UserId',
            },
            Item: marshall(organizationUser),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to update multiple OrganizationAccess meta-data Status to 'Active' or 'Inactive'
   *  - update the multiple Organization-User access mapping records Status to 'Active' or 'Inactive'
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param organizationUsers
   */
  async editExistingUserAccessToOrganizations(
    existingUser: User,
    organizationUsers: OrganizationUser[],
  ): Promise<Boolean> {
    const logRequestMessage = `Edit Existing User To Organization UserId=${existingUser.UserId} Organizations=[${organizationUsers.map((_: OrganizationUser) => _.OrganizationId).join(', ')}] request`;
    console.info(logRequestMessage);

    // Retrieve the User's OrganizationAccess metadata to update
    const existingUserOrganizationAccess: OrganizationAccess | undefined = existingUser.OrganizationAccess;
    const updatedUserOrganizationAccess: OrganizationAccess = existingUserOrganizationAccess
      ? this.updateUserOrganizationAccess(existingUserOrganizationAccess, organizationUsers)
      : {};

    const user: User = {
      ...existingUser,
      OrganizationAccess: {
        ...existingUserOrganizationAccess,
        ...updatedUserOrganizationAccess,
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
          },
        },
        // Perform all OrganizationUser updates in one transaction
        ...organizationUsers.map((orgUser: OrganizationUser) => {
          return {
            // Using PutItem request to update the existing OrganizationUser record for marshalling convenience instead of UpdateItem
            Put: {
              TableName: this.ORGANIZATION_USER_TABLE_NAME,
              ConditionExpression: 'attribute_exists(#OrganizationId) AND attribute_exists(#UserId)',
              ExpressionAttributeNames: {
                '#OrganizationId': 'OrganizationId',
                '#UserId': 'UserId',
              },
              Item: marshall(orgUser),
            },
          };
        }),
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * Private function to help generate updated User OrganizationAccess metadata for multiple Organization activations/deactivations.
   * @param existingUserOrganizationAccess
   * @param organizationUsers
   * @private
   */
  private updateUserOrganizationAccess(
    existingUserOrganizationAccess: OrganizationAccess,
    organizationUsers: OrganizationUser[],
  ): OrganizationAccess {
    // Identify list of OrganizationIds matching OrganizationUsers array to approve for updating
    const organizationIds: string[] = organizationUsers.map((ou: OrganizationUser) => ou.OrganizationId);

    // Return updated User OrganizationAccess metadata with approved OrganizationAccess activations/deactivations
    return <OrganizationAccess>Object.entries(existingUserOrganizationAccess)
      .filter((x: [string, OrganizationAccessDetails]) => organizationIds.includes(x[0]))
      .reduce((obj: OrganizationAccess, item: [string, OrganizationAccessDetails]) => {
        const orgId: string = item[0];
        const orgAccessDetails: OrganizationAccessDetails = item[1];

        const status: OrgUserStatus =
          organizationUsers.find((_: OrganizationUser) => _.OrganizationId === orgId)?.Status ||
          orgAccessDetails.Status;
        return (obj[orgId] = { ...orgAccessDetails, Status: status }), obj;
      }, {});
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to update the OrganizationAccess meta-data LaboratoryIds list by adding the LaboratoryId
   *  - add a Laboratory-User access mapping record for the existing User to access the Laboratory
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param laboratoryUser
   */
  async addExistingUserToLaboratory(existingUser: User, laboratoryUser: LaboratoryUser): Promise<Boolean> {
    const logRequestMessage = `Add Existing User To Laboratory UserId=${laboratoryUser.UserId} LaboratoryId=${laboratoryUser.LaboratoryId} request`;
    console.info(logRequestMessage);

    // Retrieve the User's OrganizationAccess metadata to update
    const organizationAccess: OrganizationAccess | undefined = existingUser.OrganizationAccess;
    // Retrieve the current Organization's OrganizationAccessDetails for use in the update
    const organizationAccessDetails: OrganizationAccessDetails | undefined =
      organizationAccess && organizationAccess[laboratoryUser.OrganizationId]
        ? organizationAccess[laboratoryUser.OrganizationId]
        : undefined;
    // Retrieve the current Organization's LaboratoryAccess details for use in the update
    const laboratoryAccess: LaboratoryAccess | undefined = organizationAccessDetails
      ? organizationAccessDetails.LaboratoryAccess
      : undefined;

    const user: User = {
      ...existingUser,
      OrganizationAccess: <OrganizationAccess>{
        ...organizationAccess,
        [laboratoryUser.OrganizationId]: <OrganizationAccessDetails>{
          ...organizationAccessDetails,
          LaboratoryAccess: <LaboratoryAccess>{
            ...laboratoryAccess,
            [laboratoryUser.LaboratoryId]: <LaboratoryAccessDetails>{
              Status: laboratoryUser.Status,
              LabManager: laboratoryUser.LabManager,
              LabTechnician: laboratoryUser.LabTechnician,
            },
          },
        },
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
          },
        },
        {
          Put: {
            TableName: this.LABORATORY_USER_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#LaboratoryId) AND attribute_not_exists(#UserId)',
            ExpressionAttributeNames: {
              '#LaboratoryId': 'LaboratoryId',
              '#UserId': 'UserId',
            },
            Item: marshall(laboratoryUser),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to update the OrganizationAccess meta-data LaboratoryIds list by removing the LaboratoryId
   *  - remove the Laboratory-User access mapping record for the existing User to remove access to the Laboratory
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param laboratoryUser
   */
  async removeExistingUserFromLaboratory(existingUser: User, laboratoryUser: LaboratoryUser): Promise<Boolean> {
    const logRequestMessage = `Remove Existing User From Laboratory UserId=${laboratoryUser.UserId} LaboratoryId=${laboratoryUser.LaboratoryId} request`;
    console.info(logRequestMessage);

    // Retrieve the User's OrganizationAccess metadata to update
    const organizationAccess: OrganizationAccess | undefined = existingUser.OrganizationAccess;
    // Retrieve the current Organization's OrganizationAccessDetails for use in the update
    const organizationAccessDetails: OrganizationAccessDetails | undefined =
      organizationAccess && organizationAccess[laboratoryUser.OrganizationId]
        ? organizationAccess[laboratoryUser.OrganizationId]
        : undefined;

    // Retrieve the current Organization's LaboratoryAccess details for use in the update
    const laboratoryAccess: LaboratoryAccess | undefined = organizationAccessDetails
      ? organizationAccessDetails.LaboratoryAccess
      : undefined;
    if (laboratoryAccess) {
      delete laboratoryAccess[laboratoryUser.LaboratoryId];
    }

    const user = {
      ...existingUser,
      OrganizationAccess: <OrganizationAccess>{
        ...organizationAccess,
        [laboratoryUser.OrganizationId]: <OrganizationAccessDetails>{
          ...organizationAccessDetails,
          LaboratoryAccess: <LaboratoryAccess>{
            ...laboratoryAccess,
          },
        },
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
          },
        },
        {
          Delete: {
            TableName: this.LABORATORY_USER_TABLE_NAME,
            Key: {
              LaboratoryId: { S: laboratoryUser.LaboratoryId },
              UserId: { S: laboratoryUser.UserId },
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
  }

  /**
   * This function creates a DynamoDB transaction to:
   *  - update the existing User to update the LaboratoryAccess meta-data Status to 'Active' or 'Inactive'
   *  - update the Laboratory-User access mapping record Status to 'Active' or 'Inactive'
   *
   * This function is dependent on the caller to supply the User's details updated OrganizationAccess details for
   * writing the User record.
   *
   * If any part of the transaction fails, the whole transaction will be rejected in order to avoid
   * data inconsistency.
   *
   * @param existingUser
   * @param LaboratoryUser
   */
  async editExistingUserAccessToLaboratory(existingUser: User, laboratoryUser: LaboratoryUser): Promise<Boolean> {
    const logRequestMessage = `Edit Existing User To Laboratory UserId=${laboratoryUser.UserId} OrganizationId=${laboratoryUser.LaboratoryId} request`;
    console.info(logRequestMessage);

    // Retrieve the User's OrganizationAccess metadata to update
    const organizationAccess: OrganizationAccess | undefined = existingUser.OrganizationAccess;

    // Find the Laboratory's parent Organization's OrganizationAccessDetails for use in the update
    const found: [string, OrganizationAccessDetails] | undefined = Object.entries(organizationAccess)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .filter(([orgId, orgAccessDetails]: [string, OrganizationAccessDetails]) => {
        return orgAccessDetails.LaboratoryAccess
          ? Object.keys(orgAccessDetails.LaboratoryAccess).includes(laboratoryUser.LaboratoryId)
          : false;
      })
      .shift();
    const [organizationId, organizationAccessDetails]: [string, OrganizationAccessDetails] = found ? found : undefined;

    // Retrieve the current Organization's LaboratoryAccess details for use in the update
    const laboratoryAccess: LaboratoryAccess | undefined = organizationAccessDetails
      ? organizationAccessDetails.LaboratoryAccess
      : undefined;

    const user: User = {
      ...existingUser,
      OrganizationAccess: <OrganizationAccess>{
        ...organizationAccess,
        [organizationId]: <OrganizationAccessDetails>{
          ...organizationAccessDetails,
          LaboratoryAccess: <LaboratoryAccess>{
            ...laboratoryAccess,
            [laboratoryUser.LaboratoryId]: <LaboratoryAccessDetails>{
              Status: laboratoryUser.Status,
              LabManager: laboratoryUser.LabManager,
              LabTechnician: laboratoryUser.LabTechnician,
            },
          },
        },
      },
    };

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          // Using PutItem request to update the existing User record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user),
          },
        },
        {
          // Using PutItem request to update the existing LaboratoryUser record for marshalling convenience instead of UpdateItem
          Put: {
            TableName: this.LABORATORY_USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#LaboratoryId) AND attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#LaboratoryId': 'LaboratoryId',
              '#UserId': 'UserId',
            },
            Item: marshall(laboratoryUser),
          },
        },
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }
}
