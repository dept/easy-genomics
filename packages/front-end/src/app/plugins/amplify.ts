import { Amplify } from 'aws-amplify';
import { useRuntimeConfig } from 'nuxt/app';

/**
 * Cognito writes its callback/logout URLs into the generated .env as a
 * comma-separated string. v5 accepted that string as-is; v6 requires string[].
 */
function toUrlList(urls: string | undefined): string[] {
  return (urls ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

export default defineNuxtPlugin(() => {
  const {
    AWS_REGION,
    AWS_USER_POOL_ID,
    AWS_CLIENT_ID,
    AWS_COGNITO_DOMAIN,
    COGNITO_LOGOUT_URLS,
    COGNITO_CALLBACK_URLS,
  } = useRuntimeConfig().public;

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: AWS_USER_POOL_ID,
        userPoolClientId: AWS_CLIENT_ID,
        loginWith: {
          oauth: {
            domain: `${AWS_COGNITO_DOMAIN}.auth.${AWS_REGION}.amazoncognito.com`,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: toUrlList(COGNITO_CALLBACK_URLS),
            redirectSignOut: toUrlList(COGNITO_LOGOUT_URLS),
            responseType: 'code',
          },
        },
      },
    },
  });
});
