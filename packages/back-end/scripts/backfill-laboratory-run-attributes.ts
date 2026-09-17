/**
 * One-time, idempotent backfill for laboratory-run attributes that pre-existing rows
 * may be missing or still carrying after schema changes. Run once before/with deploying
 * the related feature.
 *
 * Pass 1 — CurrentProcessName: REMOVEs the legacy `CurrentProcessName` attribute from
 * every run that still has it. The field was dropped from LaboratoryRunSchema (.strict()),
 * so leaving it on DynamoDB items causes get-then-update callers to fail validation and
 * would keep surfacing an unintelligible process name if anything still read it.
 *
 * Pass 2 — PollStatus: sets `PollStatus='ACTIVE'` onto every currently non-terminal run that
 * predates the PollStatus GSI. Without this, a run already in flight at deploy time is invisible
 * to `process-poll-active-runs` until its next natural status-change write sets the attribute
 * itself.
 *
 * Pass 3 — NotifiedAt: stamps `NotifiedAt` onto every currently terminal run that predates the
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
 * All passes are idempotent — re-runs skip rows that no longer qualify.
 *
 * Run from packages/back-end:
 *   pnpm exec esrun scripts/backfill-laboratory-run-attributes.ts [-- --dry-run] [--lab <laboratoryId>]
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION.
 */

import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { isTerminalLaboratoryRunStatus } from '../src/app/utils/laboratory-run-ttl-utils';
import { loadDotEnvAndReconcileRegion } from './lib/load-env';

/** Legacy attribute removed from LaboratoryRunSchema; still present on some DynamoDB items. */
const LEGACY_CURRENT_PROCESS_NAME = 'CurrentProcessName';

type LaboratoryRunWithLegacy = LaboratoryRun & { CurrentProcessName?: string };

function loadEnv(): void {
  loadDotEnvAndReconcileRegion();
  const required = ['NAME_PREFIX', 'REGION'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}. Set in .env.local or environment.`);
  }
}

function getFlagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  return undefined;
}

/** Strip schema-removed legacy attrs so SET-only updates pass LaboratoryRunSchema.strict(). */
function withoutLegacyAttributes(run: LaboratoryRun): LaboratoryRun {
  const cleaned = { ...run } as LaboratoryRunWithLegacy;
  delete cleaned.CurrentProcessName;
  return cleaned;
}

function hasLegacyCurrentProcessName(run: LaboratoryRun): boolean {
  return Object.prototype.hasOwnProperty.call(run, LEGACY_CURRENT_PROCESS_NAME);
}

export async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const labFilter = getFlagValue('--lab');

  loadEnv();
  if (dryRun) console.log('DRY RUN: no DynamoDB writes will be performed.\n');

  const runService = new LaboratoryRunService();

  console.log('Scanning laboratory-run table...');
  let allRuns: LaboratoryRun[];
  try {
    allRuns = await runService.listAllLaboratoryRuns();
  } catch (err: any) {
    // Fresh/greenfield deploy: laboratory-run table may not exist yet.
    if (err?.name === 'ResourceNotFoundException' || err?.__type?.includes('ResourceNotFoundException')) {
      console.log('Laboratory-run table not found; nothing to backfill.');
      return;
    }
    throw err;
  }

  // Pass 1: REMOVE legacy CurrentProcessName (must run before SET-only passes that
  // would otherwise re-read in-memory objects still carrying the attribute).
  const currentProcessNameCandidates = allRuns.filter(
    (r: LaboratoryRun) => hasLegacyCurrentProcessName(r) && (!labFilter || r.LaboratoryId === labFilter),
  );
  console.log(
    `Found ${currentProcessNameCandidates.length} run(s) with legacy CurrentProcessName (of ${allRuns.length} total).\n`,
  );

  let currentProcessNamePatched = 0;
  let currentProcessNameErrors = 0;

  for (const run of currentProcessNameCandidates) {
    if (dryRun) {
      console.log(`  [dry-run] Would REMOVE CurrentProcessName on run ${run.RunId} (lab ${run.LaboratoryId})`);
      currentProcessNamePatched++;
      continue;
    }
    try {
      await runService.updateWithAttributeRemoval(withoutLegacyAttributes(run), [LEGACY_CURRENT_PROCESS_NAME]);
      currentProcessNamePatched++;
      // Keep later passes from spreading the legacy attr off the in-memory scan result.
      delete (run as LaboratoryRunWithLegacy).CurrentProcessName;
    } catch (err) {
      console.error(`  Error removing CurrentProcessName for run ${run.RunId}:`, (err as Error).message ?? err);
      currentProcessNameErrors++;
    }
  }

  // Pass 2: non-terminal runs missing PollStatus.
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
      await runService.update({ ...withoutLegacyAttributes(run), PollStatus: 'ACTIVE' as const });
      pollStatusPatched++;
    } catch (err) {
      console.error(`  Error patching PollStatus for run ${run.RunId}:`, (err as Error).message ?? err);
      pollStatusErrors++;
    }
  }

  // Pass 3: terminal runs missing NotifiedAt.
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
      await runService.update({ ...withoutLegacyAttributes(run), NotifiedAt: notifiedAtSentinel });
      notifiedAtPatched++;
    } catch (err) {
      console.error(`  Error patching NotifiedAt for run ${run.RunId}:`, (err as Error).message ?? err);
      notifiedAtErrors++;
    }
  }

  const verb = dryRun ? 'Would have patched' : 'Patched';
  console.log(`\nDone.`);
  console.log(
    `  CurrentProcessName: ${verb} ${currentProcessNamePatched} run(s), errors: ${currentProcessNameErrors}.`,
  );
  console.log(`  PollStatus:          ${verb} ${pollStatusPatched} run(s), errors: ${pollStatusErrors}.`);
  console.log(`  NotifiedAt:          ${verb} ${notifiedAtPatched} run(s), errors: ${notifiedAtErrors}.`);
  if (currentProcessNameErrors > 0 || pollStatusErrors > 0 || notifiedAtErrors > 0) {
    throw new Error(
      `backfill-laboratory-run-attributes failed: ${currentProcessNameErrors} CurrentProcessName error(s), ` +
        `${pollStatusErrors} PollStatus error(s), ${notifiedAtErrors} NotifiedAt error(s).`,
    );
  }
}

// Auto-run only when this file is the actual CLI entry point — not when it's imported as a
// dependency (registry.ts statically imports `main` for run-deploy-migrations.ts) or under Jest.
if (require.main === module && !process.env.JEST_WORKER_ID) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
