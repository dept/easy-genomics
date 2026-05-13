import {
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUserPoolsCommandInput,
  ListUserPoolsCommandOutput,
  ListUserPoolClientsCommand,
  ListUserPoolClientsCommandInput,
  ListUserPoolClientsCommandOutput,
  UserPoolDescriptionType,
  UserPoolClientDescription,
  DescribeUserPoolCommand,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoIdpInfo } from '../types/cognito-idp-info';

const cognitoIdpClient: CognitoIdentityProviderClient = new CognitoIdentityProviderClient();

/**
 * Public utility to query Cognito IDP to obtain Easy Genomics' Cognito User Pool
 * Id and User Pool Client Id.
 * @param userPoolName
 * @param userPoolClientName
 */
export async function getCognitoIdpInfo(userPoolName: string, userPoolClientName: string): Promise<CognitoIdpInfo> {
  const userPools: UserPoolDescriptionType[] = await listCognitoIdpUserPools();
  const userPool: UserPoolDescriptionType | undefined = userPools.find(
    (up: UserPoolDescriptionType) => up.Name === userPoolName,
  );

  const userPoolClients: UserPoolClientDescription[] = await listCognitoIdpUserPoolClients(userPool?.Id);
  const userPoolClient: UserPoolClientDescription | undefined = userPoolClients.find(
    (upc: UserPoolClientDescription) => upc.ClientName === userPoolClientName,
  );

  if (!userPool || !userPoolClient) {
    const reason = !userPool
      ? `User Pool Name '${userPoolName}' not found`
      : `User Pool Client Name '${userPoolClientName}' not found`;
    throw new Error(`Unable to obtain Cognito User Pool / Client details: ${reason}`);
  } else {
    const cognitoIdpInfo: CognitoIdpInfo = {
      UserPoolId: userPool.Id,
      UserPoolClientId: userPoolClient.ClientId,
    };
    return cognitoIdpInfo;
  }
}

/**
 * Private utility function to query a list of Cognito User Pools.
 */
async function listCognitoIdpUserPools(): Promise<UserPoolDescriptionType[]> {
  const listUserPoolsCommand: ListUserPoolsCommand = new ListUserPoolsCommand({
    MaxResults: 10,
  } as ListUserPoolsCommandInput);

  const response: ListUserPoolsCommandOutput = await cognitoIdpClient.send<
    ListUserPoolsCommandInput,
    ListUserPoolsCommandOutput
  >(listUserPoolsCommand);

  const userPools: UserPoolDescriptionType[] | undefined = response.UserPools;
  if (!userPools) {
    throw new Error('Unable to find any Cognito User Pools. Please check the Easy-Genomics Back-End deployment.');
  } else {
    return userPools;
  }
}

/**
 * Private utility function to query Cognito User Pool for the list of associated
 * User Pool Clients.
 * @param userPoolId
 */
async function listCognitoIdpUserPoolClients(userPoolId: string | undefined): Promise<UserPoolClientDescription[]> {
  const listUserPoolClientsCommand: ListUserPoolClientsCommand = new ListUserPoolClientsCommand({
    UserPoolId: userPoolId,
    MaxResults: 10,
  } as ListUserPoolClientsCommandInput);

  const response: ListUserPoolClientsCommandOutput = await cognitoIdpClient.send<
    ListUserPoolClientsCommandInput,
    ListUserPoolClientsCommandOutput
  >(listUserPoolClientsCommand);
  const userPoolClients: UserPoolClientDescription[] | undefined = response.UserPoolClients;

  if (!userPoolClients) {
    throw new Error(
      'Unable to find any Cognito User Pool Clients. Please check the Easy-Genomics Back-End deployment.',
    );
  } else {
    return userPoolClients;
  }
}

/**
 * Public utility to query Cognito for the configured domain.
 */
export async function getCognitoDomainInfo(userPoolId: string): Promise<string | undefined> {
  const describeUserPoolCommand = new DescribeUserPoolCommand({
    UserPoolId: userPoolId,
  });

  const response = await cognitoIdpClient.send(describeUserPoolCommand);
  return response.UserPool?.Domain;
}

/**
 * Public utility to query Cognito for callback/logout urls configured for a client.
 */
export async function getCognitoClientUrls(
  userPoolId: string,
  userPoolClientId: string,
): Promise<{ callbackUrls: string; logoutUrls: string }> {
  const describeClientCommand = new DescribeUserPoolClientCommand({
    UserPoolId: userPoolId,
    ClientId: userPoolClientId,
  });

  const response = await cognitoIdpClient.send(describeClientCommand);
  const client = response.UserPoolClient;

  if (!client) {
    throw new Error(`Unable to retrieve Cognito client: ${userPoolClientId}`);
  }

  return {
    callbackUrls: (client.CallbackURLs || []).join(','),
    logoutUrls: (client.LogoutURLs || []).join(','),
  };
}
