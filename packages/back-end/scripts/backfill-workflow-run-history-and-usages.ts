/**
 * Retroactive backfill for the Data Collections "Analysis History" tooltip and per-file
 * workflow→file tag links, for laboratory runs created before the file-history feature was
 * tracking `InputFileKeys` and `WorkflowExternalId` automatically.
 *
 * For each candidate `LaboratoryRun` row this script:
 *   1. Resolves `InputFileKeys` (lab-scoped) from, in order: the row itself, the
 *      `SampleSheetS3Url` object body, an S3 URL discovered in `Settings.input` (or other
 *      sample-sheet-like fields), and optionally a guarded `ListObjectsV2` under an input
 *      prefix when `--list-input-prefix` is supplied. Keys discovered from multiple sources
 *      are merged and de-duplicated; only keys under `${OrganizationId}/${LaboratoryId}/`
 *      are kept.
 *   2. Resolves `WorkflowExternalId` (and `WorkflowVersionName`) when missing: for AWS
 *      HealthOmics, via `omics:GetRun(ExternalRunId)`; for Seqera Cloud, via
 *      `GET /workflow/{ExternalRunId}` using the lab's stored access token. Seqera does not
 *      expose a stable platform pipeline id on the describe-workflow response, so version is
 *      patched best-effort from `workflow.revision` (when present) and the external id is
 *      only patched if it can be derived without ambiguity (typically: not).
 *   3. Optionally writes the enriched fields back to the laboratory-run row via the internal
 *      `LaboratoryRunService.update` (the public Edit API does not accept these fields).
 *   4. Invokes `associateInputsWithWorkflowTag` so the tagging table receives the same
 *      `recordLaboratoryRunInputUsage` + workflow file links that new runs get at create time.
 *      All tagging writes are idempotent (see `recordLaboratoryRunInputUsage` /
 *      `getOrCreateWorkflowTag`).
 *
 * Run from packages/back-end:
 *   pnpm run backfill-workflow-run-history-and-usages
 *   pnpm run backfill-workflow-run-history-and-usages:dry-run
 *   pnpm run backfill-workflow-run-history-and-usages -- --lab <laboratoryId>
 *
 * Options:
 *   --dry-run                       Print what would change without writing to DynamoDB / S3 / platforms.
 *   --lab <laboratoryId>            Limit the backfill to a single laboratory id.
 *   --platform <name>               Filter by `LaboratoryRun.Platform` (e.g. `AWS HealthOmics` or `Seqera Cloud`).
 *   --limit <n>                     Process at most N runs (useful for staged rollouts).
 *   --force-reassociate             Re-run tagging for rows that already have lab-scoped InputFileKeys.
 *                                   Safe because tagging writes are idempotent.
 *   --skip-run-table-update         Don't write inferred fields back to the laboratory-run row;
 *                                   only update the tagging table via association.
 *   --list-input-prefix             Allow ListObjectsV2 fallback when no sample sheet is available
 *                                   but `Settings.input` resolves to a lab-scoped prefix. Off by default.
 *   --max-list-keys <n>             Maximum keys to pull when --list-input-prefix is on (default: 200).
 *   --include-no-platform-keys      Treat keys outside the lab prefix as eligible (off by default; only
 *                                   here for environments where S3Bucket history is unusual). Not
 *                                   recommended in production.
 *   --omics-use-default-credentials Call HealthOmics `GetRun` with the default AWS credential chain
 *                                   instead of STS AssumeRole into `${NAME_PREFIX}-easy-genomics-omics-access-role`.
 *                                   Use for local/admin runs when you have `omics:GetRun` but cannot assume the lab role.
 *
 * Requires .env.local (or env) with: NAME_PREFIX, REGION, and `ACCOUNT_ID` when Omics workflow lookup uses
 * STS AssumeRole (omit `ACCOUNT_ID` only if you pass `--omics-use-default-credentials` for Omics runs).
 * Set `SEQERA_API_BASE_URL` when any Seqera-platform runs may be inspected without a per-lab
 * `NextFlowTowerApiBaseUrl`.
 *
 * IAM:
 *   - DynamoDB: Scan + UpdateItem on `${NAME_PREFIX}-laboratory-run-table`; Get/Query on
 *     `${NAME_PREFIX}-laboratory-table`; UpdateItem on the laboratory data tagging table.
 *   - S3:   GetObject on the lab bucket and on any bucket referenced by `SampleSheetS3Url` / `Settings`
 *     (sample sheets often live in a separate provisioning bucket); ListBucket if `--list-input-prefix`.
 *   - Omics: omics:GetRun via STS AssumeRole (`createOmicsServiceForLab`) unless `--omics-use-default-credentials`.
 *   - SSM:  GetParameter (with decryption) for Seqera labs' access token.
 */

