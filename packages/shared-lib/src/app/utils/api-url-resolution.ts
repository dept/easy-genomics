/**
 * Where a resolved API URL came from. Reported alongside each URL so a build log
 * shows how a value was arrived at, not just what it is.
 */
export type UrlSource = 'env' | 'yaml' | 'stack-output';

export interface ApiUrlInputs {
  baseUrlEnvOverride?: string;
  baseUrlStackOutput?: string;
  easyGenomicsEnvOverride?: string;
  easyGenomicsYamlValue?: string;
  easyGenomicsStackOutput?: string;
  mainStackName: string;
  easyGenomicsStackName: string;
}

export interface ResolvedApiUrls {
  baseUrl: string;
  baseUrlSource: UrlSource;
  easyGenomicsUrl?: string;
  easyGenomicsUrlSource?: UrlSource;
}

export const MAIN_STACK_OUTPUT_KEY = 'ApiGatewayRestApiUrl';
export const EASY_GENOMICS_STACK_OUTPUT_KEY = 'EasyGenomicsApiUrl';

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Whether a URL is a raw API Gateway invoke URL rather than a custom domain. A
 * custom domain is a legitimate override; a raw invoke URL that disagrees with the
 * deployed stack is a stale value.
 *
 * The stage suffix is optional: values reaching this have already had trailing
 * slashes trimmed, so a stage-less override arrives as a bare host and must still
 * be recognised rather than silently skipping the stale-override guard.
 */
export function isApiGatewayInvokeUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com(\/|$)/.test(url);
}

function firstAvailable(candidates: [UrlSource, string | undefined][]): [UrlSource, string] | undefined {
  for (const [source, value] of candidates) {
    if (value && value.trim() !== '') {
      return [source, trimTrailingSlashes(value.trim())];
    }
  }
  return undefined;
}

/**
 * Decides which URL the front-end build uses for each API, and where it came from.
 *
 * Kept free of AWS SDK calls so the precedence rules, the equality guard and the
 * failure messages are unit testable; the caller performs the lookups and passes
 * their results in.
 *
 * @param inputs every candidate value, plus the stack names used in error messages
 */
export function resolveApiUrls(inputs: ApiUrlInputs): ResolvedApiUrls {
  const base = firstAvailable([
    ['env', inputs.baseUrlEnvOverride],
    ['stack-output', inputs.baseUrlStackOutput],
  ]);

  if (!base) {
    throw new Error(
      `Unable to resolve the back-end API URL: stack '${inputs.mainStackName}' has no '${MAIN_STACK_OUTPUT_KEY}' output ` +
        'and AWS_API_GATEWAY_URL is not set. Deploy the back-end first, so the stack publishes the output.',
    );
  }

  const [baseUrlSource, baseUrl] = base;

  // An operator told to `export AWS_API_GATEWAY_URL` during an earlier upgrade may
  // still be carrying it. Left alone a stale one silently sends every HealthOmics and
  // NF-Tower request to the wrong API — the original defect, reintroduced by the
  // workaround for it. Only raw invoke URLs are checked: a custom domain legitimately
  // differs from the stack output, and prod can front this API with one.
  if (
    baseUrlSource === 'env' &&
    inputs.baseUrlStackOutput !== undefined &&
    isApiGatewayInvokeUrl(baseUrl) &&
    baseUrl !== trimTrailingSlashes(inputs.baseUrlStackOutput)
  ) {
    throw new Error(
      `AWS_API_GATEWAY_URL is set to ${baseUrl}, but '${inputs.mainStackName}' publishes ` +
        `${trimTrailingSlashes(inputs.baseUrlStackOutput)} as its '${MAIN_STACK_OUTPUT_KEY}'. ` +
        'This is usually a stale export left over from an earlier upgrade. Unset AWS_API_GATEWAY_URL ' +
        'and the deployed value will be used; it no longer needs to be set by hand.',
    );
  }

  // Absent on a deployment that predates the v1.5 API split. factory.ts then serves
  // /easy-genomics from the base URL, which is correct for a single-API deployment.
  const easyGenomics = firstAvailable([
    ['env', inputs.easyGenomicsEnvOverride],
    ['yaml', inputs.easyGenomicsYamlValue],
    ['stack-output', inputs.easyGenomicsStackOutput],
  ]);

  if (easyGenomics) {
    const [easyGenomicsUrlSource, easyGenomicsUrl] = easyGenomics;

    // Two equal URLs usually mean every /aws-healthomics and /nf-tower request 404s
    // in the browser, but two supported topologies produce equal values legitimately,
    // so the guard needs both of the following to hold.
    //
    // The deployment must be split. A pre-split deployment has a single API an
    // operator may reasonably name twice. easyGenomicsStackOutput is that signal,
    // which is why the caller reads it even when a higher-precedence value already
    // supplied the URL.
    const isSplitDeployment = inputs.easyGenomicsStackOutput !== undefined;

    // And the shared value must be one of the raw invoke URLs. In prod both APIs can
    // sit behind one base-path-mapped custom domain, where naming that domain twice
    // is correct; such a value matches neither stack output. A stale override or a
    // mistyped yaml entry points at an actual invoke URL, and does.
    const collidesWithAnInvokeUrl =
      baseUrl === trimTrailingSlashes(inputs.baseUrlStackOutput ?? '') ||
      baseUrl === trimTrailingSlashes(inputs.easyGenomicsStackOutput ?? '');

    if (isSplitDeployment && collidesWithAnInvokeUrl && baseUrl === easyGenomicsUrl) {
      throw new Error(
        `The back-end API URL and the Easy Genomics API URL are identical (${baseUrl}). ` +
          `The back-end URL came from '${baseUrlSource}' and the Easy Genomics URL from '${easyGenomicsUrlSource}'. ` +
          `They must differ: '${inputs.mainStackName}' serves /aws-healthomics and /nf-tower, ` +
          `'${inputs.easyGenomicsStackName}' serves /easy-genomics. ` +
          (baseUrlSource === 'env'
            ? 'Unset AWS_API_GATEWAY_URL; it no longer needs to be set by hand.'
            : easyGenomicsUrlSource === 'env'
              ? 'Unset AWS_EASY_GENOMICS_API_URL; it no longer needs to be set by hand.'
              : "Correct 'aws-easy-genomics-api-url' in config/easy-genomics.yaml, or remove it to use the deployed value."),
      );
    }

    return { baseUrl, baseUrlSource, easyGenomicsUrl, easyGenomicsUrlSource };
  }

  return { baseUrl, baseUrlSource };
}
