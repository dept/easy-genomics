/**
 * One-time, idempotent backfill for two attributes that the run-completion-notification feature
 * depends on but that pre-existing rows in the laboratory-run table won't have. Run once before
 * deploying this feature.
 *
 * Pass 1 — PollStatus: sets `PollStatus='ACTIVE'` onto every currently non-terminal run that
 * predates the PollStatus GSI. Without this, a run already in flight at deploy time is invisible
 * to `process-poll-active-runs` until its next natural status-change write sets the attribute
 * itself.
 *
 * Pass 2 — NotifiedAt: stamps `NotifiedAt` onto every currently terminal run that predates the
 * notification feature. Without this, `process-update-laboratory-run.lambda.ts`'s backfill
 * healing branch (which also heals a terminal run missing `NotifiedAt`) would treat every
 * pre-existing terminal run as "never notified" the next time it's touched — which happens
 * routinely, since `request-laboratory-run-status-check.lambda.ts`'s duration-backfill trigger
 * fires whenever the front-end loads an old run missing `RunDurationSeconds`. That would fire a
 * burst of "your run finished" emails for runs that may have finished months ago. Stamping
 * `NotifiedAt` here up front means the healing branch finds nothing to heal for any run that
 * already existed before this migration ran, and only genuinely new stranded runs (created after
 * this script runs) can ever trigger it.
 *
 * Both passes are idempotent — re-runs simply re-set the same value on runs that still qualify.
 *
 * Run from packages/back-end:
 *   pnpm exec esrun scripts/backfill-laboratory-run-attributes.ts [-- --dry-run] [--lab <laboratoryId>]
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

  // Pass 1: non-terminal runs missing PollStatus.
  const pollStatusCandidates = allRuns.filter(
    (r: LaboratoryRun) =>
      !isTerminalLaboratoryRunStatus(r.Status) &&
      r.PollStatus !== 'ACTIVE' &&
      (!labFilter || r.LaboratoryId === labFilter),
  );
  console.log(
    `Found ${pollStatusCandidates.length} non-terminal run(s) missing PollStatus (of ${allRuns.length} total).\n`,
  );

  let pollStatusPatched = 0;
  let pollStatusErrors = 0;

  for (const run of pollStatusCandidates) {
    if (dryRun) {
      console.log(`  [dry-run] Would set PollStatus=ACTIVE on run ${run.RunId} (lab ${run.LaboratoryId})`);
      pollStatusPatched++;
      continue;
    }
    try {
      await runService.update({ ...run, PollStatus: 'ACTIVE' as const });
      pollStatusPatched++;
    } catch (err) {
      console.error(`  Error patching PollStatus for run ${run.RunId}:`, (err as Error).message ?? err);
      pollStatusErrors++;
    }
  }

  // Pass 2: terminal runs missing NotifiedAt.
  const notifiedAtCandidates = allRuns.filter(
    (r: LaboratoryRun) =>
      isTerminalLaboratoryRunStatus(r.Status) && r.NotifiedAt == null && (!labFilter || r.LaboratoryId === labFilter),
  );
  console.log(
    `Found ${notifiedAtCandidates.length} terminal run(s) missing NotifiedAt (of ${allRuns.length} total).\n`,
  );

  let notifiedAtPatched = 0;
  let notifiedAtErrors = 0;

  for (const run of notifiedAtCandidates) {
    // Sentinel value is never surfaced to a user — it only needs to make `NotifiedAt == null`
    // false so the notification healing branch leaves this run alone. Prefer ModifiedAt (the
    // best available approximation of when the run actually went terminal), then CreatedAt,
    // then "now" as a last resort for rows missing both.
    const notifiedAtSentinel = run.ModifiedAt ?? run.CreatedAt ?? new Date().toISOString();

    if (dryRun) {
      console.log(
        `  [dry-run] Would set NotifiedAt=${notifiedAtSentinel} on run ${run.RunId} (lab ${run.LaboratoryId})`,
      );
      notifiedAtPatched++;
      continue;
    }
    try {
      await runService.update({ ...run, NotifiedAt: notifiedAtSentinel });
      notifiedAtPatched++;
    } catch (err) {
      console.error(`  Error patching NotifiedAt for run ${run.RunId}:`, (err as Error).message ?? err);
      notifiedAtErrors++;
    }
  }

  const verb = dryRun ? 'Would have patched' : 'Patched';
  console.log(`\nDone.`);
  console.log(`  PollStatus:  ${verb} ${pollStatusPatched} run(s), errors: ${pollStatusErrors}.`);
  console.log(`  NotifiedAt:  ${verb} ${notifiedAtPatched} run(s), errors: ${notifiedAtErrors}.`);
  if (pollStatusErrors > 0 || notifiedAtErrors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
