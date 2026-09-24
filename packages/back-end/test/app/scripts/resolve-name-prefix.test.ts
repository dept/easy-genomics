const MODULE_PATH = '../../../scripts/lib/resolve-name-prefix';

describe('resolveNamePrefix', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns NAME_PREFIX directly when set', async () => {
    process.env.NAME_PREFIX = 'dev-mylab';
    const { resolveNamePrefix } = await import(MODULE_PATH);
    expect(resolveNamePrefix()).toBe('dev-mylab');
  });

  it('derives from CI_CD + ENV_TYPE/ENV_NAME when NAME_PREFIX is unset', async () => {
    delete process.env.NAME_PREFIX;
    process.env.CI_CD = 'true';
    process.env.ENV_TYPE = 'dev';
    process.env.ENV_NAME = 'mylab';
    const { resolveNamePrefix } = await import(MODULE_PATH);
    expect(resolveNamePrefix()).toBe('dev-mylab');
  });

  it('throws when CI_CD=true but ENV_NAME/ENV_TYPE are missing', async () => {
    delete process.env.NAME_PREFIX;
    process.env.CI_CD = 'true';
    delete process.env.ENV_TYPE;
    delete process.env.ENV_NAME;
    const { resolveNamePrefix } = await import(MODULE_PATH);
    expect(() => resolveNamePrefix()).toThrow(
      'CI_CD=true but ENV_NAME / ENV_TYPE are not set (needed to derive NAME_PREFIX).',
    );
  });
});
