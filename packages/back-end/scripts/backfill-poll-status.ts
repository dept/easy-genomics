/**
 * Backfill `PollStatus='ACTIVE'` onto every currently non-terminal run that predates the
 * PollStatus GSI. Without this, a run already in flight at deploy time is invisible to
 * `process-poll-active-runs` until its next natural status-change write sets the attribute
 * itself — this script closes that one-time gap.
 *
 * Idempotent — re-runs simply re-set the same value on runs that still qualify.
 *
 * Run from packages/back-end:
 *   pnpm exec esrun scripts/backfill-poll-status.ts [-- --dry-run] [--lab <laboratoryId>]
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION.
 */

import path from 'path';
import dotenv from 'dotenv';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { isTerminalLaboratoryRunStatus } from '../src/app/utils/laboratory-run-ttl-utils';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  dotenv.config({ path: envPath });
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }
  const required = ['NAME_PREFIX', 'REGION'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}. Set in .env.local or environment.`);
    process.exit(1);
  }
}

function getFlagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const labFilter = getFlagValue('--lab');

  loadEnv();
  if (dryRun) console.log('DRY RUN: no DynamoDB writes will be performed.\n');

  const runService = new LaboratoryRunService();

  console.log('Scanning laboratory-run table...');
  const allRuns = await runService.listAllLaboratoryRuns();
  const candidates = allRuns.filter(
    (r: LaboratoryRun) =>
      !isTerminalLaboratoryRunStatus(r.Status) &&
      r.PollStatus !== 'ACTIVE' &&
      (!labFilter || r.LaboratoryId === labFilter),
  );
  console.log(`Found ${candidates.length} non-terminal run(s) missing PollStatus (of ${allRuns.length} total).\n`);

  let patched = 0;
  let errors = 0;

  for (const run of candidates) {
    if (dryRun) {
      console.log(`  [dry-run] Would set PollStatus=ACTIVE on run ${run.RunId} (lab ${run.LaboratoryId})`);
      patched++;
      continue;
    }
    try {
      await runService.update({ ...run, PollStatus: 'ACTIVE' as const });
      patched++;
    } catch (err) {
      console.error(`  Error patching PollStatus for run ${run.RunId}:`, (err as Error).message ?? err);
      errors++;
    }
  }

  console.log(`\nDone. ${dryRun ? 'Would have patched' : 'Patched'} ${patched} run(s), errors: ${errors}.`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
