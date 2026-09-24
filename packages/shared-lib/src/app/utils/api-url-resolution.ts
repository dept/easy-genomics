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
        'and AWS_API_GATEWAY_URL is not set. Deploy the back-end, or set AWS_API_GATEWAY_URL to the API serving ' +
        '/aws-healthomics and /nf-tower.',
    );
  }

  const [baseUrlSource, baseUrl] = base;

  // Absent on a deployment that predates the v1.5 API split. factory.ts then serves
  // /easy-genomics from the base URL, which is correct for a single-API deployment.
  const easyGenomics = firstAvailable([
    ['env', inputs.easyGenomicsEnvOverride],
    ['yaml', inputs.easyGenomicsYamlValue],
    ['stack-output', inputs.easyGenomicsStackOutput],
  ]);

  if (easyGenomics) {
    const [easyGenomicsUrlSource, easyGenomicsUrl] = easyGenomics;

    // Two equal URLs mean every /aws-healthomics and /nf-tower request 404s in the
    // browser. Whether that is an error depends on the deployment, not on where the
    // values came from: a split deployment always has two distinct APIs, while a
    // pre-split one has a single API an operator may legitimately name twice.
    // easyGenomicsStackOutput is the signal, so the caller must look it up even when
    // a higher-precedence value already supplied the URL.
    const isSplitDeployment = inputs.easyGenomicsStackOutput !== undefined;

    if (isSplitDeployment && baseUrl === easyGenomicsUrl) {
      throw new Error(
        `The back-end API URL and the Easy Genomics API URL are identical (${baseUrl}). ` +
          `The back-end URL came from '${baseUrlSource}' and the Easy Genomics URL from '${easyGenomicsUrlSource}'. ` +
          `They must differ: '${inputs.mainStackName}' serves /aws-healthomics and /nf-tower, ` +
          `'${inputs.easyGenomicsStackName}' serves /easy-genomics.`,
      );
    }

    return { baseUrl, baseUrlSource, easyGenomicsUrl, easyGenomicsUrlSource };
  }

  return { baseUrl, baseUrlSource };
}
