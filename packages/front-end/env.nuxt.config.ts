import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const configDir = path.resolve(__dirname, '../../config');

const LOCAL_BACKEND_VALUES = new Set(['1', 'true', 'yes']);
const DEFAULT_LOCAL_API_URL = 'http://localhost:3001';

/**
 * Load and return the following environmental variables from
 * {easy-genomics root dir}/config/.env.nuxt file.
 * If config/.env.nuxt.local exists, it is loaded afterward and overrides values.
 *
 * To point at the local back-end without editing files, set USE_LOCAL_BACKEND=1
 * (or "true"/"yes") when starting the app. Optionally set LOCAL_API_URL (default
 * http://localhost:3001) for a different port.
 */
export function loadNuxtSettings() {
  dotenv.config({
    path: path.join(configDir, '.env.nuxt'),
  });

  const localEnvPath = path.join(configDir, '.env.nuxt.local');
  if (fs.existsSync(localEnvPath)) {
    dotenv.config({ path: localEnvPath });
  }

  // Env var toggle: use local back-end without renaming/editing .env.nuxt.local
  if (LOCAL_BACKEND_VALUES.has(String(process.env.USE_LOCAL_BACKEND ?? '').toLowerCase())) {
    process.env.AWS_API_GATEWAY_URL = (process.env.LOCAL_API_URL ?? DEFAULT_LOCAL_API_URL).replace(/\/+$/, '');
  }

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
