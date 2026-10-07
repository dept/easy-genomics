import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';

/** Absolute S3 prefix for a folder the user typed relative to the laboratory's own folder. */
export function buildLaboratorySourcePrefix(
  laboratory: Pick<Laboratory, 'OrganizationId' | 'LaboratoryId'>,
  typedPrefix: string,
): string {
  const laboratoryRoot = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  const relativeFolder = typedPrefix.replace(/^\/*/, '');
  if (!relativeFolder) return laboratoryRoot;
  return relativeFolder.endsWith('/') ? `${laboratoryRoot}${relativeFolder}` : `${laboratoryRoot}${relativeFolder}/`;
}
