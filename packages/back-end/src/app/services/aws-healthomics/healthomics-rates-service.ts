import { ParameterNotFound } from '@aws-sdk/client-ssm';
import {
  HealthOmicsRegionRates,
  HealthOmicsRegionRatesSchema,
  parseHealthOmicsPriceList,
} from '@easy-genomics/shared-lib/src/app/utils/healthomics-price-list';
import { HEALTHOMICS_RATES_BY_REGION } from '@easy-genomics/shared-lib/src/app/utils/healthomics-rates.generated';
import { SsmService } from '@BE/services/ssm-service';

const PRICE_LIST_HOST = 'https://pricing.us-east-1.amazonaws.com';
const CACHE_TTL_MS = 60 * 60 * 1000;
// A price list that lost more than a fifth of the baked instance types is more likely truncated or
// reshaped than a genuine retirement of that many types.
const MIN_INSTANCE_TYPE_RATIO = 0.8;

export type RatesRefreshOutcome = 'updated' | 'unchanged' | 'rejected';

export type RatesRefreshDecision = { outcome: 'updated' } | { outcome: 'unchanged' | 'rejected'; reason: string };

export type RatesRefreshResult = { outcome: RatesRefreshOutcome; publicationDate?: string; reason?: string };

type HealthOmicsRatesServiceOptions = {
  ssmService?: SsmService;
  fetch?: typeof fetch;
};

type StoredRatesRead = { rates: HealthOmicsRegionRates } | { rates: undefined; reason: string };

export function healthOmicsPriceListUrl(region: string): string {
  return `${PRICE_LIST_HOST}/offers/v1.0/aws/AmazonOmics/current/${region}/index.json`;
}

/**
 * Decides whether freshly parsed rates may replace the stored ones. `baked` is the
 * region's entry in the generated table and sets the instance-type floor.
 */
export function validateRefreshedRates(
  candidate: HealthOmicsRegionRates,
  baked: HealthOmicsRegionRates | undefined,
  stored: HealthOmicsRegionRates | undefined,
): RatesRefreshDecision {
  for (const storageType of ['STATIC', 'DYNAMIC'] as const) {
    if (!(candidate.runStorageGbHourUsd[storageType] > 0)) {
      return { outcome: 'rejected', reason: `${storageType} run-storage rate is not positive` };
    }
  }

  const candidateCount = Object.keys(candidate.instanceHourlyUsd).length;
  const bakedCount = baked ? Object.keys(baked.instanceHourlyUsd).length : 0;
  const minimumCount = Math.ceil(bakedCount * MIN_INSTANCE_TYPE_RATIO);
  if (candidateCount < minimumCount) {
    return {
      outcome: 'rejected',
      reason: `only ${candidateCount} instance types, fewer than ${minimumCount} (80% of the ${bakedCount} baked)`,
    };
  }

  if (stored?.publicationDate === candidate.publicationDate) {
    return { outcome: 'unchanged', reason: `publication date ${candidate.publicationDate} is already stored` };
  }
  return { outcome: 'updated' };
}

/**
 * Keeps a deployment's HealthOmics rates in one SSM parameter, refreshed from AWS's
 * public price list. Readers fall back to the generated table whenever the parameter
 * can't be used, so a rate lookup never fails a cost capture.
 */
export class HealthOmicsRatesService {
  private readonly ssmService: SsmService;
  private readonly fetchPriceList: typeof fetch;
  private cached?: { region: string; rates: HealthOmicsRegionRates | undefined; expiresAt: number };

  public constructor(options: HealthOmicsRatesServiceOptions = {}) {
    this.ssmService = options.ssmService ?? new SsmService();
    this.fetchPriceList = options.fetch ?? fetch;
  }

  /**
   * The region's current rates: the stored ones when usable, otherwise the generated table's.
   * Never throws.
   */
  public getRates = async (region: string): Promise<HealthOmicsRegionRates | undefined> => {
    if (this.cached?.region === region && Date.now() < this.cached.expiresAt) {
      return this.cached.rates;
    }

    const stored = await this.readStoredRates();
    let rates: HealthOmicsRegionRates | undefined = stored.rates;
    if (!stored.rates) {
      rates = HEALTHOMICS_RATES_BY_REGION[region];
      console.warn(
        `HealthOmics rates in ${this.parameterName()} not used (${stored.reason}); pricing with the generated table for ${region}`,
      );
    }
    this.cached = { region, rates, expiresAt: Date.now() + CACHE_TTL_MS };
    return rates;
  };

  /**
   * Downloads the region's price list and stores its rates if they pass validation.
   * Throws only on a failed write; every other problem is a logged `rejected` result.
   */
  public refresh = async (region: string): Promise<RatesRefreshResult> => {
    const sourceUrl = healthOmicsPriceListUrl(region);
    let candidate: HealthOmicsRegionRates;
    try {
      candidate = parseHealthOmicsPriceList(await this.downloadPriceList(sourceUrl), sourceUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`HealthOmics rates for ${region} not refreshed: ${reason}`);
      return { outcome: 'rejected', reason };
    }

    const stored = await this.readStoredRates();
    const decision = validateRefreshedRates(candidate, HEALTHOMICS_RATES_BY_REGION[region], stored.rates);
    if (decision.outcome === 'rejected') {
      console.error(`HealthOmics rates for ${region} not refreshed from ${sourceUrl}: ${decision.reason}`);
      return { ...decision, publicationDate: candidate.publicationDate };
    }
    if (decision.outcome === 'unchanged') {
      console.log(`HealthOmics rates for ${region} unchanged: ${decision.reason}`);
      return { outcome: 'unchanged', publicationDate: candidate.publicationDate };
    }

    await this.ssmService.putParameter({
      Name: this.parameterName(),
      Description: `HealthOmics private-workflow rates for ${region}, from ${sourceUrl}`,
      Type: 'String',
      Tier: 'Standard',
      Overwrite: true,
      Value: JSON.stringify(candidate),
    });
    return { outcome: 'updated', publicationDate: candidate.publicationDate };
  };

  private parameterName(): string {
    return `/${process.env.NAME_PREFIX}/healthomics-rates/current`;
  }

  private async downloadPriceList(sourceUrl: string): Promise<unknown> {
    const response = await this.fetchPriceList(sourceUrl);
    if (!response.ok) {
      throw new Error(`GET ${sourceUrl} returned HTTP ${response.status}`);
    }
    return response.json();
  }

  private async readStoredRates(): Promise<StoredRatesRead> {
    let value: string | undefined;
    try {
      value = (await this.ssmService.getParameter({ Name: this.parameterName() })).Parameter?.Value;
    } catch (error) {
      if (error instanceof ParameterNotFound) {
        return { rates: undefined, reason: 'parameter not found' };
      }
      return { rates: undefined, reason: `read failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    try {
      const parsed = HealthOmicsRegionRatesSchema.safeParse(JSON.parse(value ?? ''));
      if (parsed.success) return { rates: parsed.data };
      return { rates: undefined, reason: `invalid rates: ${parsed.error.issues[0]?.message}` };
    } catch {
      return { rates: undefined, reason: 'value is not JSON' };
    }
  }
}
