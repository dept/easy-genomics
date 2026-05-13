import { marshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { DynamoDBService } from '../dynamodb-service';
import { LaboratoryUserService } from './laboratory-user-service';
import { OrganizationUserService } from './organization-user-service';
import { toPersistedUser } from './user-service';

export class PlatformUserService extends DynamoDBService {
  readonly LABORATORY_USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-laboratory-user-table`;
  readonly USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-user-table`;
  readonly UNIQUE_REFERENCE_TABLE_NAME: string = `${process.env.NAME_PREFIX}-unique-reference-table`;
  readonly ORGANIZATION_USER_TABLE_NAME: string = `${process.env.NAME_PREFIX}-organization-user-table`;

  private readonly organizationUserService = new OrganizationUserService();
  private readonly laboratoryUserService = new LaboratoryUserService();

  public constructor() {
    super();
  }

  /**
   * Creates a new User, email reservation, and organization-user mapping. User items do not
   * store OrganizationAccess; membership is only in organization-user-table.
   */
  async addNewUserToOrganization(newUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Add New User To Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    const user = toPersistedUser({
      ...newUser,
      DefaultOrganization: organizationUser.OrganizationId,
    });

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_not_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user, { removeUndefinedValues: true }),
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
   * Adds an existing user to an organization. Updates user-table only when setting
   * DefaultOrganization for the first time; otherwise only writes organization-user-table.
   */
  async addExistingUserToOrganization(existingUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Add Existing User To Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    const shouldSetDefaultOrg = !existingUser.DefaultOrganization || existingUser.DefaultOrganization === '';
    const defaultOrganization: string | undefined = shouldSetDefaultOrg
      ? organizationUser.OrganizationId
      : existingUser.DefaultOrganization;

    const orgUserPut = {
      Put: {
        TableName: this.ORGANIZATION_USER_TABLE_NAME,
        ConditionExpression: 'attribute_not_exists(#OrganizationId) AND attribute_not_exists(#UserId)',
        ExpressionAttributeNames: {
          '#OrganizationId': 'OrganizationId',
          '#UserId': 'UserId',
        },
        Item: marshall(organizationUser),
      },
    };

    if (!shouldSetDefaultOrg) {
      const response = await this.transactWriteItems({
        TransactItems: [orgUserPut],
      });
      if (response.$metadata.httpStatusCode === 200) {
        return true;
      } else {
        throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
      }
    }

    const user = toPersistedUser({
      ...existingUser,
      DefaultOrganization: defaultOrganization,
    });

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user, { removeUndefinedValues: true }),
          },
        },
        orgUserPut,
      ],
    });

    if (response.$metadata.httpStatusCode === 200) {
      return true;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  async removeExistingUserFromOrganization(existingUser: User, organizationUser: OrganizationUser): Promise<Boolean> {
    const logRequestMessage = `Remove Existing User From Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    const organizationUsersBefore = await this.organizationUserService.queryByUserId(existingUser.UserId);
    const remainingOrgUsers = organizationUsersBefore.filter(
      (ou) => ou.OrganizationId !== organizationUser.OrganizationId,
    );

    const defaultOrganization =
      existingUser.DefaultOrganization === organizationUser.OrganizationId
        ? remainingOrgUsers[0]?.OrganizationId
        : existingUser.DefaultOrganization;

    const laboratoryUsersInOrg = (await this.laboratoryUserService.queryByUserId(existingUser.UserId)).filter(
      (lu) => lu.OrganizationId === organizationUser.OrganizationId,
    );

    const laboratoryUserDeletions = laboratoryUsersInOrg.map((lu) => {
      return {
        Delete: {
          TableName: this.LABORATORY_USER_TABLE_NAME,
          Key: {
            LaboratoryId: { S: lu.LaboratoryId },
            UserId: { S: lu.UserId },
          },
        },
      };
    });

    const userToWrite = toPersistedUser({
      ...existingUser,
      DefaultOrganization: defaultOrganization,
    });

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(userToWrite, { removeUndefinedValues: true }),
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

  async editExistingUserAccessToOrganization(
    _existingUser: User,
    organizationUser: OrganizationUser,
  ): Promise<Boolean> {
    const logRequestMessage = `Edit Existing User To Organization UserId=${organizationUser.UserId} OrganizationId=${organizationUser.OrganizationId} request`;
    console.info(logRequestMessage);

    const response = await this.transactWriteItems({
      TransactItems: [
        {
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

  async editExistingUserAccessToOrganizations(
    existingUser: User,
    organizationUsers: OrganizationUser[],
  ): Promise<Boolean> {
    const logRequestMessage = `Edit Existing User To Organization UserId=${existingUser.UserId} Organizations=[${organizationUsers.map((_: OrganizationUser) => _.OrganizationId).join(', ')}] request`;
    console.info(logRequestMessage);

    const user = toPersistedUser(existingUser);

    const response = await this.transactWriteItems({
      TransactItems: [
        {
          Put: {
            TableName: this.USER_TABLE_NAME,
            ConditionExpression: 'attribute_exists(#UserId)',
            ExpressionAttributeNames: {
              '#UserId': 'UserId',
            },
            Item: marshall(user, { removeUndefinedValues: true }),
          },
        },
        ...organizationUsers.map((orgUser: OrganizationUser) => {
          return {
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

  async addExistingUserToLaboratory(_existingUser: User, laboratoryUser: LaboratoryUser): Promise<Boolean> {
    const logRequestMessage = `Add Existing User To Laboratory UserId=${laboratoryUser.UserId} LaboratoryId=${laboratoryUser.LaboratoryId} request`;
    console.info(logRequestMessage);

    const response = await this.transactWriteItems({
      TransactItems: [
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

  async removeExistingUserFromLaboratory(_existingUser: User, laboratoryUser: LaboratoryUser): Promise<Boolean> {
    const logRequestMessage = `Remove Existing User From Laboratory UserId=${laboratoryUser.UserId} LaboratoryId=${laboratoryUser.LaboratoryId} request`;
    console.info(logRequestMessage);

    const response = await this.transactWriteItems({
      TransactItems: [
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

  async editExistingUserAccessToLaboratory(_existingUser: User, laboratoryUser: LaboratoryUser): Promise<Boolean> {
    const logRequestMessage = `Edit Existing User To Laboratory UserId=${laboratoryUser.UserId} LaboratoryId=${laboratoryUser.LaboratoryId} request`;
    console.info(logRequestMessage);

    const response = await this.transactWriteItems({
      TransactItems: [
        {
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
