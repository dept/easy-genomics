import {
  networkingMenuOptions,
  networkingMenuText,
  networkingMenuValue,
  networkingStateFromMenu,
  RESTRICTED_NETWORKING,
} from '../../../src/app/utils/lab-networking-selection';

describe('networking menu', () => {
  it('shows Restricted when the lab is not using a VPC', () => {
    expect(networkingMenuValue('RESTRICTED', '')).toBe(RESTRICTED_NETWORKING);
    expect(networkingMenuValue(undefined, 'vpc-config')).toBe(RESTRICTED_NETWORKING);
    expect(networkingMenuOptions('')).toEqual([{ label: 'Restricted (default)', value: RESTRICTED_NETWORKING }]);
  });

  it('shows the configuration name when the lab uses a VPC', () => {
    expect(networkingMenuValue('VPC', ' vpc-config ')).toBe('vpc-config');
    expect(networkingMenuOptions('vpc-config')).toEqual([
      { label: 'Restricted (default)', value: RESTRICTED_NETWORKING },
      { label: 'vpc-config', value: 'vpc-config' },
    ]);
  });

  it('leaves the menu empty when VPC mode has no name yet', () => {
    expect(networkingMenuValue('VPC', '  ')).toBeUndefined();
  });

  it('does not offer a name that collides with the Restricted value', () => {
    expect(networkingMenuOptions(RESTRICTED_NETWORKING)).toEqual([
      { label: 'Restricted (default)', value: RESTRICTED_NETWORKING },
    ]);
  });

  it('saves Restricted and clears the name when that option is chosen', () => {
    expect(networkingStateFromMenu(RESTRICTED_NETWORKING)).toEqual({ mode: 'RESTRICTED', name: '' });
    expect(networkingStateFromMenu({ label: 'Restricted (default)', value: RESTRICTED_NETWORKING })).toEqual({
      mode: 'RESTRICTED',
      name: '',
    });
    expect(networkingStateFromMenu('')).toEqual({ mode: 'RESTRICTED', name: '' });
    expect(networkingStateFromMenu(null)).toEqual({ mode: 'RESTRICTED', name: '' });
  });

  it('saves a typed configuration name as VPC mode', () => {
    expect(networkingStateFromMenu('  wslh-prod-vpc  ')).toEqual({ mode: 'VPC', name: 'wslh-prod-vpc' });
    expect(networkingStateFromMenu({ label: 'vpc-config' })).toEqual({ mode: 'VPC', name: 'vpc-config' });
    expect(networkingMenuText({ label: 'ignored', value: 'from-value' })).toBe('from-value');
  });
});
