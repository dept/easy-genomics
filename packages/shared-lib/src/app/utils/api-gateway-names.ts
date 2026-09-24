/**
 * Physical `Name`s of the REST APIs this solution deploys.
 *
 * Both APIs come from the same construct, and their construct ids resolve to the
 * same string, so CDK's `restApiName ?? id` fallback would otherwise deploy them
 * under one name. The names are centralised here because three places read them —
 * the two CDK stacks that create the APIs, and the front-end build that resolves
 * the platform API URL by name — and a drift between those breaks that lookup.
 *
 * These are deployed physical names: changing one renames the API in place and
 * invalidates anything that looks it up by name.
 */

/** API owning `/nf-tower` and `/aws-healthomics`; created by `{namePrefix}-main-back-end-stack`. */
export const mainBackEndApiName = (namePrefix: string): string => `${namePrefix}-main-back-end-apigw`;

/** API owning `/easy-genomics`; created by `{namePrefix}-easy-genomics-api-stack`. */
export const easyGenomicsApiName = (namePrefix: string): string => `${namePrefix}-easy-genomics-api-apigw`;
