/**
 * One-off script to add tags to existing AWS HealthOmics runs using the
 * laboratory-run table as the source of truth. Tags match those set by
 * create-run-execution; WorkflowId is set from the table’s ExternalRunId column.
 *
 * Run from packages/back-end:
 *   pnpm run backfill-omics-run-tags [-- --dry-run]
 *
 * Options:
 *   --dry-run   Log what would be tagged without calling Omics.
 *
 * Requires .env.local (or env) with: NAME_PREFIX, ACCOUNT_ID, REGION.
 * Uses default AWS credentials. Your identity needs:
 *   - dynamodb:Scan on the laboratory-run table
 *   - omics:TagResource on run resources in the same account/region
 */

import path from 'path';
import dotenv from 'dotenv';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { OmicsService } from '../src/app/services/omics-service';

const AWS_HEALTH_OMICS_PLATFORM = 'AWS HealthOmics';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  dotenv.config({ path: envPath });
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }
  const required = ['NAME_PREFIX', 'ACCOUNT_ID', 'REGION'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}. Set in .env.local or environment.`);
    process.exit(1);
  }
}

function getRunArn(runId: string): string {
  const account = process.env.ACCOUNT_ID;
  const region = process.env.REGION;
  if (!account || !region) throw new Error('ACCOUNT_ID and REGION must be set');
  return `arn:aws:omics:${region}:${account}:run/${runId}`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('DRY RUN: no tags will be applied.\n');
  }

  loadEnv();

  const laboratoryRunService = new LaboratoryRunService();
  const omicsService = new OmicsService();

  console.log('Scanning laboratory-run table for AWS HealthOmics runs with ExternalRunId...');
  const allRuns = await laboratoryRunService.listAllLaboratoryRuns();
  const toTag = allRuns.filter(
    (r: LaboratoryRun) =>
      r.Platform === AWS_HEALTH_OMICS_PLATFORM && r.ExternalRunId != null && r.ExternalRunId.trim() !== '',
  );
  console.log(`Found ${toTag.length} AWS HealthOmics run(s) to tag (of ${allRuns.length} total).\n`);

  let tagged = 0;
  let skipped = 0;
  let errors = 0;

  for (const run of toTag) {
    const runId = run.ExternalRunId!;
    const resourceArn = getRunArn(runId);
    const tags: Record<string, string> = {
      LaboratoryId: run.LaboratoryId,
      OrganizationId: run.OrganizationId,
      WorkflowId: run.ExternalRunId || '',
      RunName: run.RunName,
      ...(run.UserId && { UserId: run.UserId }),
      ...(run.Owner && { UserEmail: run.Owner }),
      Application: 'easy-genomics',
      Platform: 'AWS HealthOmics',
    };

    if (dryRun) {
      console.log(`[dry-run] Would tag run ${runId}:`, tags);
      tagged++;
      continue;
    }

    try {
      await omicsService.tagResource({
        resourceArn,
        tags,
      });
      console.log(`Tagged run ${runId}:`, Object.keys(tags).join(', '));
      tagged++;
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException' || err.$metadata?.httpStatusCode === 404) {
        console.warn(`Skip (run not found in Omics): ${runId}`);
        skipped++;
      } else {
        console.error(`Error tagging run ${runId}:`, err.message ?? err);
        errors++;
      }
    }
  }

  console.log(
    `\nDone. Tagged: ${tagged}, skipped (not found): ${skipped}, errors: ${errors}${dryRun ? ' (dry run)' : ''}.`,
  );
  if (errors > 0) {
    process.exit(1);
  }
}

main();
