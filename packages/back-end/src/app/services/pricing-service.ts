import { GetProductsCommand, PricingClient } from '@aws-sdk/client-pricing';

type PriceDimension = { beginRange?: string; pricePerUnit?: { USD?: string } };
type PriceListProduct = {
  terms?: { OnDemand?: Record<string, { priceDimensions?: Record<string, PriceDimension> }> };
};

/**
 * Thin AWS Price List wrapper. The Price List API is only served from a few regions; us-east-1
 * answers for every region, so the client is pinned there like Cost Explorer.
 */
export class PricingService {
  private readonly pricingClient: PricingClient;
  private readonly s3StandardPriceByRegion = new Map<string, number | undefined>();

  public constructor(client?: PricingClient) {
    this.pricingClient = client ?? new PricingClient({ region: 'us-east-1' });
  }

  /**
   * First-tier (0–50 TB) S3 Standard storage price per GB-month for the region, or `undefined`
   * when the Price List does not answer. Cached per warm Lambda; prices change rarely.
   */
  public getS3StandardPricePerGbMonth = async (region: string): Promise<number | undefined> => {
    if (this.s3StandardPriceByRegion.has(region)) return this.s3StandardPriceByRegion.get(region);

    let price: number | undefined;
    try {
      const response = await this.pricingClient.send(
        new GetProductsCommand({
          ServiceCode: 'AmazonS3',
          Filters: [
            { Type: 'TERM_MATCH', Field: 'regionCode', Value: region },
            { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Storage' },
            { Type: 'TERM_MATCH', Field: 'volumeType', Value: 'Standard' },
          ],
          MaxResults: 1,
        }),
      );
      price = firstTierUsdPrice(response.PriceList?.[0]);
    } catch (error) {
      console.error(`[pricing-service] S3 Standard price lookup failed for ${region}:`, error);
    }

    this.s3StandardPriceByRegion.set(region, price);
    return price;
  };
}

export function firstTierUsdPrice(priceListEntry: string | undefined): number | undefined {
  if (!priceListEntry) return undefined;
  const product = JSON.parse(priceListEntry) as PriceListProduct;
  for (const term of Object.values(product.terms?.OnDemand ?? {})) {
    for (const dimension of Object.values(term.priceDimensions ?? {})) {
      const usd = Number(dimension.pricePerUnit?.USD);
      if (dimension.beginRange === '0' && Number.isFinite(usd) && usd > 0) return usd;
    }
  }
  return undefined;
}
