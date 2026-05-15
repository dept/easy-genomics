import { UpdateOrganizationSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization';
import {
  EditOrganizationUserSchema,
  RemoveOrganizationUserSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization-user';
import { CreateOrganization, Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { OrganizationUserDetails } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user-details';
import HttpFactory from '@FE/repository/factory';
import { DeletedResponse } from '@FE/types/api';

class OrgsModule extends HttpFactory {
  async create(org: CreateOrganization): Promise<Organization | undefined> {
    const res = await this.call<Organization>('POST', '/organization/create-organization', org);

    if (!res) {
      throw new Error('Failed to create Organization');
    }

    return res;
  }

  async list(): Promise<Organization[]> {
    const res = await this.call<Organization[]>('GET', '/organization/list-organizations');

    if (!res) {
      throw new Error('Failed to retrieve list of Organizations');
    }

    return res;
  }

  async usersDetailsByOrgId(orgId: string): Promise<OrganizationUserDetails[]> {
    const res = await this.call<OrganizationUserDetails[]>(
      'GET',
      `/organization/user/list-organization-users-details?organizationId=${orgId}`,
    );

    if (!res) {
      throw new Error('Failed to retrieve Organization users details');
    }

    return res;
  }

  async usersDetailsByUserId(userId: string): Promise<OrganizationUserDetails[]> {
    const res = await this.call<OrganizationUserDetails[]>(
      'GET',
      `/organization/user/list-organization-users-details?userId=${userId}`,
    );

    if (!res) {
      throw new Error('Failed to retrieve Organization users details');
    }

    return res;
  }

  async orgSettings(orgId: string): Promise<Organization> {
    const res = await this.call<Organization>('GET', `/organization/read-organization/${orgId}`);

    if (!res) {
      throw new Error(`Failed to retrieve Organization ${orgId} settings`);
    }

    return res;
  }

  async editOrgUser(
    orgId: string,
    userId: string,
    orgUserStatus: string,
    val: boolean,
  ): Promise<OrganizationUserDetails | undefined> {
    const input = {
      OrganizationId: orgId,
      UserId: userId,
      Status: orgUserStatus,
      OrganizationAdmin: val,
    };

    try {
      await EditOrganizationUserSchema.parse(input);
    } catch (error) {
      throw new Error('Invalid request data. Please check your input and try again.');
    }

    const res = this.call<OrganizationUserDetails>('POST', '/organization/user/edit-organization-user', input);

    if (!res) {
      throw new Error("Failed to update user's Org Admin access");
    }

    return res;
  }

  async removeUser(orgId: string, userId: string): Promise<DeletedResponse> {
    const input = {
      OrganizationId: orgId,
      UserId: userId,
    };

    try {
      RemoveOrganizationUserSchema.parse(input);
    } catch (error) {
      throw new Error('Invalid request data. Please check your input and try again.');
    }

    const res = await this.call<DeletedResponse>('POST', '/organization/user/remove-organization-user', {
      OrganizationId: orgId,
      UserId: userId,
    });

    if (!res) {
      throw new Error('Failed to remove user from Organization');
    }

    return res;
  }

  async update(orgId: string, body: Partial<Organization>): Promise<Organization | undefined> {
    try {
      UpdateOrganizationSchema.parse(body);
    } catch (error) {
      throw new Error('Invalid request data. Please check your input and try again.');
    }
    const res = await this.call<Organization>('PUT', `/organization/update-organization/${orgId}`, body);

    if (!res) {
      throw new Error('Failed to update Organization details');
    }

    return res;
  }

  async remove(orgId: string): Promise<void> {
    const res = await this.call<void>('DELETE', `/organization/delete-organization/${orgId}`);

    if (!res) {
      throw new Error('Failed to delete Organization');
    }

    return res;
  }
}

export default OrgsModule;