import path from 'path';
import dotenv from 'dotenv';
import { GetRunCommandInput, GetRunCommandOutput } from '@aws-sdk/client-omics';
import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { extractS3KeysFromCsv } from '@easy-genomics/shared-lib/src/app/utils/sample-sheet-s3-keys';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { DescribeWorkflowResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import { associateInputsWithWorkflowTag } from '../src/app/services/easy-genomics/associate-laboratory-run-workflow-tagging';
import { LaboratoryDataTaggingService } from '../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratoryRunService } from '../src/app/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';
import { createOmicsServiceForLab } from '../src/app/services/omics-lab-factory';
import { OmicsService } from '../src/app/services/omics-service';
import { S3Service } from '../src/app/services/s3-service';
import { SsmService } from '../src/app/services/ssm-service';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '../src/app/utils/rest-api-utils';

type Platform = LaboratoryRun['Platform'];

const AWS_HEALTH_OMICS: Platform = 'AWS HealthOmics';
const SEQERA_CLOUD: Platform = 'Seqera Cloud';

const DEFAULT_SCRIPT_USER_ID = '00000000-0000-4000-8000-000000000000';
const BACKFILL_MODIFIED_BY = 'backfill-workflow-run-history-and-usages';

/** Source labels surfaced in the run summary; useful for understanding coverage in the log. */
type KeySource = 'row' | 'sampleSheet' | 'settingsInput' | 'listInputPrefix';

interface Flags {
  dryRun: boolean;
  labFilter?: string;
  platformFilter?: Platform;
  limit?: number;
  forceReassociate: boolean;
  skipRunTableUpdate: boolean;
  allowListInputPrefix: boolean;
  maxListKeys: number;
  includeNonLabPrefixKeys: boolean;
  /** When true, Omics `GetRun` uses default credentials instead of STS lab role (local/admin). */
  omicsUseDefaultCredentials: boolean;
}

interface RunOutcome {
  runId: string;
  laboratoryId: string;
  platform: Platform;
  keySources: KeySource[];
  keyCount: number;
  workflowResolved: boolean;
  runRowUpdated: boolean;
  associated: boolean;
  skipReason?: string;
  error?: string;
}

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

function parseFlags(): Flags {
  const platformRaw = getFlagValue('--platform');
  let platformFilter: Platform | undefined;
  if (platformRaw) {
    if (platformRaw === AWS_HEALTH_OMICS || platformRaw === SEQERA_CLOUD) {
      platformFilter = platformRaw;
    } else {
      console.error(
        `Unsupported --platform value: ${platformRaw}. Expected "${AWS_HEALTH_OMICS}" or "${SEQERA_CLOUD}".`,
      );
      process.exit(1);
    }
  }

  const limitRaw = getFlagValue('--limit');
  const maxListRaw = getFlagValue('--max-list-keys');

  return {
    dryRun: process.argv.includes('--dry-run'),
    labFilter: getFlagValue('--lab'),
    platformFilter,
    limit: limitRaw ? Math.max(1, Number.parseInt(limitRaw, 10)) : undefined,
    forceReassociate: process.argv.includes('--force-reassociate'),
    skipRunTableUpdate: process.argv.includes('--skip-run-table-update'),
    allowListInputPrefix: process.argv.includes('--list-input-prefix'),
    maxListKeys: maxListRaw ? Math.max(1, Number.parseInt(maxListRaw, 10)) : 200,
    includeNonLabPrefixKeys: process.argv.includes('--include-no-platform-keys'),
    omicsUseDefaultCredentials: process.argv.includes('--omics-use-default-credentials'),
  };
}

/** Parse `s3://bucket/key` → `{ bucket, key }`. Returns undefined for malformed URLs. */
function parseS3Url(url: string | undefined): { bucket: string; key: string } | undefined {
  if (!url) return undefined;
  const match = /^s3:\/\/([^/\s]+)\/(.+)$/i.exec(url.trim());
  if (!match) return undefined;
  const [, bucket, key] = match;
  if (!bucket || !key) return undefined;
  return { bucket, key };
}

/** `JSON.parse` defensively, including unwrapping one layer of double-encoding. */
function safeParseJson(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return undefined;
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const first = tryParse(raw);
  if (first && typeof first === 'object') return first as Record<string, unknown>;
  // Handle the (rare) doubly-encoded case: a JSON string whose contents are another JSON string.
  if (typeof first === 'string') {
    const second = tryParse(first);
    if (second && typeof second === 'object') return second as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Collect candidate sample-sheet S3 URLs from a parsed `Settings` object. The Easy Genomics
 * launch flow stores either `input` (HealthOmics-style) or `parameters.input` (Seqera-style)
 * pointing at the user's sample sheet; this pulls anything that looks like an `s3://` URL out
 * of those slots so we can re-fetch the sheet without hard-coding either platform.
 */
function collectCandidateS3UrlsFromSettings(settings: Record<string, unknown> | undefined): string[] {
  if (!settings) return [];
  const urls = new Set<string>();
  const consider = (value: unknown): void => {
    if (typeof value === 'string' && value.toLowerCase().startsWith('s3://')) {
      urls.add(value.trim());
    }
  };
  consider(settings.input);
  consider(settings.sampleSheet);
  consider(settings.sample_sheet);
  const params = settings.parameters;
  if (params && typeof params === 'object') {
    const p = params as Record<string, unknown>;
    consider(p.input);
    consider(p.sampleSheet);
    consider(p.sample_sheet);
  }
  return [...urls];
}

/**
 * Read an S3 object body and decode as UTF-8. Returns undefined on any error so callers can
 * keep best-effort behavior.
 */
async function readS3TextObject(s3: S3Service, bucket: string, key: string): Promise<string | undefined> {
  try {
    const response = await s3.getObject({ Bucket: bucket, Key: key });
    const body = response.Body;
    if (!body) return undefined;
    // Node 18+ stream body exposes transformToString; the AWS SDK types union complicates that.
    const anyBody = body as unknown as { transformToString?: (encoding?: string) => Promise<string> };
    if (typeof anyBody.transformToString === 'function') {
      return await anyBody.transformToString('utf-8');
    }
    return undefined;
  } catch (err) {
    console.warn(`  s3:GetObject s3://${bucket}/${key} failed: ${(err as Error).message ?? err}`);
    return undefined;
  }
}

interface KeyResolution {
  keys: string[];
  sources: KeySource[];
}

/**
 * Multi-step key inference. Sources are tried in priority order, but matches from later
 * sources are *merged in* (deduped) rather than ignored, since real-world rows sometimes
 * carry a partial key list (e.g. one sample sheet listed only R1 files).
 */
async function resolveInputFileKeys(args: {
  run: LaboratoryRun;
  laboratory: Laboratory;
  s3: S3Service;
  flags: Flags;
}): Promise<KeyResolution> {
  const { run, laboratory, s3, flags } = args;
  const labBucket = laboratory.S3Bucket;
  if (!labBucket) return { keys: [], sources: [] };

  const merged = new Set<string>();
  const sources: KeySource[] = [];

  const addAll = (incoming: string[] | undefined, source: KeySource) => {
    if (!incoming || incoming.length === 0) return;
    const before = merged.size;
    for (const k of incoming) {
      if (typeof k === 'string' && k.length > 0) merged.add(k);
    }
    if (merged.size > before) sources.push(source);
  };

  addAll(run.InputFileKeys, 'row');

  const sampleSheetUrls = new Set<string>();
  if (run.SampleSheetS3Url) sampleSheetUrls.add(run.SampleSheetS3Url);

  const settings = safeParseJson(run.Settings);
  for (const url of collectCandidateS3UrlsFromSettings(settings)) sampleSheetUrls.add(url);

  for (const url of sampleSheetUrls) {
    const ref = parseS3Url(url);
    if (!ref) continue;
    // Sample sheets are often stored in a provisioning / uploads bucket while FASTQs live under
    // `Laboratory.S3Bucket`. Read the CSV from whatever bucket the URL names, then keep only
    // `s3://<labBucket>/…` references inside the sheet (see `extractS3KeysFromCsv`).
    if (ref.bucket !== labBucket) {
      console.log(
        `  reading sample sheet from s3://${ref.bucket}/… (lab data bucket ${labBucket}); extracting keys for lab bucket only`,
      );
    }
    const csv = await readS3TextObject(s3, ref.bucket, ref.key);
    if (!csv) continue;
    const extracted = extractS3KeysFromCsv(csv, labBucket);
    const sourceLabel: KeySource = url === run.SampleSheetS3Url ? 'sampleSheet' : 'settingsInput';
    addAll(extracted, sourceLabel);
  }

  if (flags.allowListInputPrefix && merged.size === 0) {
    // Last-resort: walk the configured input prefix (if any) and pull a bounded number of
    // file-looking keys. Off by default because shared prefixes lead to false positives.
    const candidateUrls = [run.InputS3Url, ...(settings ? collectCandidateS3UrlsFromSettings(settings) : [])];
    for (const url of candidateUrls) {
      const ref = parseS3Url(url);
      if (!ref || ref.bucket !== labBucket) continue;
      const listed = await listKeysUnderPrefix(s3, ref.bucket, ref.key, flags.maxListKeys);
      addAll(listed, 'listInputPrefix');
      if (merged.size > 0) break;
    }
  }

  const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  const all = [...merged];
  const scoped = flags.includeNonLabPrefixKeys ? all : all.filter((k) => k.startsWith(labPrefix));

  return { keys: scoped, sources };
}

async function listKeysUnderPrefix(s3: S3Service, bucket: string, prefix: string, maxKeys: number): Promise<string[]> {
  const collected: string[] = [];
  let continuationToken: string | undefined;
  try {
    do {
      const response = await s3.listBucketObjectsV2({
        Bucket: bucket,
        Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
        MaxKeys: Math.min(1000, maxKeys - collected.length),
        ContinuationToken: continuationToken,
      });
      for (const obj of response.Contents || []) {
        if (obj.Key && !obj.Key.endsWith('/')) collected.push(obj.Key);
        if (collected.length >= maxKeys) break;
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken && collected.length < maxKeys);
  } catch (err) {
    console.warn(`  s3:ListObjectsV2 s3://${bucket}/${prefix} failed: ${(err as Error).message ?? err}`);
  }
  return collected;
}

interface WorkflowResolution {
  workflowExternalId?: string;
  workflowVersionName?: string;
  notes?: string;
}

async function resolveOmicsWorkflowFields(run: LaboratoryRun, flags: Flags): Promise<WorkflowResolution> {
  if (!run.ExternalRunId) return { notes: 'no ExternalRunId on row' };
  try {
    const omics = flags.omicsUseDefaultCredentials
      ? new OmicsService()
      : await createOmicsServiceForLab(run.LaboratoryId, run.OrganizationId, run.UserId || 'backfill');
    const response: GetRunCommandOutput = await omics.getRun(<GetRunCommandInput>{ id: run.ExternalRunId });
    return {
      workflowExternalId: response.workflowId,
      workflowVersionName: response.workflowVersionName,
    };
  } catch (err) {
    return { notes: `omics:GetRun failed: ${(err as Error).message ?? err}` };
  }
}

async function resolveSeqeraWorkflowFields(
  run: LaboratoryRun,
  laboratory: Laboratory,
  ssm: SsmService,
): Promise<WorkflowResolution> {
  if (!run.ExternalRunId) return { notes: 'no ExternalRunId on row' };
  const seqeraApiBaseUrl = laboratory.NextFlowTowerApiBaseUrl || process.env.SEQERA_API_BASE_URL;
  if (!seqeraApiBaseUrl) return { notes: 'no Seqera API base url configured' };

  let accessToken: string | undefined;
  try {
    const parameter: GetParameterCommandOutput = await ssm.getParameter({
      Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/nf-access-token`,
      WithDecryption: true,
    });
    accessToken = parameter.Parameter?.Value;
  } catch (err) {
    if (err instanceof ParameterNotFound) {
      return { notes: 'Seqera access token unavailable (SSM ParameterNotFound)' };
    }
    return { notes: `SSM GetParameter failed: ${(err as Error).message ?? err}` };
  }
  if (!accessToken) return { notes: 'Seqera access token empty' };

  const apiQueryParameters = getNextFlowApiQueryParameters(undefined, laboratory.NextFlowTowerWorkspaceId);
  try {
    const response: DescribeWorkflowResponse = await httpRequest<DescribeWorkflowResponse>(
      `${seqeraApiBaseUrl}/workflow/${run.ExternalRunId}?${apiQueryParameters}`,
      REST_API_METHOD.GET,
      { Authorization: `Bearer ${accessToken}` },
    );
    const workflow = (response.workflow ?? {}) as { revision?: string };
    // Seqera's `DescribeWorkflowResponse.workflow` does not include the platform pipelineId
    // we store as `WorkflowExternalId`. Tracing back to a pipeline reliably would require an
    // additional lookup (launch -> pipelineId, or pipelines.list + repository match) and may
    // still be ambiguous, so we deliberately do not invent a value here.
    return {
      workflowVersionName:
        typeof workflow.revision === 'string' && workflow.revision.length > 0 ? workflow.revision : undefined,
      notes: 'Seqera workflow describe succeeded; pipelineId is not exposed on this response',
    };
  } catch (err) {
    return { notes: `Seqera describe-workflow failed: ${(err as Error).message ?? err}` };
  }
}

async function resolveWorkflowFields(
  run: LaboratoryRun,
  laboratory: Laboratory,
  ssm: SsmService,
  flags: Flags,
): Promise<WorkflowResolution> {
  if (run.WorkflowExternalId && run.WorkflowVersionName) {
    return { workflowExternalId: run.WorkflowExternalId, workflowVersionName: run.WorkflowVersionName };
  }
  if (run.Platform === AWS_HEALTH_OMICS) {
    const omics = await resolveOmicsWorkflowFields(run, flags);
    return {
      workflowExternalId: run.WorkflowExternalId || omics.workflowExternalId,
      workflowVersionName: run.WorkflowVersionName || omics.workflowVersionName,
      notes: omics.notes,
    };
  }
  if (run.Platform === SEQERA_CLOUD) {
    const seqera = await resolveSeqeraWorkflowFields(run, laboratory, ssm);
    return {
      workflowExternalId: run.WorkflowExternalId,
      workflowVersionName: run.WorkflowVersionName || seqera.workflowVersionName,
      notes: seqera.notes,
    };
  }
  return { workflowExternalId: run.WorkflowExternalId, workflowVersionName: run.WorkflowVersionName };
}

function arraysEqualAsSets(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = new Set(a || []);
  const right = new Set(b || []);
  if (left.size !== right.size) return false;
  for (const v of left) if (!right.has(v)) return false;
  return true;
}

function shouldUpdateRunRow(existing: LaboratoryRun, enriched: LaboratoryRun): boolean {
  if (!arraysEqualAsSets(existing.InputFileKeys, enriched.InputFileKeys)) return true;
  if ((existing.WorkflowExternalId ?? '') !== (enriched.WorkflowExternalId ?? '')) return true;
  if ((existing.WorkflowVersionName ?? '') !== (enriched.WorkflowVersionName ?? '')) return true;
  return false;
}

function printSummary(outcomes: RunOutcome[], dryRun: boolean): void {
  const totals = {
    considered: outcomes.length,
    associated: outcomes.filter((o) => o.associated).length,
    runRowUpdated: outcomes.filter((o) => o.runRowUpdated).length,
    workflowResolved: outcomes.filter((o) => o.workflowResolved).length,
    skipped: outcomes.filter((o) => o.skipReason).length,
    errors: outcomes.filter((o) => o.error).length,
  };

  console.log(
    `\n${dryRun ? 'DRY-RUN ' : ''}Summary: considered=${totals.considered}, associated=${totals.associated}, runRowUpdated=${totals.runRowUpdated}, workflowResolved=${totals.workflowResolved}, skipped=${totals.skipped}, errors=${totals.errors}.`,
  );
}

async function main(): Promise<void> {
  const flags = parseFlags();
  loadEnv();

  if (flags.dryRun) {
    console.log('DRY RUN: no DynamoDB / S3 / platform side effects will be performed.\n');
  }

  const runService = new LaboratoryRunService();
  const laboratoryService = new LaboratoryService();
  const tagging = new LaboratoryDataTaggingService();
  const s3 = new S3Service();
  const ssm = new SsmService();

  console.log('Scanning laboratory-run table...');
  const allRuns = await runService.listAllLaboratoryRuns();
  console.log(`Scanned ${allRuns.length} laboratory run row(s).\n`);

  // The "needs work" filter mirrors what `associateInputsWithWorkflowTag` actually uses:
  //   - missing/empty lab-scoped InputFileKeys means usage tagging hasn't happened, or
  //   - missing WorkflowExternalId means the workflow tag was never applied (we may be able
  //     to backfill via the platform).
  // `--force-reassociate` bypasses both filters for environments where we suspect tagging
  // never ran even when the row looked complete.
  const candidates = allRuns.filter((run) => {
    if (flags.labFilter && run.LaboratoryId !== flags.labFilter) return false;
    if (flags.platformFilter && run.Platform !== flags.platformFilter) return false;
    if (flags.forceReassociate) return true;
    const hasKeys =
      Array.isArray(run.InputFileKeys) && run.InputFileKeys.some((k) => typeof k === 'string' && k.length > 0);
    const needsKeys = !hasKeys;
    const needsWorkflow = !run.WorkflowExternalId && !!run.ExternalRunId;
    return needsKeys || needsWorkflow;
  });

  const limited = flags.limit ? candidates.slice(0, flags.limit) : candidates;
  console.log(`Processing ${limited.length} candidate run(s)${flags.limit ? ` (--limit ${flags.limit})` : ''}.\n`);

  const omicsNeedsAssumeRoleLookup = limited.some(
    (r) => r.Platform === AWS_HEALTH_OMICS && !!r.ExternalRunId && !(r.WorkflowExternalId && r.WorkflowVersionName),
  );
  if (omicsNeedsAssumeRoleLookup && !flags.omicsUseDefaultCredentials && !process.env.ACCOUNT_ID?.trim()) {
    const namePrefix = process.env.NAME_PREFIX ?? '';
    console.warn(
      `\n*** WARNING: ACCOUNT_ID is not set. Omics workflow lookup uses STS AssumeRole into ` +
        `arn:aws:iam:<ACCOUNT_ID>/role/${namePrefix}-easy-genomics-omics-access-role, which will fail.\n` +
        '  Fix: add ACCOUNT_ID to .env.local (same account as the dev stack), or re-run with ' +
        '`--omics-use-default-credentials` if your AWS user/role can call `omics:GetRun` on those runs directly.\n',
    );
  }

  // Cache laboratories by id so we don't issue a fresh GSI query per run.
  const laboratoryCache = new Map<string, Laboratory | null>();
  const loadLaboratory = async (laboratoryId: string): Promise<Laboratory | null> => {
    if (laboratoryCache.has(laboratoryId)) return laboratoryCache.get(laboratoryId)!;
    try {
      const lab = await laboratoryService.queryByLaboratoryId(laboratoryId);
      laboratoryCache.set(laboratoryId, lab);
      return lab;
    } catch (err) {
      console.warn(`Skip lab ${laboratoryId}: failed to load laboratory record (${(err as Error).message ?? err}).`);
      laboratoryCache.set(laboratoryId, null);
      return null;
    }
  };

  const outcomes: RunOutcome[] = [];

  for (const run of limited) {
    const outcome: RunOutcome = {
      runId: run.RunId,
      laboratoryId: run.LaboratoryId,
      platform: run.Platform,
      keySources: [],
      keyCount: 0,
      workflowResolved: !!run.WorkflowExternalId,
      runRowUpdated: false,
      associated: false,
    };
    outcomes.push(outcome);

    try {
      const laboratory = await loadLaboratory(run.LaboratoryId);
      if (!laboratory) {
        outcome.skipReason = 'laboratory not found';
        continue;
      }
      if (!laboratory.S3Bucket) {
        outcome.skipReason = 'laboratory has no S3Bucket';
        continue;
      }

      console.log(
        `Run ${run.RunId} (lab ${run.LaboratoryId}, platform ${run.Platform}, ExternalRunId ${run.ExternalRunId ?? '-'}):`,
      );

      const { keys, sources } = await resolveInputFileKeys({ run, laboratory, s3, flags });
      outcome.keySources = sources;
      outcome.keyCount = keys.length;

      const workflowResolution = await resolveWorkflowFields(run, laboratory, ssm, flags);
      if (workflowResolution.notes) {
        console.log(`  workflow lookup: ${workflowResolution.notes}`);
      }

      const enrichedRun: LaboratoryRun = {
        ...run,
        ...(keys.length > 0 ? { InputFileKeys: keys } : {}),
        ...(workflowResolution.workflowExternalId ? { WorkflowExternalId: workflowResolution.workflowExternalId } : {}),
        ...(workflowResolution.workflowVersionName
          ? { WorkflowVersionName: workflowResolution.workflowVersionName }
          : {}),
      };
      outcome.workflowResolved = !!enrichedRun.WorkflowExternalId;

      if (keys.length === 0) {
        outcome.skipReason = 'no lab-scoped InputFileKeys resolvable';
        console.log('  no lab-scoped InputFileKeys resolvable; skipping tagging');
        continue;
      }

      if (!flags.skipRunTableUpdate && shouldUpdateRunRow(run, enrichedRun)) {
        if (flags.dryRun) {
          console.log(
            `  [dry-run] would update run row: keys ${run.InputFileKeys?.length ?? 0} -> ${enrichedRun.InputFileKeys?.length ?? 0}, WorkflowExternalId ${run.WorkflowExternalId ?? '-'} -> ${enrichedRun.WorkflowExternalId ?? '-'}`,
          );
        } else {
          try {
            await runService.update({
              ...enrichedRun,
              ModifiedAt: new Date().toISOString(),
              ModifiedBy: BACKFILL_MODIFIED_BY,
            });
            outcome.runRowUpdated = true;
            console.log('  updated laboratory-run row with inferred fields');
          } catch (err) {
            outcome.error = `LaboratoryRunService.update failed: ${(err as Error).message ?? err}`;
            console.warn(`  ${outcome.error}`);
          }
        }
      }

      if (flags.dryRun) {
        console.log(
          `  [dry-run] would associate run with ${keys.length} file(s) via associateInputsWithWorkflowTag (workflowTag=${enrichedRun.WorkflowExternalId ?? 'none'})`,
        );
        outcome.associated = true;
        continue;
      }

      await associateInputsWithWorkflowTag({
        laboratory,
        userId: run.CreatedBy ?? run.UserId ?? DEFAULT_SCRIPT_USER_ID,
        run: enrichedRun,
        tagging,
      });
      outcome.associated = true;
      console.log(
        `  associated ${keys.length} file(s) via associateInputsWithWorkflowTag (workflowTag=${enrichedRun.WorkflowExternalId ?? 'none'})`,
      );
    } catch (err) {
      outcome.error = (err as Error).message ?? String(err);
      console.error(`  error: ${outcome.error}`);
    }
  }

  printSummary(outcomes, flags.dryRun);
  if (outcomes.some((o) => o.error)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
