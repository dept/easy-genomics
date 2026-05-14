# Back-end maintenance scripts

Utility scripts for one-off data or AWS resource fixes. Run them from the `packages/back-end` directory unless noted
otherwise. They expect a `.env.local` file (or equivalent environment variables) and default AWS credentials where
applicable.

## `backfill-omics-run-tags.ts`

**Purpose:** Adds tags to existing AWS HealthOmics runs so they match the tags applied when new run executions are
created. The laboratory run table is the source of truth; `WorkflowId` is taken from each row’s `ExternalRunId`.

**When to use:** After a change to tagging behavior or for legacy runs that were never tagged.

**Usage:**

```bash
pnpm run backfill-omics-run-tags
pnpm run backfill-omics-run-tags:dry-run
```

- `--dry-run` — log what would be tagged without calling the Omics API.

**Environment:** `NAME_PREFIX`, `ACCOUNT_ID`, `REGION` (see script header for IAM expectations).

## `backfill-workflow-run-history-and-usages.ts`

**Purpose:** Retroactively populates per-file run usage (`LaboratoryRunUsages`) **and** workflow→file tag links for
laboratory runs created before the file-history feature was tracking `InputFileKeys` and `WorkflowExternalId`
automatically. For each candidate row the script infers `InputFileKeys` (from the row, the `SampleSheetS3Url` object in
whatever bucket that URL references, or `s3://` URLs found in `Settings.input` / `parameters.input`), resolves
`WorkflowExternalId` / `WorkflowVersionName` via the platform when missing (Omics `GetRun`, Seqera
`GET /workflow/{id}`), optionally writes the inferred fields back to the run row, then invokes
`associateInputsWithWorkflowTag` — the same hook `create-laboratory-run` uses — so the tagging table receives the
canonical writes. Sample-sheet bodies are read from the URL's bucket; only cells that reference the **laboratory data
bucket** (`Laboratory.S3Bucket`) are turned into `InputFileKeys`.

This script supersedes the earlier usage-only backfill that replayed `LaboratoryRunUsages` from rows that already had
`InputFileKeys` but did not infer keys, update run rows, or apply workflow tags. Use `--force-reassociate` when you only
need to re-apply tagging from existing keys without re-inferring them.

**When to use:** Once after deploying the workflow-history feature against an environment with legacy runs, or to retry
partially-tagged runs after import / restore.

**Usage:**

```bash
pnpm run backfill-workflow-run-history-and-usages
pnpm run backfill-workflow-run-history-and-usages:dry-run
pnpm run backfill-workflow-run-history-and-usages -- --lab <laboratoryId>
pnpm run backfill-workflow-run-history-and-usages -- --platform "AWS HealthOmics" --limit 50
pnpm run backfill-workflow-run-history-and-usages -- --omics-use-default-credentials
```

- `--dry-run` — log what would change without writing to DynamoDB / S3 / platforms.
- `--lab <laboratoryId>` — limit the backfill to a single laboratory.
- `--platform <name>` — filter by `LaboratoryRun.Platform` (`AWS HealthOmics` or `Seqera Cloud`).
- `--limit <n>` — process at most N runs (useful for staged rollouts).
- `--force-reassociate` — re-run tagging for rows that already have keys (safe; tagging writes are idempotent).
- `--skip-run-table-update` — only update the tagging table; don't write inferred fields back to the run row.
- `--list-input-prefix` — opt in to a guarded `ListObjectsV2` fallback when no sample sheet is available but
  `Settings.input` resolves to a lab-scoped prefix. Off by default because shared prefixes lead to false positives.
- `--max-list-keys <n>` — cap on listed keys when `--list-input-prefix` is on (default `200`).
- `--omics-use-default-credentials` — call Omics `GetRun` with your ambient AWS credentials instead of STS AssumeRole
  into `${NAME_PREFIX}-easy-genomics-omics-access-role`. Typical for local runs where `ACCOUNT_ID` is set but your SSO
  user cannot `sts:AssumeRole` that role, **or** when you omit `ACCOUNT_ID` and still have account-wide `omics:GetRun`.

**Known gaps (best-effort by design):** runs whose sample sheet has been deleted, whose CSV contains no `s3://`
references, or whose `Settings` does not point at a lab-scoped S3 object cannot be reconstructed from EG data alone.
Seqera's describe-workflow response does not expose the platform `pipelineId` we store as `WorkflowExternalId`, so for
Seqera runs missing that field the script records run usage without a workflow tag and logs a note.

**Environment:** `NAME_PREFIX`, `REGION`, `ACCOUNT_ID` when Omics workflow lookup uses STS AssumeRole (same as deployed
Lambdas). If `ACCOUNT_ID` is missing, the role ARN is invalid (`arn:aws:iam::undefined/...`). Either set `ACCOUNT_ID` or
use `--omics-use-default-credentials`. Set `SEQERA_API_BASE_URL` when Seqera runs in labs without
`NextFlowTowerApiBaseUrl`.

