export type ProfileBackLink = { label: string; to: string };

const LABS_BACK_LINK: ProfileBackLink = { label: 'Back to Organizations and labs', to: '/labs' };

export function profileBackLink(
  previousPath: string | null | undefined,
  labNameById: (labId: string) => string | undefined,
): ProfileBackLink {
  if (!previousPath) return LABS_BACK_LINK;

  const [pathname] = previousPath.split(/[?#]/);
  const [, section, labId] = pathname.split('/');
  if (section !== 'labs' || !labId) return LABS_BACK_LINK;

  // Only a known lab counts, which also rules out static routes like /labs/create.
  const labName = labNameById(labId);
  if (!labName) return LABS_BACK_LINK;

  return { label: `Back to ${labName}`, to: previousPath };
}
