import {
  AdminCreateUserCommand,
  AdminCreateUserCommandInput,
  AdminCreateUserCommandOutput,
  AdminEnableUserCommand,
  AdminEnableUserCommandInput,
  AdminEnableUserCommandOutput,
  AdminGetUserCommand,
  AdminGetUserCommandInput,
  AdminGetUserCommandOutput,
  AdminSetUserPasswordCommand,
  AdminSetUserPasswordCommandInput,
  AdminSetUserPasswordCommandOutput,
  AdminUpdateUserAttributesCommand,
  AdminUpdateUserAttributesCommandInput,
  AdminUpdateUserAttributesCommandOutput,
  CognitoIdentityProviderClient,
  CognitoIdentityProviderServiceException,
  ConfirmForgotPasswordCommand,
  ConfirmForgotPasswordCommandInput,
  ConfirmForgotPasswordCommandOutput,
  ForgotPasswordCommand,
  ForgotPasswordCommandInput,
  ForgotPasswordCommandOutput,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
  InitiateAuthCommandOutput,
  RespondToAuthChallengeCommand,
  RespondToAuthChallengeCommandInput,
  RespondToAuthChallengeCommandOutput,
  UserNotFoundException,
  DeleteUserCommand,
  DeleteUserCommandInput,
  DeleteUserCommandOutput,
  AdminDeleteUserCommandOutput,
  AdminDeleteUserCommandInput,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export enum CognitoIdpCommand {
  ADMIN_CREATE_USER = 'admin-create-user',
  ADMIN_ENABLE_USER = 'admin-enable-user',
  ADMIN_GET_USER = 'admin-get-user',
  ADMIN_SET_USER_PASSWORD = 'admin-set-user-password',
  ADMIN_UPDATE_USER_ATTRIBUTES = 'admin-update-user-attributes',
  ADMIN_DELETE_USER = 'admin-delete-user',
  CONFIRM_FORGOT_PASSWORD = 'confirm-forgot-password',
  FORGOT_PASSWORD = 'forgot-password',
  INITIATE_AUTH = 'initiate-auth',
  RESPOND_TO_AUTH_CHALLENGE = 'respond-to-auth-challenge',
  DELETE_USER = 'delete-user',
}

export interface CognitoIdpServiceProps {
  userPoolId: string;
}

export class CognitoIdpService {
  private readonly props: CognitoIdpServiceProps;
  private readonly cognitoIdpClient;

  public constructor(props: CognitoIdpServiceProps) {
    this.props = props;
    this.cognitoIdpClient = new CognitoIdentityProviderClient();
  }

  /**
   * This function invites new User to the Platform by creating a new Cognito
   * User account / resending invite, and returns the Cognito Username.
   * @param email
   * @param organizationId
   * @param organizationName
   * @param resend
   */
  async adminCreateUser(
    email: string,
    organizationId: string,
    organizationName: string,
    resend?: boolean,
    branding?: { logoUrl?: string },
  ): Promise<string> {
    console.log(`[cognito-idp-service : adminCreateUser] organizationName: ${organizationName}, email: ${email}`);

    const logRequestMessage = `Add New User Email=${email} to Platform request`;
    console.info(logRequestMessage);

    const adminCreateUserCommandInput: AdminCreateUserCommandInput = {
      ...(resend === true ? { MessageAction: 'RESEND' } : {}),
      DesiredDeliveryMediums: ['EMAIL'],
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'false' },
      ],
      UserPoolId: this.props.userPoolId,
      ClientMetadata: {
        ['OrganizationId']: organizationId,
        ['OrganizationName']: organizationName,
        ...(branding?.logoUrl ? { EmailBrandingLogoUrl: branding.logoUrl } : {}),
      },
    };

    const response: AdminCreateUserCommandOutput = await this.cognitoIdpRequest<
      AdminCreateUserCommandInput,
      AdminCreateUserCommandOutput
    >(CognitoIdpCommand.ADMIN_CREATE_USER, adminCreateUserCommandInput);
    if (response.$metadata.httpStatusCode === 200 && response.User && response.User.Username) {
      return response.User.Username;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * Enables a Cognito User account for the specified username.
   * @param username
   */
  public adminEnableUser = async (username: string): Promise<AdminEnableUserCommandOutput> => {
    console.log(`[cognito-idp-service : adminEnableUser] username: ${username}`);
    const response: AdminEnableUserCommandOutput = await this.cognitoIdpRequest<
      AdminEnableUserCommandInput,
      AdminEnableUserCommandOutput
    >(CognitoIdpCommand.ADMIN_ENABLE_USER, {
      UserPoolId: this.props.userPoolId,
      Username: username,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to enable cognito user request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Looks up a Cognito User account for the specified username.
   * @param username
   */
  public adminGetUser = async (username: string): Promise<AdminGetUserCommandOutput> => {
    console.log(`[cognito-idp-service : adminGetUser] username: ${username}`);
    const response: AdminGetUserCommandOutput = await this.cognitoIdpRequest<
      AdminGetUserCommandInput,
      AdminGetUserCommandOutput
    >(CognitoIdpCommand.ADMIN_GET_USER, {
      UserPoolId: this.props.userPoolId,
      Username: username,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to verify cognito user request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Updates a Cognito User account password for the specified username.
   * @param username
   */
  public adminSetUserPassword = async (
    username: string,
    password: string,
  ): Promise<AdminSetUserPasswordCommandOutput> => {
    console.log(`[cognito-idp-service : adminSetUserPassword] username: ${username}`);
    const response: AdminSetUserPasswordCommandOutput = await this.cognitoIdpRequest<
      AdminSetUserPasswordCommandInput,
      AdminSetUserPasswordCommandOutput
    >(CognitoIdpCommand.ADMIN_SET_USER_PASSWORD, {
      UserPoolId: this.props.userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to update cognito user password request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Updates a Cognito User email and email_verified attributes to support switching the email for the specified username.
   * @param username
   * @param email
   */
  public adminUpdateUserEmail = async (
    username: string,
    email: string,
  ): Promise<AdminUpdateUserAttributesCommandOutput> => {
    console.log(`[cognito-idp-service : adminUpdateUserEmail] username: ${username}`);
    const response: AdminUpdateUserAttributesCommandOutput = await this.cognitoIdpRequest<
      AdminUpdateUserAttributesCommandInput,
      AdminUpdateUserAttributesCommandOutput
    >(CognitoIdpCommand.ADMIN_UPDATE_USER_ATTRIBUTES, {
      UserPoolId: this.props.userPoolId,
      Username: username,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'false' }, // Require email change to re-verify account
      ],
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to update cognito user email request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Updates a Cognito User email_verified attribute for the specified username.
   * @param username
   * @param emailVerified
   */
  public adminUpdateUserEmailVerified = async (
    username: string,
    emailVerified: boolean,
  ): Promise<AdminUpdateUserAttributesCommandOutput> => {
    console.log(`[cognito-idp-service : adminUpdateUserEmailVerified] username: ${username}`);
    const response: AdminUpdateUserAttributesCommandOutput = await this.cognitoIdpRequest<
      AdminUpdateUserAttributesCommandInput,
      AdminUpdateUserAttributesCommandOutput
    >(CognitoIdpCommand.ADMIN_UPDATE_USER_ATTRIBUTES, {
      UserPoolId: this.props.userPoolId,
      Username: username,
      UserAttributes: [{ Name: 'email_verified', Value: `${emailVerified.toString()}` }],
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to update cognito user email request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Confirms a Cognito forgot password workflow request for the specified username.
   * @param clientId
   * @param username
   * @param password
   * @param confirmationCode
   */
  public confirmForgotPassword = async (
    clientId: string,
    username: string,
    password: string,
    confirmationCode: string,
  ): Promise<ConfirmForgotPasswordCommandOutput> => {
    console.log(`[cognito-idp-service : confirmForgotPassword] clientId: ${clientId}, username: ${username}`);
    const response: ConfirmForgotPasswordCommandOutput = await this.cognitoIdpRequest<
      ConfirmForgotPasswordCommandInput,
      ConfirmForgotPasswordCommandOutput
    >(CognitoIdpCommand.CONFIRM_FORGOT_PASSWORD, {
      ClientId: clientId,
      Username: username,
      Password: password,
      ConfirmationCode: confirmationCode,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to confirm forgot password request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Initiates a Cognito authentication workflow request for the specified username.
   * @param clientId
   * @param username
   * @param password
   */
  public initiateAuth = async (
    clientId: string,
    username: string,
    password: string,
  ): Promise<InitiateAuthCommandOutput> => {
    console.log(`[cognito-idp-service : initiateAuth] clientId: ${clientId}, username: ${username}`);
    const response: InitiateAuthCommandOutput = await this.cognitoIdpRequest<
      InitiateAuthCommandInput,
      InitiateAuthCommandOutput
    >(CognitoIdpCommand.INITIATE_AUTH, {
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        ['USERNAME']: username,
        ['PASSWORD']: password,
      },
      ClientId: clientId,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to initiate auth request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Initiates a Cognito forgot password workflow request for the specified username.
   * @param clientId
   * @param username
   */
  public forgotPassword = async (clientId: string, username: string): Promise<ForgotPasswordCommandOutput> => {
    console.log(`[cognito-idp-service : forgotPassword] clientId: ${clientId}, username: ${username}`);
    const response: ForgotPasswordCommandOutput = await this.cognitoIdpRequest<
      ForgotPasswordCommandInput,
      ForgotPasswordCommandOutput
    >(CognitoIdpCommand.FORGOT_PASSWORD, {
      ClientId: clientId,
      Username: username,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to initiate forgot password request: ${JSON.stringify(response)}`);
    }
  };

  /**
   * Completes the Cognito Auth Challenge workflow for an authenticated user.
   *
   * This is required to complete NEW_PASSWORD_REQUIRED challenge which is
   * received from the initiateAuth() workflow when logging in with the
   * temporaryPassword generated from the adminCreateUser() workflow.
   *
   * @param clientId
   * @param accessToken
   * @param username
   * @param newPassword
   */
  public respondToAuthChallenge = async (
    clientId: string,
    accessToken: string,
    username: string,
    newPassword: string,
  ): Promise<RespondToAuthChallengeCommandOutput> => {
    console.log(`[cognito-idp-service : respondToAuthChallenge] username: ${username}`);
    const response: RespondToAuthChallengeCommandOutput = await this.cognitoIdpRequest<
      RespondToAuthChallengeCommandInput,
      RespondToAuthChallengeCommandOutput
    >(CognitoIdpCommand.RESPOND_TO_AUTH_CHALLENGE, {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ChallengeResponses: {
        ['USERNAME']: username,
        ['NEW_PASSWORD']: newPassword,
      },
      ClientId: clientId,
      Session: accessToken,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to respond to auth challenge request: ${JSON.stringify(response)}`);
    }
  };

  private cognitoIdpRequest = async <RequestType, ResponseType>(
    command: CognitoIdpCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return (await this.cognitoIdpClient.send(this.getCognitoIdpCommand(command, data))) as ResponseType;
    } catch (error: any) {
      console.error(`[cognitoIdp-service : cognitoIdpRequest] command: ${command} exception encountered:`, error);
      throw this.handleError(error);
    }
  };

  /**
   * This function deletes an existing User's own user account from Cognito
   * @param accessToken
   */
  async deleteUser(accessToken: string): Promise<DeleteUserCommandOutput> {
    console.log(`[cognito-idp-service : deleteUser] accessToken: ${accessToken}`);

    const logRequestMessage = 'Deleting user to Platform request';
    console.info(logRequestMessage);

    const response: DeleteUserCommandOutput = await this.cognitoIdpRequest<
      DeleteUserCommandInput,
      DeleteUserCommandOutput
    >(CognitoIdpCommand.DELETE_USER, {
      AccessToken: accessToken,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`${logRequestMessage} unsuccessful: HTTP Status Code=${response.$metadata.httpStatusCode}`);
    }
  }

  /**
   * This function deletes a specific users account from cognito
   * @param username
   */
  public adminDeleteUser = async (username: string): Promise<AdminDeleteUserCommandOutput> => {
    console.log(`[cognito-idp-service : adminUpdateUserEmail] username: ${username}`);
    const response: AdminDeleteUserCommandOutput = await this.cognitoIdpRequest<
      AdminDeleteUserCommandInput,
      AdminDeleteUserCommandOutput
    >(CognitoIdpCommand.ADMIN_DELETE_USER, {
      UserPoolId: this.props.userPoolId,
      Username: username,
    });
    if (response.$metadata.httpStatusCode === 200) {
      return response;
    } else {
      throw new Error(`Unable to delete cognito user request: ${JSON.stringify(response)}`);
    }
  };

  private handleError = (error: any): CognitoIdentityProviderServiceException => {
    if (error instanceof UserNotFoundException) {
      return error as UserNotFoundException;
    } else {
      return error as CognitoIdentityProviderServiceException; // Base Exception
    }
  };

  /**
   * Helper function returning the appropriate Cognito-IDP commands.
   *
   * @param command
   * @param data
   */
  private getCognitoIdpCommand = (command: CognitoIdpCommand, data: any): any => {
    switch (command) {
      case CognitoIdpCommand.ADMIN_CREATE_USER:
        return new AdminCreateUserCommand(data as AdminCreateUserCommandInput);
      case CognitoIdpCommand.ADMIN_ENABLE_USER:
        return new AdminEnableUserCommand(data as AdminEnableUserCommandInput);
      case CognitoIdpCommand.ADMIN_GET_USER:
        return new AdminGetUserCommand(data as AdminGetUserCommandInput);
      case CognitoIdpCommand.ADMIN_SET_USER_PASSWORD:
        return new AdminSetUserPasswordCommand(data as AdminSetUserPasswordCommandInput);
      case CognitoIdpCommand.ADMIN_UPDATE_USER_ATTRIBUTES:
        return new AdminUpdateUserAttributesCommand(data as AdminUpdateUserAttributesCommandInput);
      case CognitoIdpCommand.ADMIN_DELETE_USER:
        return new AdminDeleteUserCommand(data as AdminDeleteUserCommandInput);
      case CognitoIdpCommand.CONFIRM_FORGOT_PASSWORD:
        return new ConfirmForgotPasswordCommand(data as ConfirmForgotPasswordCommandInput);
      case CognitoIdpCommand.FORGOT_PASSWORD:
        return new ForgotPasswordCommand(data as ForgotPasswordCommandInput);
      case CognitoIdpCommand.INITIATE_AUTH:
        return new InitiateAuthCommand(data as InitiateAuthCommandInput);
      case CognitoIdpCommand.RESPOND_TO_AUTH_CHALLENGE:
        return new RespondToAuthChallengeCommand(data as RespondToAuthChallengeCommandInput);
      case CognitoIdpCommand.DELETE_USER:
        return new DeleteUserCommand(data as DeleteUserCommandInput);
      default:
        throw new Error(`Unsupported Cognito IDP Command '${command}'`);
    }
  };
}
