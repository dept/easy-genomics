import { splitCommaSeparatedList } from '@FE/utils/string-utils';

export interface AmplifyPublicConfig {
  AWS_REGION: string;
  AWS_USER_POOL_ID: string;
  AWS_CLIENT_ID: string;
  AWS_COGNITO_DOMAIN?: string;
  COGNITO_CALLBACK_URLS?: string;
  COGNITO_LOGOUT_URLS?: string;
}

/**
 * Build the Amplify v6 Auth config. OAuth is omitted when there is no hosted-UI
 * domain or redirect URL — otherwise Amplify throws InvalidRedirectException on
 * every page load in password-only deployments.
 */
export function buildAmplifyAuthConfig(publicConfig: AmplifyPublicConfig) {
  const redirectSignIn = splitCommaSeparatedList(publicConfig.COGNITO_CALLBACK_URLS);
  const redirectSignOut = splitCommaSeparatedList(publicConfig.COGNITO_LOGOUT_URLS);
  const domain = publicConfig.AWS_COGNITO_DOMAIN
    ? `${publicConfig.AWS_COGNITO_DOMAIN}.auth.${publicConfig.AWS_REGION}.amazoncognito.com`
    : '';

  const oauth =
    domain && redirectSignIn.length
      ? {
          loginWith: {
            oauth: {
              domain,
              scopes: ['openid', 'email', 'profile'],
              redirectSignIn,
              redirectSignOut,
              responseType: 'code' as const,
            },
          },
        }
      : {};

  return {
    Auth: {
      Cognito: {
        userPoolId: publicConfig.AWS_USER_POOL_ID,
        userPoolClientId: publicConfig.AWS_CLIENT_ID,
        ...oauth,
      },
    },
  };
}
