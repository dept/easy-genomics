import { Amplify } from 'aws-amplify';
import { useRuntimeConfig } from 'nuxt/app';
import { buildAmplifyAuthConfig } from '@FE/utils/amplify-auth-config';
import { clearUnusedCognitoStorageKeys } from '@FE/utils/amplify-oauth-storage';

// Must load before Amplify.configure() below: the listener subscribes to the core
// `configure` Hub event and completes the OAuth code exchange. This lives in the
// plugin (eager app entry) rather than the lazy /auth/callback chunk so the global
// route guard cannot run before the listener exists.

import 'aws-amplify/auth/enable-oauth-listener';

export default defineNuxtPlugin(() => {
  const publicConfig = useRuntimeConfig().public;

  if (typeof window !== 'undefined') {
    clearUnusedCognitoStorageKeys();
  }

  Amplify.configure(buildAmplifyAuthConfig(publicConfig));
});
