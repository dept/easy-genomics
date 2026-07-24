/**
 * One-time batched Cost Explorer pull for runs with RunId tags.
 * Prefer the daily process-sync-run-costs Lambda for ongoing sync.
 *
 *   pnpm run backfill-billed-costs [-- --dry-run] [-- --max-age-days=90]
 */

import path from 'path';
import dotenv from 'dotenv';
import { RunCostSyncService } from '../src/app/services/easy-genomics/run-cost-sync-service';

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
  const maxAgeArg = process.argv.find((a) => a.startsWith('--max-age-days='));
  const maxAgeDays = maxAgeArg ? parseInt(maxAgeArg.split('=')[1], 10) : 90;
  loadEnv();

  if (dryRun) {
    console.log('DRY RUN: would sync billed costs via Cost Explorer (no writes simulated beyond service call).\n');
  }

  const sync = new RunCostSyncService();
  const result = await sync.syncRecentTerminalRuns({ minAgeDays: 1, maxAgeDays });
  console.log('Sync result:', result);
  if (dryRun) {
    console.log(
      '(Note: dry-run still reads CE; DynamoDB updates are performed by sync service — use a read-only role if needed.)',
    );
  }
}

main();
