/**
 * Backfill RunCostOutcome for terminal runs still queryable on the platform.
 *
 *   pnpm run backfill-run-cost-outcomes [-- --dry-run]
 */

import path from 'path';
import dotenv from 'dotenv';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { captureRunCostOutcome } from '../src/app/services/easy-genomics/run-cost-capture-service';
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

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  loadEnv();
  const laboratoryRunService = new LaboratoryRunService();

  const allRuns = await laboratoryRunService.listAllLaboratoryRuns();
  const candidates = allRuns.filter(
    (r: LaboratoryRun) =>
      isTerminalLaboratoryRunStatus(r.Status) && !!r.ExternalRunId && !r.RunCostOutcome?.CostCapturedAt,
  );
  console.log(`Found ${candidates.length} terminal run(s) missing RunCostOutcome.`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  for (const run of candidates) {
    try {
      const outcome = await captureRunCostOutcome(run);
      if (!outcome) {
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`[dry-run] Would update RunId=${run.RunId}`, outcome);
        updated++;
        continue;
      }
      await laboratoryRunService.update({
        ...run,
        RunCostOutcome: outcome,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: 'backfill-run-cost-outcomes',
      });
      updated++;
    } catch (err: any) {
      console.error(`Error RunId=${run.RunId}:`, err.message ?? err);
      errors++;
    }
  }
  console.log(`Done. Updated: ${updated}, skipped: ${skipped}, errors: ${errors}${dryRun ? ' (dry run)' : ''}.`);
  if (errors) process.exit(1);
}

main();
