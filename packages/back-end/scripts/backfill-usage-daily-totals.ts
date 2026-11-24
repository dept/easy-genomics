/**
 * Adds runs captured before the daily usage totals existed to those totals, once each.
 * Run after `backfill-run-cost-outcomes`. Safe to rerun: an already-counted run is skipped by
 * the same count-once transaction the capture consumer uses.
 *
 *   pnpm run backfill-usage-daily-totals [-- --dry-run]
 *
 * The dry run only reads the run table; it never touches the totals table.
 */

import path from 'path';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import dotenv from 'dotenv';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import {
  AddRunCostResult,
  findMissingCountField,
  UsageTotalsService,
} from '../src/app/services/easy-genomics/usage-totals-service';
import { isTerminalLaboratoryRunStatus } from '../src/app/utils/laboratory-run-ttl-utils';

function loadEnv(): void {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  if (process.env.REGION && !process.env.AWS_REGION) process.env.AWS_REGION = process.env.REGION;
  const missing = ['NAME_PREFIX', 'ACCOUNT_ID', 'REGION'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

export function selectRunsToCount(runs: LaboratoryRun[]): LaboratoryRun[] {
  return runs.filter(
    (run) => isTerminalLaboratoryRunStatus(run.Status) && !!run.RunCostOutcome?.CostCapturedAt && !run.RunCostCountedAt,
  );
}

function dryRunResult(run: LaboratoryRun): AddRunCostResult {
  const missingField = findMissingCountField(run);
  if (missingField) {
    console.log(`[dry-run] Would skip RunId=${run.RunId}: ${missingField} is missing`);
    return 'not-countable';
  }
  const { ActualComputeCostUsd, ActualStorageCostUsd } = run.RunCostOutcome!;
  console.log(
    `[dry-run] Would add RunId=${run.RunId} to ${run.TerminalAt!.slice(0, 10)} ` +
      `(lab ${run.LaboratoryId}, workflow ${run.WorkflowExternalId}): ` +
      `compute $${ActualComputeCostUsd}, storage $${ActualStorageCostUsd ?? 0}`,
  );
  return 'counted';
}

export async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  loadEnv();
  const laboratoryRunService = new LaboratoryRunService();
  const usageTotalsService = new UsageTotalsService();

  const candidates = selectRunsToCount(await laboratoryRunService.listAllLaboratoryRuns());
  console.log(`Found ${candidates.length} terminal run(s) with a captured cost not yet in the usage totals.`);

  const counts: Record<AddRunCostResult | 'error', number> = {
    'counted': 0,
    'already-counted': 0,
    'not-countable': 0,
    'error': 0,
  };
  for (const run of candidates) {
    try {
      const result = dryRun ? dryRunResult(run) : await usageTotalsService.addRunCost(run);
      counts[result]++;
    } catch (err: any) {
      console.error(`Error RunId=${run.RunId}:`, err.message ?? err);
      counts.error++;
    }
  }
  console.log(
    `Done. Counted: ${counts.counted}, already counted: ${counts['already-counted']}, ` +
      `not countable: ${counts['not-countable']}, errors: ${counts.error}${dryRun ? ' (dry run)' : ''}.`,
  );
  if (counts.error) process.exit(1);
}

if (require.main === module && !process.env.JEST_WORKER_ID) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
