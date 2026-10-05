import { buildAmplifyAuthConfig } from '../../../src/app/utils/amplify-auth-config';

const baseConfig = {
  AWS_REGION: 'ap-southeast-2',
  AWS_USER_POOL_ID: 'ap-southeast-2_abc',
  AWS_CLIENT_ID: 'client-id',
};

describe('buildAmplifyAuthConfig', () => {
  it('splits comma-separated callback URLs into the oauth redirect array', () => {
    const config = buildAmplifyAuthConfig({
      ...baseConfig,
      AWS_COGNITO_DOMAIN: 'easy-genomics',
      COGNITO_CALLBACK_URLS: ' https://a.example/auth/callback , https://b.example/auth/callback ',
      COGNITO_LOGOUT_URLS: 'https://a.example/signin',
    });

    expect(config.Auth.Cognito.loginWith?.oauth?.redirectSignIn).toEqual([
      'https://a.example/auth/callback',
      'https://b.example/auth/callback',
    ]);
  });

  it('omits oauth when there is no hosted-UI domain', () => {
    const config = buildAmplifyAuthConfig({
      ...baseConfig,
      COGNITO_CALLBACK_URLS: 'https://a.example/auth/callback',
    });

    expect(config.Auth.Cognito.loginWith).toBeUndefined();
  });

  it('omits oauth when callback URLs are empty', () => {
    const config = buildAmplifyAuthConfig({
      ...baseConfig,
      AWS_COGNITO_DOMAIN: 'easy-genomics',
      COGNITO_CALLBACK_URLS: '',
    });

    expect(config.Auth.Cognito.loginWith).toBeUndefined();
  });
});
