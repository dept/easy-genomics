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
      const resolved = resolveApiUrls(inputs({ baseUrlEnvOverride: baseUrl, baseUrlStackOutput: easyGenomicsUrl }));

      expect(resolved.baseUrl).toEqual(baseUrl);
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
