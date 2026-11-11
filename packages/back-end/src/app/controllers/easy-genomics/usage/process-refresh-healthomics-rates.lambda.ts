import { Handler } from 'aws-lambda';
import { HealthOmicsRatesService, RatesRefreshResult } from '@BE/services/aws-healthomics/healthomics-rates-service';

const healthOmicsRatesService = new HealthOmicsRatesService();

/**
 * Scheduled weekly: stores this deployment's region's HealthOmics rates from AWS's public
 * price list, for cost capture to read. A rejected price list is logged by the service and
 * leaves the stored rates in place; only a failure to store them throws.
 */
export const handler: Handler = async (): Promise<RatesRefreshResult> => {
  const region = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
  const result = await healthOmicsRatesService.refresh(region);
  console.log(
    `process-refresh-healthomics-rates: ${region} ${result.outcome}, publication date ${result.publicationDate ?? 'unknown'}`,
  );
  return result;
};
