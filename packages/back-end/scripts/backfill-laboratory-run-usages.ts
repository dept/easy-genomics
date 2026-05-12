/**
 * Backfill the per-file `LaboratoryRunUsages` map on the laboratory data tagging table from the
 * existing `LaboratoryRun` records. Each historical run with non-empty `InputFileKeys` produces
 * one idempotent entry per (RunId, file) so the data collections "Analysis History" tooltip can
 * surface runs that pre-date the file-history feature.
 *
 * Run from packages/back-end:
 *   pnpm exec esrun scripts/backfill-laboratory-run-usages.ts [-- --dry-run] [--lab <laboratoryId>]
 *
 * Options:
 *   --dry-run            Print what would be recorded without writing to DynamoDB.
 *   --lab <id>           Limit the backfill to a single laboratory id (optional).
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION. Uses default AWS credentials; your
 * identity needs DynamoDB read/write on the laboratory data tagging table.
 */

import path from 'path';
import dotenv from 'dotenv';
import type { LaboratoryRunUsageSummary } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryDataTaggingService } from '../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';

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

const DEFAULT_SCRIPT_USER_ID = '00000000-0000-4000-8000-000000000000';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const labFilter = getFlagValue('--lab');

  loadEnv();

  if (dryRun) {
    console.log('DRY RUN: no DynamoDB writes will be performed.\n');
  }

  const runService = new LaboratoryRunService();
  const laboratoryService = new LaboratoryService();
  const tagging = new LaboratoryDataTaggingService();

  console.log('Scanning laboratory-run table...');
  const allRuns = await runService.listAllLaboratoryRuns();
  const candidateRuns = allRuns.filter(
    (r: LaboratoryRun) =>
      Array.isArray(r.InputFileKeys) && r.InputFileKeys.some((k) => typeof k === 'string' && k.length > 0),
  );
  console.log(
    `Found ${candidateRuns.length} laboratory run(s) with InputFileKeys (of ${allRuns.length} total run rows).\n`,
  );

  const runsByLab = new Map<string, LaboratoryRun[]>();
  for (const run of candidateRuns) {
    if (labFilter && run.LaboratoryId !== labFilter) continue;
    const list = runsByLab.get(run.LaboratoryId) ?? [];
    list.push(run);
    runsByLab.set(run.LaboratoryId, list);
  }

  if (runsByLab.size === 0) {
    console.log(
      labFilter
        ? `No runs with InputFileKeys for laboratory ${labFilter}.`
        : 'No runs with InputFileKeys found in any laboratory.',
    );
    return;
  }

  let totalRecorded = 0;
  let skipped = 0;
  let errors = 0;

  for (const [laboratoryId, runs] of runsByLab) {
    let laboratory: Laboratory;
    try {
      laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    } catch (err) {
      console.warn(`Skip lab ${laboratoryId}: failed to load laboratory record (${(err as Error).message ?? err}).`);
      skipped += runs.length;
      continue;
    }
    if (!laboratory.S3Bucket) {
      console.warn(`Skip lab ${laboratoryId}: no S3Bucket configured.`);
      skipped += runs.length;
      continue;
    }

    const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    console.log(`Lab ${laboratoryId} (${laboratory.S3Bucket}): ${runs.length} run(s)`);

    for (const run of runs) {
      const inputKeys = (run.InputFileKeys || []).filter(
        (k: string): k is string => typeof k === 'string' && k.length > 0,
      );
      const labScopedKeys = inputKeys.filter((k) => k.startsWith(labPrefix));
      if (!labScopedKeys.length) {
        skipped++;
        continue;
      }

      const summary: LaboratoryRunUsageSummary = {
        RunId: run.RunId,
        RunName: run.RunName,
        ...(run.WorkflowName?.trim() ? { WorkflowName: run.WorkflowName.trim() } : {}),
        RunCreatedAt: run.CreatedAt ?? new Date(0).toISOString(),
        InputFileCount: labScopedKeys.length,
        InputFileKeys: labScopedKeys,
      };

      if (dryRun) {
        console.log(
          `  [dry-run] Would record run ${run.RunId} (${summary.RunName}) for ${labScopedKeys.length} file(s)`,
        );
        totalRecorded++;
        continue;
      }

      try {
        await tagging.recordLaboratoryRunInputUsage(
          laboratory,
          run.CreatedBy ?? run.UserId ?? DEFAULT_SCRIPT_USER_ID,
          laboratory.S3Bucket as string,
          labScopedKeys,
          summary,
        );
        totalRecorded++;
      } catch (err) {
        console.error(`  Error recording run ${run.RunId}:`, (err as Error).message ?? err);
        errors++;
      }
    }
  }

  console.log(
    `\nDone. ${dryRun ? 'Would have recorded' : 'Recorded'} ${totalRecorded} run(s), skipped ${skipped}, errors: ${errors}.`,
  );
  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
