/**
 * Seeds ~12 synthetic laboratory runs (no Omics / Seqera launch) and applies the same
 * workflow→file tagging hook as create-laboratory-run, so the Data Collections page shows
 * workflow filters without incurring platform charges.
 *
 * Run from packages/back-end:
 *   pnpm run seed-workflow-tagging-test-runs -- --laboratoryId <uuid>
 *
 * Options:
 *   --laboratoryId <uuid>   Required. Lab whose bucket/prefix is used for keys.
 *   --reset                 Delete prior runs created by this script (and their workflow tags / file links), then seed.
 *   --dry-run               Log actions only; no DynamoDB or S3 writes.
 *   --keys-file <path>      JSON array of full S3 object keys (under org/lab/). Overrides S3 discovery.
 *   --user-id <uuid>        Stored as LaboratoryRun.UserId / CreatedBy (default: fixed dev UUID).
 *   --owner <email>         Stored as LaboratoryRun.Owner (default: seed-script@example.com).
 *
 * By default the script lists up to 200 objects under `${OrganizationId}/${LaboratoryId}/`
 * in the lab bucket and rotates through them for InputFileKeys. If the bucket is empty,
 * pass --keys-file with keys you care about (you can paste from the AWS console or `aws s3 ls`).
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION.
 * AWS credentials need DynamoDB PutItem/DeleteItem on laboratory-run-table and data-tagging-table (+ indexes),
 * and s3:ListBucket on the lab bucket when not using --keys-file.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { AddLaboratoryRun } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import type { WorkflowPlatform } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { associateInputsWithWorkflowTag } from '../src/app/services/easy-genomics/associate-laboratory-run-workflow-tagging';
import { LaboratoryDataTaggingService } from '../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../src/app/services/s3-service';

const DEFAULT_SCRIPT_USER_ID = '11111111-1111-4111-8111-111111111111';
const DEFAULT_OWNER = 'seed-script@example.com';

/** Stored in each run's `Settings` JSON (string) so we can find and remove seed rows later. */
const SEED_SCRIPT_SETTINGS_MARKER = 'seed-workflow-tagging-test-runs';

type Platform = 'AWS HealthOmics' | 'Seqera Cloud';

type WorkflowFixture = {
  platform: Platform;
  workflowExternalId: string;
  workflowName: string;
  workflowVersionName?: string;
  /** Number of input keys to attach from the discovered pool for this run */
  keyCount: number;
};

/** Twelve distinct workflow identities (mix of Omics + Seqera) to exercise grouping in the UI. */
const WORKFLOW_FIXTURES: WorkflowFixture[] = [
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-fetchngs',
    workflowName: 'nf-core/fetchngs',
    workflowVersionName: '1.17',
    keyCount: 2,
  },
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-rnaseq',
    workflowName: 'nf-core/rnaseq',
    workflowVersionName: '3.14.0',
    keyCount: 2,
  },
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-sarek',
    workflowName: 'nf-core/sarek',
    workflowVersionName: '3.4.2',
    keyCount: 1,
  },
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-methylseq',
    workflowName: 'nf-core/methylseq',
    keyCount: 2,
  },
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-ampliseq',
    workflowName: 'nf-core/ampliseq',
    workflowVersionName: '2.8.0',
    keyCount: 1,
  },
  {
    platform: 'Seqera Cloud',
    workflowExternalId: 'seed-seqera-pipeline-1001',
    workflowName: 'Demo RNA-seq (Seqera)',
    workflowVersionName: 'rev_1',
    keyCount: 2,
  },
  {
    platform: 'Seqera Cloud',
    workflowExternalId: 'seed-seqera-pipeline-1002',
    workflowName: 'Demo WGS (Seqera)',
    keyCount: 2,
  },
  {
    platform: 'Seqera Cloud',
    workflowExternalId: 'seed-seqera-pipeline-1003',
    workflowName: 'Demo chipseq',
    workflowVersionName: 'main',
    keyCount: 1,
  },
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-viralrecon',
    workflowName: 'nf-core/viralrecon',
    keyCount: 2,
  },
  {
    platform: 'Seqera Cloud',
    workflowExternalId: 'seed-seqera-pipeline-1004',
    workflowName: 'Demo metagenomics',
    keyCount: 2,
  },
  {
    platform: 'AWS HealthOmics',
    workflowExternalId: 'seed-omics-taxprofiler',
    workflowName: 'nf-core/taxprofiler',
    workflowVersionName: '1.1.0',
    keyCount: 1,
  },
  {
    platform: 'Seqera Cloud',
    workflowExternalId: 'seed-seqera-pipeline-1005',
    workflowName: 'Demo scrnaseq',
    workflowVersionName: 'dev',
    keyCount: 2,
  },
];

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

