import { Amplify } from 'aws-amplify';
import { useRuntimeConfig } from 'nuxt/app';
import { toUrlList } from '@FE/utils/cognito-oauth-urls';

// Must load before Amplify.configure() below: the listener subscribes to the core
// `configure` Hub event and completes the OAuth code exchange. This lives in the
// plugin (eager app entry) rather than the lazy /auth/callback chunk so the global
// route guard cannot run before the listener exists.
// eslint-disable-next-line import/no-unresolved -- Amplify v6 subpath export
import 'aws-amplify/auth/enable-oauth-listener';

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
