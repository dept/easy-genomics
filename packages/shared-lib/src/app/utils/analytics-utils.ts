import {
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

/**
 * Anonymous per-deployment analytics identifiers.
 *
 * Both values are random, generated once on first deploy, reused on every
 * subsequent deploy, and stored in AWS Secrets Manager. Neither is derived from
 * the AWS account id, domain, hostname or anything else identifying.
 */
export interface AnalyticsDeploymentInfo {
  /** Opaque random identifier for this deployment. Tags every event. */
  deploymentId: string;
  /**
   * Per-deployment salt used by the front-end to one-way hash user / lab / org
   * identifiers. Because the salt differs per deployment, the same person at two
   * institutions hashes to two unrelated values.
   */
  salt: string;
}

/** Conventional Secrets Manager secret name holding the deployment id. */
export function getAnalyticsDeploymentIdSecretName(namePrefix: string): string {
  return `${namePrefix}-easy-genomics-analytics-deployment-id`;
}

/** Conventional Secrets Manager secret name holding the per-deployment salt. */
export function getAnalyticsSaltSecretName(namePrefix: string): string {
  return `${namePrefix}-easy-genomics-analytics-salt`;
}

async function getSecretString(client: SecretsManagerClient, secretName: string): Promise<string | undefined> {
  try {
    const response: GetSecretValueCommandOutput = await client.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );
    return response.SecretString ?? undefined;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return undefined; // First deploy: secret not created yet.
    }
    throw error;
  }
}

/**
 * Reads the analytics deployment identifiers from Secrets Manager.
 *
 * Returns `undefined` when the secrets do not exist yet (e.g. the very first
 * deploy, before the back-end stack has created them). Callers should treat that
 * as "analytics not yet bootstrapped" and ship a bundle without identifiers; the
 * next build/deploy will pick them up.
 *
 * @param namePrefix `${envType}-${envName}` for the deployment.
 * @param client Optional Secrets Manager client. Created lazily when omitted so
 *   importing this module never instantiates an AWS client as a side effect
 *   (callers control instantiation, and pure helpers stay importable in tests).
 */
export async function getAnalyticsDeploymentInfo(
  namePrefix: string,
  client: SecretsManagerClient = new SecretsManagerClient(),
): Promise<AnalyticsDeploymentInfo | undefined> {
  const [deploymentId, salt] = await Promise.all([
    getSecretString(client, getAnalyticsDeploymentIdSecretName(namePrefix)),
    getSecretString(client, getAnalyticsSaltSecretName(namePrefix)),
  ]);

  if (!deploymentId || !salt) {
    return undefined;
  }

  return { deploymentId, salt };
}
