import * as dotenv from 'dotenv';

/**
 * Load and return the following environmental variables from
 * {easy-genomics root dir}/config/.env.nuxt file.
 */
export function loadNuxtSettings() {
  dotenv.config({
    path: '../../config/.env.nuxt',
  });

  if (
    process.env.npm_lifecycle_script === 'nuxt dev' ||
    process.env.npm_lifecycle_script === 'nuxt generate' ||
    process.env.npm_lifecycle_script === 'nuxt build'
  ) {
    if (!process.env.AWS_REGION) {
      throw new Error('AWS_REGION undefined, please check the environment configuration');
    }
    if (!process.env.ENV_TYPE) {
      throw new Error('ENV_TYPE undefined, please check the environment configuration');
    }
    if (!process.env.AWS_API_GATEWAY_URL) {
      throw new Error('AWS_API_GATEWAY_URL undefined, please check the environment configuration');
    }
    if (!process.env.AWS_COGNITO_USER_POOL_ID) {
      throw new Error('AWS_COGNITO_USER_POOL_ID undefined, please check the environment configuration');
    }
    if (!process.env.AWS_COGNITO_USER_POOL_CLIENT_ID) {
      throw new Error('AWS_COGNITO_USER_POOL_CLIENT_ID undefined, please check the environment configuration');
    }
  }
}