async function discoverKeysUnderLabPrefix(
  s3: S3Service,
  bucket: string,
  prefix: string,
  maxObjects: number,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  while (keys.length < maxObjects) {
    const page = await s3.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(1000, maxObjects - keys.length),
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    });
    for (const obj of page.Contents || []) {
      if (obj.Key && !obj.Key.endsWith('/')) {
        keys.push(obj.Key);
      }
    }
    if (!page.IsTruncated || !page.NextContinuationToken) break;
    continuationToken = page.NextContinuationToken;
  }
  return keys;
}

function pickKeysForRun(pool: string[], runIndex: number, count: number): string[] {
  if (pool.length === 0) return [];
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    out.push(pool[(runIndex * 3 + k) % pool.length]);
  }
  return [...new Set(out)];
}

function isSeedLaboratoryRun(run: LaboratoryRun): boolean {
  if (run.RunName?.startsWith('[seed] ')) {
    return true;
  }
  if (!run.Settings) {
    return false;
  }
  try {
    const parsed = JSON.parse(run.Settings) as { seededBy?: string };
    return parsed?.seededBy === SEED_SCRIPT_SETTINGS_MARKER;
  } catch {
    return false;
  }
}

function workflowIdentityDedupeKey(run: LaboratoryRun): string | null {
  if (!run.WorkflowExternalId) {
    return null;
  }
  return `${run.Platform}\t${run.WorkflowExternalId}\t${run.WorkflowVersionName ?? ''}`;
}

