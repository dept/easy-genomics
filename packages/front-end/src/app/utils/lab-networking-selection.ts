export const RESTRICTED_NETWORKING = 'RESTRICTED';

export type NetworkingMode = 'RESTRICTED' | 'VPC';

export interface NetworkingMenuOption {
  label: string;
  value: string;
}

export interface NetworkingSelection {
  mode: NetworkingMode;
  name: string;
}

/** Value shown in the Networking menu. An unnamed VPC mode stays empty so the placeholder shows. */
export function networkingMenuValue(mode: string | undefined, name: string | undefined): string | undefined {
  if (mode === 'VPC') return name?.trim() || undefined;
  return RESTRICTED_NETWORKING;
}

/** Restricted, plus the current configuration name when one is set. */
export function networkingMenuOptions(name: string | undefined): NetworkingMenuOption[] {
  const options: NetworkingMenuOption[] = [{ label: 'Restricted (default)', value: RESTRICTED_NETWORKING }];
  const trimmed = name?.trim();
  if (trimmed && trimmed !== RESTRICTED_NETWORKING) options.push({ label: trimmed, value: trimmed });
  return options;
}

/** Text chosen from the menu, including a name the user typed (creatable emits a string or `{ label }`). */
export function networkingMenuText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'label' in value) {
    const option = value as { label: unknown; value?: unknown };
    const picked = typeof option.value === 'string' && option.value ? option.value : option.label;
    return typeof picked === 'string' ? picked.trim() : '';
  }
  return '';
}

/** What to persist. Restricted clears the name; any other choice is that VPC configuration name. */
export function networkingStateFromMenu(value: unknown): NetworkingSelection {
  const next = networkingMenuText(value);
  if (!next || next === RESTRICTED_NETWORKING) {
    return { mode: 'RESTRICTED', name: '' };
  }
  return { mode: 'VPC', name: next };
}
