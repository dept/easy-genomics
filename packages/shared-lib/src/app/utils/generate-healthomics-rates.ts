/**
 * Regenerates `healthomics-rates.generated.ts` from AWS's public price list.
 * Run from packages/shared-lib: `pnpm run generate:healthomics-rates`.
 * The price list is public, so no AWS credentials are needed.
 */
import fs from 'fs';
import path from 'path';
import { HealthOmicsRegionRates, parseHealthOmicsPriceList } from './healthomics-price-list';
import { renderHealthOmicsRatesModule } from './render-healthomics-rates';

const PRICE_LIST_HOST = 'https://pricing.us-east-1.amazonaws.com';
const REGION_INDEX_URL = `${PRICE_LIST_HOST}/offers/v1.0/aws/AmazonOmics/current/region_index.json`;

// tsx runs this from packages/shared-lib/, like generate-openapi.ts.
const OUTPUT_PATH = path.resolve(process.cwd(), 'src/app/utils/healthomics-rates.generated.ts');

type RegionIndex = { regions: Record<string, { currentVersionUrl: string }> };

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const index = (await fetchJson(REGION_INDEX_URL)) as RegionIndex;
  const regions = Object.entries(index.regions ?? {});
  if (regions.length === 0) {
    throw new Error(`No regions listed in ${REGION_INDEX_URL}`);
  }

  const ratesByRegion: Record<string, HealthOmicsRegionRates> = {};
  for (const [region, { currentVersionUrl }] of regions) {
    const sourceUrl = `${PRICE_LIST_HOST}${currentVersionUrl}`;
    ratesByRegion[region] = parseHealthOmicsPriceList(await fetchJson(sourceUrl), sourceUrl);
  }

  // Every region is fetched and parsed before writing, so a failure never leaves a partial table.
  fs.writeFileSync(OUTPUT_PATH, renderHealthOmicsRatesModule(ratesByRegion), 'utf-8');
  console.log(`Written: ${OUTPUT_PATH} (${regions.length} regions)`);
}

main().catch((error) => {
  console.error(`HealthOmics rates not regenerated: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
