# Remove `OrganizationAccess` from user-table (migration)

After the application was updated to treat **organization-user-table** and **laboratory-user-table** as the only
persisted sources for org/lab membership, the duplicate `OrganizationAccess` map on **user-table** is obsolete. This
script removes that attribute from existing user items so the data model matches the new code.

## When to run

- **After** deploying the version of the back end that:
  - Stops writing `OrganizationAccess` on user records, and
  - Builds the Cognito `OrganizationAccess` claim in the pre-token generation Lambda from the membership tables.
- Run **per environment** (use the correct `NAME_PREFIX` / AWS account for dev, staging, production).

## What it does

For every user item in `${NAME_PREFIX}-user-table` that still has an `OrganizationAccess` attribute:

1. **Verifies** that the stored `OrganizationAccess` matches what the system would rebuild from
   `${NAME_PREFIX}-organization-user-table` and `${NAME_PREFIX}-laboratory-user-table` (using the same helper as the
   Cognito pre-token Lambda).
2. **Removes** the `OrganizationAccess` attribute via `UpdateItem ... REMOVE OrganizationAccess` only if the
   verification passes.
3. **Skips and reports** any user whose stored map disagrees with the membership tables. The migration prints a summary
   (and full diffs with `--verbose`) so you can reconcile before re-running.

The comparison normalises both sides:

- Missing `LaboratoryAccess` is treated the same as `{}`.
- Missing `OrganizationAdmin` / `LabManager` / `LabTechnician` are treated as `false`.
- Object key order does not matter.

## Prerequisites

- AWS credentials with:
  - `dynamodb:Scan` and `dynamodb:UpdateItem` on the **user-table**.
  - `dynamodb:Query` on the **organization-user-table** (`UserId_Index` GSI).
  - `dynamodb:Query` on the **laboratory-user-table** (`UserId_Index` GSI).
- `packages/back-end/.env.local` (or exported env) including at least:
  - `NAME_PREFIX` — same prefix as your deployed stacks (e.g. `easy-genomics-dev`).
  - `REGION` — AWS region (also used as `AWS_REGION` if unset).

## Usage

From the repository root:

```bash
cd packages/back-end
```

**Verify only** (no writes; runs the comparison and exits):

```bash
pnpm exec tsx scripts/remove-user-organization-access.ts --verify-only
```

**Dry run** (verifies and logs what would change; no writes):

```bash
pnpm run migrate:remove-user-organization-access:dry-run
```

**Apply** (verifies, then removes `OrganizationAccess` from each user that matches; skips mismatches):

```bash
pnpm run migrate:remove-user-organization-access
```

**Verbose** (prints the stored vs. rebuilt map for every mismatch):

```bash
pnpm exec tsx scripts/remove-user-organization-access.ts --verify-only --verbose
```

**Force** (skip verification, remove for every user with `OrganizationAccess`). Use only after you have explicitly
accepted that the membership tables are authoritative and the user-table copy can be discarded:

```bash
pnpm exec tsx scripts/remove-user-organization-access.ts --force
```

Flags:

- `--dry-run` — verify and log decisions; do not write.
- `--verify-only` — never write, even outside dry-run; useful for review.
- `--force` — skip verification; remove unconditionally.
- `--verbose` — print full per-user diffs for mismatches.

## Recommended order of execution

1. Run `--verify-only` first and fix any mismatches you don't like (e.g. by editing the membership tables, or by
   accepting that the JWT-built map is correct).
2. Run `--dry-run` to confirm the set of users that will be updated.
3. Run the apply command (`pnpm run migrate:remove-user-organization-access`).
4. If the run reports skipped users, re-run after reconciling, or use `--force` only if you understand the implications.

## Exit codes

- `0` — clean run; all matched users had `OrganizationAccess` removed (or, in dry-run/verify-only modes, would have been
  removed).
- `1` — script error (AWS, env, etc.).
- `2` — apply mode finished, but some users were skipped due to mismatches; review the log and re-run.

## Rollback

There is no automatic rollback. If you need to restore the old denormalised field, reconstruct `OrganizationAccess` from
the membership tables (the same merge logic this script uses for verification) and write it back to user-table. This
should rarely be necessary once the new code is live, since the JWT claim is rebuilt from the membership tables on every
token issuance.

## Notes

- Users do **not** need to take any action; the next sign-in or token refresh gets org/lab permissions from the
  membership tables via the pre-token trigger.
- JWT size and "stale permissions" behaviour improve because the DB no longer stores a second copy of membership on the
  user item.