async function deleteExistingSeedData(args: {
  laboratory: Laboratory;
  dryRun: boolean;
  runService: LaboratoryRunService;
  tagging: LaboratoryDataTaggingService;
}): Promise<void> {
  const { laboratory, dryRun, runService, tagging } = args;
  const runs = await runService.queryByLaboratoryId(laboratory.LaboratoryId);
  const seedRuns = runs.filter(isSeedLaboratoryRun);

  if (seedRuns.length === 0) {
    console.log('No existing seed laboratory runs found for this lab (--reset).');
    return;
  }

  const seenIdentity = new Set<string>();
  const identities: {
    platform: WorkflowPlatform;
    externalId: string;
    versionName?: string;
  }[] = [];

  for (const run of seedRuns) {
    const key = workflowIdentityDedupeKey(run);
    if (!key || seenIdentity.has(key)) {
      continue;
    }
    seenIdentity.add(key);
    identities.push({
      platform: run.Platform as WorkflowPlatform,
      externalId: run.WorkflowExternalId!,
      ...(run.WorkflowVersionName !== undefined ? { versionName: run.WorkflowVersionName } : {}),
    });
  }

  if (dryRun) {
    console.log(
      `[dry-run] Would delete ${seedRuns.length} seed laboratory run(s) and remove up to ${identities.length} workflow tag(s) (by identity).`,
    );
    for (const run of seedRuns) {
      console.log(`  [dry-run] run ${run.RunId} — ${run.RunName}`);
    }
    return;
  }

  for (const id of identities) {
    const tag = await tagging.findWorkflowTagByIdentity(laboratory.LaboratoryId, id);
    if (tag) {
      console.log(`Removing workflow tag ${tag.TagId} (${id.externalId}) and its file associations…`);
      await tagging.deleteTag(laboratory.LaboratoryId, tag.TagId);
    }
  }

  for (const run of seedRuns) {
    console.log(`Deleting laboratory run ${run.RunId} — ${run.RunName}`);
    await runService.delete(run);
  }

  console.log(
    `Reset complete: removed ${seedRuns.length} seed run(s); processed ${identities.length} distinct workflow identity cleanup(es).`,
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const reset = process.argv.includes('--reset');
  const laboratoryId = getFlagValue('--laboratoryId');
  const keysFile = getFlagValue('--keys-file');
  const userId = getFlagValue('--user-id') ?? DEFAULT_SCRIPT_USER_ID;
  const owner = getFlagValue('--owner') ?? DEFAULT_OWNER;

  if (!laboratoryId) {
    console.error(
      'Usage: pnpm run seed-workflow-tagging-test-runs -- --laboratoryId <uuid> [--reset] [--dry-run] [--keys-file path.json]',
    );
    process.exit(1);
  }

  loadEnv();

  if (dryRun) {
    console.log('DRY RUN: no DynamoDB writes.\n');
  }

  const labService = new LaboratoryService();
  const runService = new LaboratoryRunService();
  const tagging = new LaboratoryDataTaggingService();
  const s3 = new S3Service();

  const laboratory = await labService.queryByLaboratoryId(laboratoryId);
  if (!laboratory.S3Bucket) {
    console.error('Laboratory has no S3Bucket configured. Set a bucket on the lab first.');
    process.exit(1);
  }

  if (reset) {
    console.log('--reset: removing prior seed runs and workflow tags for this lab…\n');
    await deleteExistingSeedData({ laboratory, dryRun, runService, tagging });
    console.log('');
  }

  const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  let keyPool: string[] = [];

  if (keysFile) {
    const raw = fs.readFileSync(path.resolve(keysFile), 'utf8');
    keyPool = JSON.parse(raw) as string[];
    if (!Array.isArray(keyPool) || !keyPool.every((k) => typeof k === 'string')) {
      console.error('--keys-file must contain a JSON array of strings (full S3 keys).');
      process.exit(1);
    }
    keyPool = keyPool.filter((k) => k.startsWith(labPrefix));
    console.log(`Loaded ${keyPool.length} key(s) from ${keysFile} (under lab prefix).`);
  } else {
    keyPool = await discoverKeysUnderLabPrefix(s3, laboratory.S3Bucket, labPrefix, 200);
    console.log(`Discovered ${keyPool.length} object key(s) under s3://${laboratory.S3Bucket}/${labPrefix}`);
  }

  if (keyPool.length === 0) {
    console.error(
      'No input keys available. Upload a few files under the lab prefix, or create a JSON file of full keys and pass --keys-file path.',
    );
    process.exit(1);
  }

  const seqeraBase = laboratory.NextFlowTowerApiBaseUrl || process.env.SEQERA_PLATFORM_API_BASE_URL || '';

  let created = 0;
  for (let i = 0; i < WORKFLOW_FIXTURES.length; i++) {
    const fx = WORKFLOW_FIXTURES[i];
    const runId = uuidv4();
    const inputKeys = pickKeysForRun(keyPool, i, fx.keyCount);
    const runName = `[seed] ${fx.workflowName} (${i + 1}/${WORKFLOW_FIXTURES.length})`;

    const addPayload: AddLaboratoryRun = {
      LaboratoryId: laboratory.LaboratoryId,
      RunId: runId,
      RunName: runName,
      Platform: fx.platform,
      ...(fx.platform === 'Seqera Cloud' && seqeraBase ? { PlatformApiBaseUrl: seqeraBase } : {}),
      Status: 'SUBMITTED',
      WorkflowName: fx.workflowName,
      ...(fx.workflowVersionName !== undefined ? { WorkflowVersionName: fx.workflowVersionName } : {}),
      WorkflowExternalId: fx.workflowExternalId,
      InputFileKeys: inputKeys,
      // Omit ExternalRunId so nothing is published to SNS / no platform polling.
      InputS3Url: `s3://${laboratory.S3Bucket}/${labPrefix}seed-runs/${runId}/input`,
      OutputS3Url: `s3://${laboratory.S3Bucket}/${labPrefix}seed-runs/${runId}/results`,
      SampleSheetS3Url: `s3://${laboratory.S3Bucket}/${labPrefix}seed-runs/${runId}/samplesheet.csv`,
      Settings: { seededBy: SEED_SCRIPT_SETTINGS_MARKER, fixtureIndex: i },
    };

    const createdAt = new Date().toISOString();
    const laboratoryRun: LaboratoryRun = {
      LaboratoryId: laboratory.LaboratoryId,
      RunId: runId,
      UserId: userId,
      OrganizationId: laboratory.OrganizationId,
      RunName: runName,
      Platform: fx.platform,
      ...(fx.platform === 'Seqera Cloud' && seqeraBase ? { PlatformApiBaseUrl: seqeraBase } : {}),
      Status: 'SUBMITTED',
      Owner: owner,
      WorkflowName: fx.workflowName,
      ...(fx.workflowVersionName !== undefined ? { WorkflowVersionName: fx.workflowVersionName } : {}),
      WorkflowExternalId: fx.workflowExternalId,
      InputFileKeys: inputKeys,
      InputS3Url: addPayload.InputS3Url,
      OutputS3Url: addPayload.OutputS3Url,
      SampleSheetS3Url: addPayload.SampleSheetS3Url,
      Settings: JSON.stringify(addPayload.Settings || {}),
      CreatedAt: createdAt,
      CreatedBy: userId,
    };

    if (dryRun) {
      console.log(`[dry-run] Would create run ${runId}:`, {
        runName,
        platform: fx.platform,
        workflowExternalId: fx.workflowExternalId,
        inputKeys,
      });
      created++;
      continue;
    }

    await runService.add(laboratoryRun);
    await associateInputsWithWorkflowTag({
      laboratory,
      userId,
      request: addPayload,
      tagging,
    });
    console.log(`Created run ${runId} (${fx.workflowName}) → tagged ${inputKeys.length} file(s)`);
    created++;
  }

  console.log(`\nDone. ${dryRun ? 'Would create' : 'Created'} ${created} laboratory run(s).`);
  console.log(
    'Open Data Collections for this lab to see workflow filters. Use --reset on the next run to remove prior seed runs and workflow tags before re-seeding.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
