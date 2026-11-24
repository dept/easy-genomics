/**
 * Reads HealthOmics private-workflow rates out of one region's file in AWS's
 * public price list (`.../offers/v1.0/aws/AmazonOmics/current/<region>/index.json`).
 * Used by `generate-healthomics-rates.ts` to bake the fallback table, and by the
 * back-end's weekly refresh to keep a deployment's own region current.
 */
import { z } from 'zod';

const NonNegativeUsd = z.number().finite().nonnegative();

export const HealthOmicsRegionRatesSchema = z.object({
  publicationDate: z.string().min(1),
  sourceUrl: z.string().min(1),
  instanceHourlyUsd: z.record(z.string(), NonNegativeUsd),
  runStorageGbHourUsd: z.object({ STATIC: NonNegativeUsd, DYNAMIC: NonNegativeUsd }),
});

export type HealthOmicsRegionRates = z.infer<typeof HealthOmicsRegionRatesSchema>;

// Usage types are prefixed with a region code, e.g. `USW2-`.
const INSTANCE_USAGE_TYPE = /^[A-Z0-9]+-WorkflowType:Private-(omics\.[\w.]+)-hours$/;
const STATIC_STORAGE_USAGE_TYPE = /^[A-Z0-9]+-WorkflowType:Private-RunStorage-GB-hour$/;
const DYNAMIC_STORAGE_USAGE_TYPE = /^[A-Z0-9]+-WorkflowType:Private-DynamicRunStorage-Bytes-hour$/;

type PriceListOffer = {
  publicationDate: string;
  products: Record<string, { attributes?: { usagetype?: string } }>;
  terms: {
    OnDemand: Record<string, Record<string, { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }>>;
  };
};

function isPriceListOffer(value: unknown): value is PriceListOffer {
  const offer = value as PriceListOffer | null;
  return (
    typeof offer?.publicationDate === 'string' &&
    typeof offer.products === 'object' &&
    offer.products !== null &&
    typeof offer.terms?.OnDemand === 'object' &&
    offer.terms.OnDemand !== null
  );
}

function onDemandUsd(offer: PriceListOffer, sku: string): number | undefined {
  for (const term of Object.values(offer.terms.OnDemand[sku] ?? {})) {
    for (const dimension of Object.values(term.priceDimensions ?? {})) {
      const usd = Number(dimension.pricePerUnit?.USD);
      if (Number.isFinite(usd)) return usd;
    }
  }
  return undefined;
}

export function parseHealthOmicsPriceList(offer: unknown, sourceUrl: string): HealthOmicsRegionRates {
  if (!isPriceListOffer(offer)) {
    throw new Error(`Not an AWS price-list file: ${sourceUrl}`);
  }

  const instanceHourlyUsd: Record<string, number> = {};
  let staticStorage: number | undefined;
  let dynamicStorage: number | undefined;

  for (const [sku, product] of Object.entries(offer.products)) {
    const usageType = product.attributes?.usagetype ?? '';
    const instanceMatch = INSTANCE_USAGE_TYPE.exec(usageType);
    const isStatic = STATIC_STORAGE_USAGE_TYPE.test(usageType);
    const isDynamic = DYNAMIC_STORAGE_USAGE_TYPE.test(usageType);
    if (!instanceMatch && !isStatic && !isDynamic) continue;

    const usd = onDemandUsd(offer, sku);
    if (usd == null) continue;

    if (instanceMatch) instanceHourlyUsd[instanceMatch[1]] = usd;
    if (isStatic) staticStorage = usd;
    if (isDynamic) dynamicStorage = usd;
  }

  if (Object.keys(instanceHourlyUsd).length === 0) {
    throw new Error(`No HealthOmics private-workflow instance rates in ${sourceUrl}`);
  }
  if (staticStorage == null || dynamicStorage == null) {
    throw new Error(`Missing HealthOmics static or dynamic run-storage rate in ${sourceUrl}`);
  }

  return {
    publicationDate: offer.publicationDate,
    sourceUrl,
    instanceHourlyUsd,
    runStorageGbHourUsd: { STATIC: staticStorage, DYNAMIC: dynamicStorage },
  };
}
