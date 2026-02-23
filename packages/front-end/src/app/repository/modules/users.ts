import {
  UpdateUserLastAccessedInfo,
  UpdateUserLastAccessedInfoSchema,
  UpdateUserSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user';
import {
  ConfirmUpdateUserInvitationRequestSchema,
  CreateUserInvitationRequestSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-invitation';
import {
  CreateUserForgotPasswordRequestSchema,
  ConfirmUserForgotPasswordRequestSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user-password';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import {
  ConfirmUserInvitationRequest,
  CreateUserInvitationRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-invitation';
import {
  ConfirmUserForgotPasswordRequest,
  CreateUserForgotPasswordRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-password';
import HttpFactory from '@FE/repository/factory';

class UsersModule extends HttpFactory {
  async list(): Promise<User | undefined> {
    const res = await this.call<User>('GET', '/user/list-users');

    if (!res) {
      throw new Error('Error listing users');
    }

    return res;
  }

  async invite(orgId: string, email: string): Promise<CreateUserInvitationRequest | undefined> {
    CreateUserInvitationRequestSchema.parse({
      OrganizationId: orgId,
      Email: email,
    });

    const res = await this.call<CreateUserInvitationRequest>('POST', '/user/create-user-invitation-request', {
      OrganizationId: orgId,
      Email: email,
    });

    if (!res) {
      throw new Error('Error with user invite');
    }

    return res;
  }

  async forgotPasswordRequest(email: string): Promise<CreateUserForgotPasswordRequest | undefined> {
    CreateUserForgotPasswordRequestSchema.parse({
      Email: email,
    });

    const res = await this.call<CreateUserForgotPasswordRequest>('POST', '/user/create-user-forgot-password-request', {
      Email: email,
    });

    if (!res) {
      throw new Error('Error with forgot password request');
    }

    return res;
  }

  async confirmForgotPasswordRequest(
    token: string,
    password: string,
  ): Promise<ConfirmUserForgotPasswordRequest | undefined> {
    ConfirmUserForgotPasswordRequestSchema.parse({
      Token: token,
      Password: password,
    });
    const res = await this.call<ConfirmUserForgotPasswordRequest>(
      'POST',
      '/user/confirm-user-forgot-password-request',
      {
        Token: token,
        Password: password,
      },
    );

    if (!res) {
      throw new Error('Error confirming forgot password request');
    }

    return res;
  }

  async confirmUserInviteRequest(
    token: string,
    firstName: string,
    lastName: string,
    password: string,
  ): Promise<ConfirmUserInvitationRequest> {
    const parseResult = ConfirmUpdateUserInvitationRequestSchema.safeParse({
      Token: token,
      Password: password,
      FirstName: firstName,
      LastName: lastName,
    });
    if (!parseResult.success) {
      console.error('Error; confirmUserInviteRequest; safe parse failed; parseResult: ', parseResult);
      throw new Error(
        `Error; confirmUserInviteRequest; safe parse failed; parseResult: ${JSON.stringify(parseResult, null, 2)}`,
      );
    }

    const res = await this.call<ConfirmUserInvitationRequest>('POST', '/user/confirm-user-invitation-request', {
      Token: token,
      Password: password,
      FirstName: firstName,
      LastName: lastName,
    });

    if (!res) {
      throw new Error('Error creating user account from invite');
    }

    return res;
  }

  async updateUser(
    userId: string,
    data: {
      FirstName?: string;
      PreferredName?: string;
      LastName?: string;
      SampleIdSplitPattern?: string;
    },
  ) {
    const parseResult = UpdateUserSchema.safeParse(data);
    if (!parseResult.success) {
      console.error('Error; updateUser; safe parse failed; parseResult: ', parseResult);
      throw new Error(`Error; updateUser; safe parse failed; parseResult: ${JSON.stringify(parseResult, null, 2)}`);
    }

    const res = await this.call<User>('PUT', `/user/update-user-request/${userId}`, data);

    if (!res) {
      throw new Error('Error updating user details');
    }

    return res;
  }

  async updateUserLastAccessInfo(userId: string, organizationId?: string, laboratoryId?: string) {
    const data: UpdateUserLastAccessedInfo = {
      OrganizationId: organizationId,
      LaboratoryId: laboratoryId,
    };
    const parseResult = UpdateUserLastAccessedInfoSchema.safeParse(data);
    if (!parseResult.success) {
      console.error('Error; updateUserLastAccessInfo; safe parse failed; parseResult: ', parseResult);
      throw new Error(
        `Error; updateUserLastAccessInfo; safe parse failed; parseResult: ${JSON.stringify(parseResult, null, 2)}`,
      );
    }

    const res = await this.call<{}>('PUT', `/user/update-user-last-accessed-info/${userId}`, data);
    if (!res) {
      throw new Error('Error updating user last accessed info');
    }

    return res;
  }
}

export default UsersModule;