**IAM:** DynamoDB `Scan` / `UpdateItem` on `laboratory-run-table`; DynamoDB `Query` on `laboratory-table` (and
`laboratory-data-tagging-table`); S3 `GetObject` on the **laboratory data bucket** and on **any bucket** referenced by
`SampleSheetS3Url` / `Settings` (provisioning buckets are common); `ListBucket` if `--list-input-prefix`; `omics:GetRun`
via STS AssumeRole into `${NAME_PREFIX}-easy-genomics-omics-access-role` **or** default credentials when
`--omics-use-default-credentials` is set; SSM `GetParameter` (with decryption) for Seqera labs' access token. Your
operator principal may need `sts:AssumeRole` on the Omics access role when not using `--omics-use-default-credentials`.

## `seed-workflow-tagging-test-runs.ts`

**Purpose:** Creates twelve synthetic `LaboratoryRun` rows (no Omics or Seqera launch) and applies the same
workflow→file tagging logic as `create-laboratory-run`, so you can exercise Data Collections workflow filters without
platform charges.

**When to use:** Local or non-prod environments when you want realistic workflow tag diversity on existing bucket
objects.

**Usage:**

```bash
pnpm run seed-workflow-tagging-test-runs -- --laboratoryId <uuid>
pnpm run seed-workflow-tagging-test-runs -- --laboratoryId <uuid> --reset
pnpm run seed-workflow-tagging-test-runs:dry-run -- --laboratoryId <uuid>
pnpm run seed-workflow-tagging-test-runs:dry-run -- --laboratoryId <uuid> --reset
```

- `--reset` — Deletes laboratory runs created by this script for that lab (matched by `Settings.seededBy` or a `RunName`
  prefix of `[seed] `), removes each distinct seed workflow tag via `deleteTag` (clears `FILE#` / `MAP#` links), then
  proceeds with a fresh seed as usual. Combine with `--dry-run` to print what would be removed.
- `--keys-file path.json` — JSON array of full S3 keys (must start with `OrganizationId/LaboratoryId/`). Use when the
  bucket is empty under the lab prefix or you want specific files only.
- `--user-id` / `--owner` — optional overrides for `UserId` (must be a UUID) and `Owner` on each run row.

**Environment:** `NAME_PREFIX`, `REGION`. Optional `SEQERA_PLATFORM_API_BASE_URL` if the lab has no
`NextFlowTowerApiBaseUrl` but you still want Seqera-style runs to carry a base URL.

**IAM:** DynamoDB `PutItem` / `DeleteItem` on `laboratory-run-table`; DynamoDB read/write (including `DeleteItem` and
GSI queries) on `laboratory-data-tagging-table` (+ indexes); `s3:ListBucket` (and `ListBucket` on the lab bucket) when
discovering keys. No Omics or Tower API calls.

## `recompute-laboratory-run-retention.ts`

**Purpose:** Recomputes DynamoDB TTL-related fields on terminal laboratory runs for **one laboratory**: sets
`TerminalAt` when missing, and sets or removes `ExpiresAt` according to a retention policy (`0` = never delete —
`ExpiresAt` is removed; `N > 0` = expire `N` months after terminal time).

**When to use:** Operations or support tasks when you need the same behavior as lab settings **Apply to existing runs**,
but from the command line (e.g. automation or a lab ID plus explicit months).

**Usage:**

```bash
pnpm tsx scripts/recompute-laboratory-run-retention.ts --laboratoryId <uuid> --retentionMonths <int> [--dry-run]
```

Convenience script (set env vars first):

```bash
LAB_ID=<uuid> RETENTION_MONTHS=<int> pnpm run recompute-laboratory-run-retention
```

**Environment:** `NAME_PREFIX`, `REGION`.

## `build-import-mapping.ts`

**Purpose:** Generates the `--resource-mapping` JSON file consumed by `cdk import` during the easy-genomics split-stack
migration (`docs/EASY_GENOMICS_PROD_MIGRATION.md`, Phase 3.1). Reads
`cdk.out/${namePrefix}-easy-genomics-api-stack.template.json` (produced by `pnpm cdk synth`), discovers every
`AWS::DynamoDB::Table` resource, and writes a `LogicalResourceId → { TableName }` map. Fails closed if any of the eight
expected easy-genomics tables are missing from the synthesized template, so an incomplete or wrong-stack mapping cannot
silently slip through into a `cdk import` run.

**When to use:** Phase 3.1 of the migration runbook only. The generated file is consumed by:

```bash
pnpm cdk import "${NEW_STACK}" \
  --resource-mapping "cdk.out/${NEW_STACK}.import-mapping.json" \
  --require-approval any-change
```

**Usage:**

```bash
pnpm cdk synth --quiet
pnpm tsx scripts/build-import-mapping.ts --print
```

- `--stack <name>` — override the stack name to read from `cdk.out` (default: `${namePrefix}-easy-genomics-api-stack`).
- `--cdk-out <dir>` — override the cloud assembly directory (default: `packages/back-end/cdk.out`).
- `--output <path>` — override where the mapping JSON is written (default: `cdk.out/${stack}.import-mapping.json`).
- `--print` — also dump the resulting JSON to stdout for review before running `cdk import`.

**Environment:** No AWS credentials needed (this script does not call AWS APIs). It does need the same
`config/easy-genomics.yaml` / `CI_CD` env-var setup that `main.ts` and the preflight script use, in order to derive the
`${namePrefix}` value used to validate the synthesized template.
