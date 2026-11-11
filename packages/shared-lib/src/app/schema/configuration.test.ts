import { ConfigurationSettingsSchema } from './configuration';

const MINIMAL_SETTINGS = {
  'aws-account-id': '123456789012',
  'aws-region': 'us-west-2',
  'env-type': 'dev',
  'app-domain-name': 'demo.example.com',
  'back-end': { 'sys-admin-email': 'sysadmin@example.com', 'sys-admin-password': 'Password!123' },
};

describe('ConfigurationSettingsSchema healthomics-rates-refresh', () => {
  it('accepts settings without the block', () => {
    expect(ConfigurationSettingsSchema.safeParse(MINIMAL_SETTINGS).success).toBe(true);
  });

  it('accepts an enabled flag and a schedule', () => {
    const settings = {
      ...MINIMAL_SETTINGS,
      'healthomics-rates-refresh': { enabled: false, schedule: 'rate(1 day)' },
    };

    expect(ConfigurationSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it('rejects an unknown key inside the block', () => {
    const settings = {
      ...MINIMAL_SETTINGS,
      'healthomics-rates-refresh': { enabled: true, frequency: 'weekly' },
    };

    expect(ConfigurationSettingsSchema.safeParse(settings).success).toBe(false);
  });
});
