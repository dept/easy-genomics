import { resolveApiUrls } from './api-url-resolution';

describe('resolveApiUrls', () => {
  const mainStackName = 'dev-demo-main-back-end-stack';
  const easyGenomicsStackName = 'dev-demo-easy-genomics-api-stack';
  const baseUrl = 'https://enq0s22xth.execute-api.us-west-2.amazonaws.com/prod';
  const easyGenomicsUrl = 'https://i20yn5smzj.execute-api.us-west-2.amazonaws.com/prod';

  const inputs = (overrides: Partial<Parameters<typeof resolveApiUrls>[0]> = {}) => ({
    mainStackName,
    easyGenomicsStackName,
    ...overrides,
  });

  describe('base url precedence', () => {
    it('prefers the environment override over the stack output', () => {
      // A custom domain, since an override that is a different raw invoke URL is
      // treated as stale — see the 'stale environment override' cases below.
      const customDomain = 'https://api.easygenomics.example.org';
      const resolved = resolveApiUrls(inputs({ baseUrlEnvOverride: customDomain, baseUrlStackOutput: baseUrl }));

      expect(resolved.baseUrl).toEqual(customDomain);
      expect(resolved.baseUrlSource).toEqual('env');
    });

    it('falls back to the stack output when no override is set', () => {
      const resolved = resolveApiUrls(inputs({ baseUrlStackOutput: baseUrl }));

      expect(resolved.baseUrl).toEqual(baseUrl);
      expect(resolved.baseUrlSource).toEqual('stack-output');
    });

    it('throws naming the stack and output key when neither is available', () => {
      expect(() => resolveApiUrls(inputs())).toThrow(
        expect.objectContaining({
          message: expect.stringContaining(mainStackName) as unknown as string,
        }),
      );
      expect(() => resolveApiUrls(inputs())).toThrow(/ApiGatewayRestApiUrl/);
    });
  });

  describe('easy genomics url precedence', () => {
    it('prefers the environment override over the yaml value and the stack output', () => {
      const resolved = resolveApiUrls(
        inputs({
          baseUrlStackOutput: baseUrl,
          easyGenomicsEnvOverride: easyGenomicsUrl,
          easyGenomicsYamlValue: 'https://from-yaml.execute-api.us-west-2.amazonaws.com/prod',
          easyGenomicsStackOutput: 'https://from-stack.execute-api.us-west-2.amazonaws.com/prod',
        }),
      );

      expect(resolved.easyGenomicsUrl).toEqual(easyGenomicsUrl);
      expect(resolved.easyGenomicsUrlSource).toEqual('env');
    });

    it('prefers the yaml value over the stack output', () => {
      const resolved = resolveApiUrls(
        inputs({
          baseUrlStackOutput: baseUrl,
          easyGenomicsYamlValue: easyGenomicsUrl,
          easyGenomicsStackOutput: 'https://from-stack.execute-api.us-west-2.amazonaws.com/prod',
        }),
      );

      expect(resolved.easyGenomicsUrl).toEqual(easyGenomicsUrl);
      expect(resolved.easyGenomicsUrlSource).toEqual('yaml');
    });

    it('falls back to the stack output when nothing else is set', () => {
      const resolved = resolveApiUrls(
        inputs({ baseUrlStackOutput: baseUrl, easyGenomicsStackOutput: easyGenomicsUrl }),
      );

      expect(resolved.easyGenomicsUrl).toEqual(easyGenomicsUrl);
      expect(resolved.easyGenomicsUrlSource).toEqual('stack-output');
    });

    it('resolves to undefined rather than throwing when no source is available', () => {
      const resolved = resolveApiUrls(inputs({ baseUrlStackOutput: baseUrl }));

      expect(resolved.easyGenomicsUrl).toBeUndefined();
      expect(resolved.easyGenomicsUrlSource).toBeUndefined();
    });
  });

  describe('equality guard', () => {
    it('throws naming both sources when a stale override collides with the yaml value', () => {
      // The reported defect: a split deployment carrying both an easy-genomics URL in
      // easy-genomics.yaml and a stale AWS_API_GATEWAY_URL export. Neither value comes
      // from a stack output, so only the deployment being split can catch it.
      expect(() =>
        resolveApiUrls(
          inputs({
            baseUrlEnvOverride: easyGenomicsUrl,
            easyGenomicsYamlValue: easyGenomicsUrl,
            easyGenomicsStackOutput: easyGenomicsUrl,
          }),
        ),
      ).toThrow(/env.*yaml|yaml.*env/s);
    });

    it('throws when both resolve from stack outputs to the same url', () => {
      expect(() => resolveApiUrls(inputs({ baseUrlStackOutput: baseUrl, easyGenomicsStackOutput: baseUrl }))).toThrow(
        /identical|same/i,
      );
    });

    it('allows equal urls that are a custom domain rather than an invoke url', () => {
      // Supported prod topology: both APIs behind one base-path-mapped custom domain,
      // so the operator legitimately names the same host twice. The value matches
      // neither stack output, which is what distinguishes it from a stale override.
      const customDomain = 'https://api.easygenomics.example.org';
      const resolved = resolveApiUrls(
        inputs({
          baseUrlEnvOverride: customDomain,
          easyGenomicsYamlValue: customDomain,
          easyGenomicsStackOutput: easyGenomicsUrl,
        }),
      );

      expect(resolved.baseUrl).toEqual(customDomain);
      expect(resolved.easyGenomicsUrl).toEqual(customDomain);
    });

    it('throws when the yaml value is mistakenly set to the base stack output', () => {
      expect(() =>
        resolveApiUrls(
          inputs({
            baseUrlStackOutput: baseUrl,
            easyGenomicsYamlValue: baseUrl,
            easyGenomicsStackOutput: easyGenomicsUrl,
          }),
        ),
      ).toThrow(/identical/i);
    });

    it('allows equal urls on a deployment that publishes no easy-genomics stack output', () => {
      const resolved = resolveApiUrls(inputs({ baseUrlEnvOverride: baseUrl, easyGenomicsYamlValue: baseUrl }));

      expect(resolved.baseUrl).toEqual(baseUrl);
      expect(resolved.easyGenomicsUrl).toEqual(baseUrl);
    });

    it('does not fire in legacy single-url mode', () => {
      const resolved = resolveApiUrls(inputs({ baseUrlStackOutput: baseUrl }));

      expect(resolved.baseUrl).toEqual(baseUrl);
      expect(resolved.easyGenomicsUrl).toBeUndefined();
    });
  });

  describe('stale environment override', () => {
    it('throws when the override is an invoke url the main stack does not publish', () => {
      // A stale export from a previous upgrade, or one copied from the wrong API.
      expect(() =>
        resolveApiUrls(
          inputs({
            baseUrlEnvOverride: 'https://qig0exg1f2.execute-api.us-west-2.amazonaws.com/prod',
            baseUrlStackOutput: baseUrl,
            easyGenomicsStackOutput: easyGenomicsUrl,
          }),
        ),
      ).toThrow(/AWS_API_GATEWAY_URL/);
    });

    it('accepts an override that matches the stack output', () => {
      const resolved = resolveApiUrls(inputs({ baseUrlEnvOverride: baseUrl, baseUrlStackOutput: baseUrl }));

      expect(resolved.baseUrl).toEqual(baseUrl);
      expect(resolved.baseUrlSource).toEqual('env');
    });

    it('accepts a custom domain override, which is not an invoke url', () => {
      const resolved = resolveApiUrls(
        inputs({
          baseUrlEnvOverride: 'https://api.easygenomics.example.org',
          baseUrlStackOutput: baseUrl,
          easyGenomicsStackOutput: easyGenomicsUrl,
        }),
      );

      expect(resolved.baseUrl).toEqual('https://api.easygenomics.example.org');
    });

    it('accepts an override when the stack output could not be read', () => {
      const resolved = resolveApiUrls(
        inputs({ baseUrlEnvOverride: 'https://qig0exg1f2.execute-api.us-west-2.amazonaws.com/prod' }),
      );

      expect(resolved.baseUrl).toEqual('https://qig0exg1f2.execute-api.us-west-2.amazonaws.com/prod');
    });
  });

  describe('trailing slashes', () => {
    it('trims them from every source', () => {
      const resolved = resolveApiUrls(
        inputs({ baseUrlEnvOverride: `${baseUrl}/`, easyGenomicsYamlValue: `${easyGenomicsUrl}//` }),
      );

      expect(resolved.baseUrl).toEqual(baseUrl);
      expect(resolved.easyGenomicsUrl).toEqual(easyGenomicsUrl);
    });

    it('treats urls differing only by a trailing slash as equal for the guard', () => {
      expect(() =>
        resolveApiUrls(inputs({ baseUrlEnvOverride: baseUrl, easyGenomicsStackOutput: `${baseUrl}/` })),
      ).toThrow();
    });
  });
});
