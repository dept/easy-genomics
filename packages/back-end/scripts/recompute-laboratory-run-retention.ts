/**
 * One-off script to recompute TTL metadata on `laboratory-run-table` for a single lab.
 *
 * It sets `TerminalAt` for terminal runs if missing, and sets/removes `ExpiresAt`
 * based on a supplied retention policy:
 * - 0 = never delete (REMOVE ExpiresAt)
 * - N > 0 = expires N months after TerminalAt
 *
 * Run from packages/back-end:
 *   pnpm tsx scripts/recompute-laboratory-run-retention.ts --laboratoryId <uuid> --retentionMonths <int> [--dry-run]
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION.
 */

import path from 'path';
import dotenv from 'dotenv';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  getTerminalAtIsoString,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '../src/app/utils/laboratory-run-ttl-utils';

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

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  loadEnv();

  const laboratoryId = argValue('--laboratoryId');
  const retentionRaw = argValue('--retentionMonths');
  const dryRun = process.argv.includes('--dry-run');

  if (!laboratoryId) {
    console.error('Missing --laboratoryId <uuid>');
    process.exit(1);
  }
  if (retentionRaw == null) {
    console.error('Missing --retentionMonths <int>');
    process.exit(1);
  }

  const retentionMonths = getRetentionMonthsOrDefault(Number(retentionRaw));
  const shouldExpire = shouldExpireWithRetentionMonths(retentionMonths);
  if (dryRun) console.log('DRY RUN: no records will be modified.\n');

  const service = new LaboratoryRunService();
  const runs: LaboratoryRun[] = await service.queryByLaboratoryId(laboratoryId);
  const terminalRuns = runs.filter((r) => isTerminalLaboratoryRunStatus(r.Status));

  console.log(
    `Lab ${laboratoryId}: ${terminalRuns.length} terminal run(s) (of ${runs.length} total). Applying retentionMonths=${retentionMonths}.\n`,
  );

  let updated = 0;
  let removed = 0;
  let skipped = 0;

  for (const run of terminalRuns) {
    const now = new Date();
    const terminalAtIso = getTerminalAtIsoString(run, now);
    const desiredExpiresAt = shouldExpire
      ? calculateExpiresAtEpochSeconds(new Date(terminalAtIso), retentionMonths)
      : undefined;

    const needsTerminalAt = run.TerminalAt == null;
    const needsExpiresAtSet = shouldExpire && run.ExpiresAt !== desiredExpiresAt;
    const needsExpiresAtRemove = !shouldExpire && run.ExpiresAt != null;

    if (!needsTerminalAt && !needsExpiresAtSet && !needsExpiresAtRemove) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry-run] RunId=${run.RunId} TerminalAt=${needsTerminalAt ? terminalAtIso : run.TerminalAt} ` +
          (needsExpiresAtRemove ? `REMOVE ExpiresAt` : needsExpiresAtSet ? `SET ExpiresAt=${desiredExpiresAt}` : ''),
      );
      skipped++;
      continue;
    }

    await service.updateRetentionMetadata({
      LaboratoryId: run.LaboratoryId,
      RunId: run.RunId,
      set: {
        ...(needsTerminalAt ? { TerminalAt: terminalAtIso } : {}),
        ...(needsExpiresAtSet && desiredExpiresAt != null ? { ExpiresAt: desiredExpiresAt } : {}),
        ModifiedAt: now.toISOString(),
        ModifiedBy: 'Run Retention Recompute',
      },
      remove: needsExpiresAtRemove ? ['ExpiresAt'] : [],
    });

    if (needsExpiresAtRemove) removed++;
    if (needsTerminalAt || needsExpiresAtSet) updated++;
  }

  console.log(
    `\nDone. Updated: ${updated}, removed ExpiresAt: ${removed}, skipped: ${skipped}${dryRun ? ' (dry run)' : ''}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
