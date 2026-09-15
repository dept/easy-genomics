/**
 * One-off script to rewrite laboratory and laboratory-run DynamoDB fields after a lab
 * S3 bucket migration (e.g. stack split where objects were synced to NEW_LAB_BUCKET but
 * historical records still reference OLD_LAB_BUCKET in s3:// URIs).
 *
 * Run from packages/back-end (after Phase 3.5 object sync):
 *   pnpm tsx scripts/migrate-lab-s3-bucket-refs.ts \
 *     --oldBucket <physical-old-bucket> \
 *     --newBucket <physical-new-bucket> \
 *     [--dry-run]
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION.
 * Uses default AWS credentials (dynamodb:Scan, dynamodb:UpdateItem, dynamodb:PutItem).
 */

import path from 'path';
import dotenv from 'dotenv';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { S3_URI_FIELDS, rewriteLaboratoryRun } from './lib/lab-s3-uri-migration';
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';

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

  const oldBucket = argValue('--oldBucket');
  const newBucket = argValue('--newBucket');
  const dryRun = process.argv.includes('--dry-run');

  if (!oldBucket || !newBucket) {
    console.error(
      'Usage: pnpm tsx scripts/migrate-lab-s3-bucket-refs.ts --oldBucket <name> --newBucket <name> [--dry-run]',
    );
    process.exit(1);
  }
  if (oldBucket === newBucket) {
    console.error('--oldBucket and --newBucket must differ.');
    process.exit(1);
  }

  if (dryRun) console.log('DRY RUN: no DynamoDB records will be modified.\n');

  const laboratoryService = new LaboratoryService();
  const laboratoryRunService = new LaboratoryRunService();

  console.log(`Rewriting S3 bucket host: ${oldBucket} -> ${newBucket}\n`);

  const laboratories = await laboratoryService.listAllLaboratories();
  let labsUpdated = 0;
  for (const lab of laboratories) {
    if (lab.S3Bucket !== oldBucket) continue;
    const updated: Laboratory = { ...lab, S3Bucket: newBucket };
    if (dryRun) {
      console.log(`[dry-run] Laboratory ${lab.LaboratoryId}: S3Bucket ${oldBucket} -> ${newBucket}`);
    } else {
      const existing = await laboratoryService.get(lab.OrganizationId, lab.LaboratoryId);
      await laboratoryService.update(updated, existing);
      console.log(`Updated laboratory ${lab.LaboratoryId} S3Bucket`);
    }
    labsUpdated++;
  }

  const allRuns = await laboratoryRunService.listAllLaboratoryRuns();
  let runsUpdated = 0;
  let runsSkipped = 0;

  for (const run of allRuns) {
    const updated = rewriteLaboratoryRun(run, oldBucket, newBucket);
    if (!updated) {
      runsSkipped++;
      continue;
    }
    if (dryRun) {
      const fields = S3_URI_FIELDS.filter((f) => run[f] !== updated[f]);
      console.log(
        `[dry-run] Run ${run.RunId} (lab ${run.LaboratoryId}): ${fields.map((f) => `${f}=${updated[f]}`).join(', ')}`,
      );
    } else {
      await laboratoryRunService.update(updated);
      console.log(`Updated run ${run.RunId} (lab ${run.LaboratoryId})`);
    }
    runsUpdated++;
  }

  console.log(
    `\nDone. Laboratories updated: ${labsUpdated}. Runs updated: ${runsUpdated}. Runs unchanged: ${runsSkipped}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
