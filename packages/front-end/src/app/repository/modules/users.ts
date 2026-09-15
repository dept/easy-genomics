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
import {
  ConfirmUserForgotPasswordRequest,
  ConfirmUserInvitationRequest,
  CreateUserForgotPasswordRequest,
  CreateUserInvitationRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import HttpFactory from '@FE/repository/factory';
import { decodeJwt } from '@FE/utils/jwt-utils';

class UsersModule extends HttpFactory {
  /**
   * update-user* Lambdas authorize path id against cognito:username.
   * currentUserDetails.id prefers DynamoDB UserId (for run ownership filters), which can
   * differ for seeded Cognito users — always resolve the Cognito username from the JWT here.
   */
  private async resolveSelfUpdatePathUserId(fallbackUserId?: string | null): Promise<string> {
    const { getToken } = useAuth();
    const token = await getToken();
    const decodedToken: Record<string, unknown> = decodeJwt(token);
    const cognitoUsername = decodedToken['cognito:username'];
    if (typeof cognitoUsername === 'string' && cognitoUsername !== '') {
      return cognitoUsername;
    }
    if (typeof fallbackUserId === 'string' && fallbackUserId !== '') {
      return fallbackUserId;
    }
    throw new Error('Unable to resolve Cognito username for user update');
  }

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
      OmicsWorkflowDefaultParams?: Record<string, Record<string, unknown>>;
      FavouriteWorkflows?: Array<{
        WorkflowId: string;
        WorkflowName: string;
        Description?: string;
        Platform: 'Seqera Cloud' | 'AWS HealthOmics';
        LaboratoryId: string;
      }>;
      AnalyticsConsent?: 'unset' | 'granted' | 'denied';
      NotifyOnOwnRuns?: boolean;
      NotificationEventFilter?: 'all_terminal' | 'failures_only' | 'successes_only';
    },
  ) {
    const parseResult = UpdateUserSchema.safeParse(data);
    if (!parseResult.success) {
      console.error('Error; updateUser; safe parse failed; parseResult: ', parseResult);
      throw new Error(`Error; updateUser; safe parse failed; parseResult: ${JSON.stringify(parseResult, null, 2)}`);
    }

    const pathUserId = await this.resolveSelfUpdatePathUserId(userId);
    const res = await this.call<User>('PUT', `/user/update-user-request/${pathUserId}`, data);

    if (!res) {
      throw new Error('Error updating user details');
    }

    return res;
  }

  async getUser(): Promise<User> {
    const res = await this.call<User>('GET', '/user/list-user-self');

    if (!res) {
      throw new Error('Error retrieving user details');
    }

    return res;
  }

  async updateUserLastAccessInfo(userId: string, organizationId?: string, laboratoryId?: string) {
    const data: UpdateUserLastAccessedInfo = {
      ...(organizationId != null && organizationId !== '' ? { OrganizationId: organizationId } : {}),
      ...(laboratoryId != null && laboratoryId !== '' ? { LaboratoryId: laboratoryId } : {}),
    };
    const parseResult = UpdateUserLastAccessedInfoSchema.safeParse(data);
    if (!parseResult.success) {
      console.error('Error; updateUserLastAccessInfo; safe parse failed; parseResult: ', parseResult);
      throw new Error(
        `Error; updateUserLastAccessInfo; safe parse failed; parseResult: ${JSON.stringify(parseResult, null, 2)}`,
      );
    }

    const pathUserId = await this.resolveSelfUpdatePathUserId(userId);
    const res = await this.call<{}>('PUT', `/user/update-user-last-accessed-info/${pathUserId}`, data);
    if (!res) {
      throw new Error('Error updating user last accessed info');
    }

    return res;
  }
}

export default UsersModule;
