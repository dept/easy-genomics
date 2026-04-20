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
