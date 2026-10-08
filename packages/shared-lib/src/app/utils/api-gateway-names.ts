/**
 * Physical `Name`s of the REST APIs this solution deploys.
 *
 * Both APIs come from the same construct, and their construct ids resolve to the
 * same string, so CDK's `restApiName ?? id` fallback would otherwise deploy them
 * under one name — indistinguishable in the console, since the description is also
 * shared. Centralised here so the two CDK stacks that create the APIs cannot drift
 * apart and collide again.
 *
 * Nothing resolves an API by these names. The front-end build reads both URLs from
 * its stack's CloudFormation outputs, which is unambiguous by construction; these
 * names exist so a human reading the console can tell the two APIs apart.
 *
 * These are deployed physical names: changing one renames the API in place. That is
 * an update without interruption and the invoke URL is unaffected, because the
 * construct ids — and so the logical ids — stay fixed.
 */

/** API owning `/nf-tower` and `/aws-healthomics`; created by `{namePrefix}-main-back-end-stack`. */
export const mainBackEndApiName = (namePrefix: string): string => `${namePrefix}-main-back-end-apigw`;

/** API owning `/easy-genomics`; created by `{namePrefix}-easy-genomics-api-stack`. */
export const easyGenomicsApiName = (namePrefix: string): string => `${namePrefix}-easy-genomics-api-apigw`;
