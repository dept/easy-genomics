import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

/** Absolute S3 prefix for a folder the user typed relative to `rootPrefix`, which ends in "/". */
export function buildSourcePrefix(rootPrefix: string, typedPrefix: string): string {
  const relativeFolder = typedPrefix.replace(/^\/*/, '');
  if (!relativeFolder) return rootPrefix;
  return relativeFolder.endsWith('/') ? `${rootPrefix}${relativeFolder}` : `${rootPrefix}${relativeFolder}/`;
}

/** Absolute S3 prefix for a folder the user typed relative to the laboratory's own folder. */
export function buildLaboratorySourcePrefix(
  laboratory: Pick<Laboratory, 'OrganizationId' | 'LaboratoryId'>,
  typedPrefix: string,
): string {
  return buildSourcePrefix(`${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`, typedPrefix);
}
