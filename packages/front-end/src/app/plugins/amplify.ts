import { Amplify, Auth } from 'aws-amplify';
import { useRuntimeConfig } from 'nuxt/app';

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
      region: AWS_REGION,
      userPoolId: AWS_USER_POOL_ID,
      userPoolWebClientId: AWS_CLIENT_ID,
      oauth: {
        domain: `${AWS_COGNITO_DOMAIN}.auth.${AWS_REGION}.amazoncognito.com`,
        scope: ['openid', 'email', 'profile'],
        redirectSignIn: COGNITO_CALLBACK_URLS,
        redirectSignOut: COGNITO_LOGOUT_URLS,
        responseType: 'code',
      },
    },
  });

  return {
    provide: {
      auth: Auth,
    },
  };
});
