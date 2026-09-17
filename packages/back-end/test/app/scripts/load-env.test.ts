const MODULE_PATH = '../../../scripts/lib/load-env';

// Without this, dotenv.config() reads whatever real .env.local exists on the machine running
// the test and repopulates REGION/AWS_REGION regardless of what the test deleted beforehand —
// passing only in CI (no .env.local there) and silently broken for local runs.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('loadDotEnvAndReconcileRegion', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('sets AWS_REGION from REGION when only REGION is set (local .env.local convention)', async () => {
    delete process.env.AWS_REGION;
    process.env.REGION = 'us-west-2';
    const { loadDotEnvAndReconcileRegion } = await import(MODULE_PATH);

    loadDotEnvAndReconcileRegion();

    expect(process.env.AWS_REGION).toBe('us-west-2');
  });

  it('sets REGION from AWS_REGION when only AWS_REGION is set (CI convention)', async () => {
    delete process.env.REGION;
    process.env.AWS_REGION = 'us-east-1';
    const { loadDotEnvAndReconcileRegion } = await import(MODULE_PATH);

    loadDotEnvAndReconcileRegion();

    expect(process.env.REGION).toBe('us-east-1');
  });

  it('leaves both untouched when neither is set', async () => {
    delete process.env.REGION;
    delete process.env.AWS_REGION;
    const { loadDotEnvAndReconcileRegion } = await import(MODULE_PATH);

    loadDotEnvAndReconcileRegion();

    expect(process.env.REGION).toBeUndefined();
    expect(process.env.AWS_REGION).toBeUndefined();
  });
});
