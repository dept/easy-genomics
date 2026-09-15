/**
 * Backfill RunInputProfile on existing LaboratoryRun rows from InputFileKeys,
 * Settings, and SampleSheetS3Url.
 *
 *   pnpm run backfill-run-input-profiles [-- --dry-run]
 */

import path from 'path';
import dotenv from 'dotenv';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';
import { buildRunInputProfile } from '../src/app/services/easy-genomics/run-input-profile-service';

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
  const laboratoryService = new LaboratoryService();

  const allRuns = await laboratoryRunService.listAllLaboratoryRuns();
  const missing = allRuns.filter((r) => !r.RunInputProfile);
  console.log(`Found ${missing.length} run(s) without RunInputProfile (of ${allRuns.length}).`);

  let updated = 0;
  let errors = 0;
  for (const run of missing) {
    try {
      const laboratory = await laboratoryService.queryByLaboratoryId(run.LaboratoryId);
      if (!laboratory) {
        console.warn(`Skip RunId=${run.RunId}: laboratory not found`);
        continue;
      }
      const profile = await buildRunInputProfile({
        laboratory,
        inputFileKeys: run.InputFileKeys,
        sampleSheetS3Url: run.SampleSheetS3Url,
        settings: run.Settings,
      });
      if (dryRun) {
        console.log(`[dry-run] Would update RunId=${run.RunId}`, profile);
        updated++;
        continue;
      }
      await laboratoryRunService.update({
        ...run,
        RunInputProfile: profile,
        ModifiedAt: new Date().toISOString(),
        ModifiedBy: 'backfill-run-input-profiles',
      });
      updated++;
    } catch (err: any) {
      console.error(`Error RunId=${run.RunId}:`, err.message ?? err);
      errors++;
    }
  }
  console.log(`Done. Updated: ${updated}, errors: ${errors}${dryRun ? ' (dry run)' : ''}.`);
  if (errors) process.exit(1);
}

main();
