# Changelog

All notable changes to Easy Genomics are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

## [Unreleased] — Back-End API stack split

> **DATA-LOSS HAZARD for existing deployments.** See
> [`docs/EASY_GENOMICS_PROD_MIGRATION.md`](./docs/EASY_GENOMICS_PROD_MIGRATION.md) BEFORE merging or deploying this
> release.

### Summary

The back-end CloudFormation topology is split to stay under the 500-resource-per-stack limit. The previous single
`*-main-back-end-stack` (which aggregated `easy-genomics`, `aws-healthomics`, `nf-tower`, auth, VPC, data provisioning,
etc.) now synthesizes as multiple top-level stacks:

- `*-main-back-end-stack` — shared platform infra (VPC, KMS, Cognito) + the `aws-healthomics` and `nf-tower` REST API.
- `*-easy-genomics-api-stack` — the easy-genomics REST API, Lambdas, SNS/SQS, DynamoDB tables, and data provisioning.
- `*-api-domain-stack` (optional) — custom domain + base-path routing when `apiDomainName`, `awsApiCertificateArn`, and
  `awsHostedZoneId` are configured.

This is a **breaking CloudFormation change** for any environment that has already been deployed. The eight easy-genomics
DynamoDB tables must be migrated from the old nested stack to the new top-level stack via `cdk import`; a plain
`cdk deploy --all` of the new code against an un-migrated environment is destructive.

### Added

- `packages/back-end/src/infra/stacks/easy-genomics-api-stack.ts` — new top-level stack owning the easy-genomics REST
  API and its dependencies.
- `packages/back-end/src/infra/stacks/api-domain-stack.ts` — optional shared-domain fan-out stack for presenting the
  split REST APIs behind a single custom domain.
- `packages/back-end/src/infra/guardrails/stack-resource-budget.ts` — synth-time guardrail that fails the build if any
  synthesized stack approaches the CloudFormation 500-resource hard limit.
- `packages/back-end/scripts/preflight-deletion-protection.ts` — pre-deploy safety check wired into the back-end
  `deploy` / `build-and-deploy` tasks. Runs two checks back-to-back before handing control to `cdk deploy`:

  1. **Table arming.** If any easy-genomics DynamoDB table is missing deletion protection or PITR, the preflight
     auto-executes Phase 0 of the migration (on-demand backup, `dynamodb:UpdateTable DeletionProtectionEnabled=true`,
     and `dynamodb:UpdateContinuousBackups PointInTimeRecoveryEnabled=true`) and halts the deploy with a clear "Phase 0
     done, now do Phases 1-5" report.
  2. **Migration state.** If every table is already compliant, the preflight queries CloudFormation for the resources of
     `*-main-back-end-stack`. If the easy-genomics nested stack is still present, the migration is pending and the
     preflight halts the deploy with a friendly "migration pending" report instead of letting `cdk deploy` trigger the
     noisy CloudFormation rollback that would otherwise fire when DynamoDB rejects the nested-stack `DeleteTable` calls.
     If CloudFormation is unreachable (expired credentials, missing `cloudformation:ListStackResources` permission,
     throttling), the preflight fails closed — `cdk deploy` would have failed a moment later anyway on its own first CFN
     call, and halting here produces a much clearer error.

  Pass `--no-auto-arm` for read-only behaviour on check 1 (fails with manual CLI fix-up commands instead of mutating
  anything) if the deploying principal isn't authorised to arm. There is intentionally no full-bypass flag: tables that
  don't exist yet are already a no-op for the preflight, so fresh / greenfield deploys complete silently without needing
  one.

- AWS SDK-backed `AwsCustomResource` arming in `dynamodb-construct.ts` that calls
  `dynamodb:UpdateTable DeletionProtectionEnabled=true` and
  `dynamodb:UpdateContinuousBackups PointInTimeRecoveryEnabled=true` on every deploy. Redundant for freshly-created
  tables (CDK properties already set the same flags) but critical for tables adopted via `cdk import`, where
  CloudFormation otherwise leaves the physical flags untouched.
- `docs/EASY_GENOMICS_PROD_MIGRATION.md` — full, environment-agnostic migration runbook covering pre-merge arming (Phase
  0), post-merge CI behaviour, retain bridge (Phase 1), detach (Phase 2), `cdk import` (Phase 3), smoke-test (Phase 4),
  cleanup (Phase 5), and rollback procedures.
- Front-end `EASY_GENOMICS_API_URL` runtime override so split deployments can route easy-genomics traffic to the new
  API's invoke URL without affecting `aws-healthomics` / `nf-tower` calls.

### Changed

- `packages/back-end/src/infra/constructs/dynamodb-construct.ts` now unconditionally pins `RemovalPolicy.RETAIN`,
  `deletionProtection: true`, and `PointInTimeRecoveryEnabled: true` in **every** environment — `dev`, `demo`,
  `pre-prod`, and `prod`. Rationale is documented in the migration runbook:
  1. Non-prod runs of AWS HealthOmics workflows are expensive; losing the laboratory-run metadata in dev/demo costs real
     time and money to recreate.
  2. Keeping retain semantics uniform across envs means the migration is rehearsed end-to-end in lower environments
     before touching prod. The L1 `DeletionPolicy` / `UpdateReplacePolicy` are also explicitly overridden to `Retain` as
     belt-and-braces.
- `packages/back-end/src/infra/constructs/lambda-construct.ts` now requires an explicitly-owned API Gateway and
  validates route ownership at synth time. Stacks that don't own a REST API cannot accidentally register routes on a
  neighbour stack's API.
- Back-end `deploy` / `build-and-deploy` tasks gained a preflight step; `deploy` also now passes `--all` to `cdk deploy`
  so the CLI doesn't require the operator to name each synthesized stack.
- Front-end `HttpFactory` prefers `EASY_GENOMICS_API_URL` when set, falling back to `BASE_API_URL` for single-URL legacy
  deployments. Path prefixes (`/easy-genomics`, `/aws-healthomics`, `/nf-tower`) are unchanged.

### Migration

Every existing deployment — open-source self-hosted included — must follow the migration runbook in full. The TL;DR is:

1. **Phase 0 — arming (automatic):** the first time `pnpm run build-and-deploy` runs against an un-armed environment
   (locally or via CI), the preflight script takes an on-demand backup of every easy-genomics table, arms deletion
   protection, enables PITR, and halts the deploy with a clear "Phase 0 done, now do Phase 1–5" message. This is
   idempotent and zero-downtime. Sections 0.1–0.4 of the runbook document the equivalent AWS CLI commands if you'd
   rather do it by hand (for example, to pre-arm production before the split PR is merged).
2. **Post-merge CI behaviour:** until the per-environment migration completes, CI red-builds on every deploy. The first
   red-build arms the environment (see above). Subsequent red-builds fail inside CloudFormation: deletion protection
   rejects the `DeleteTable` calls, the old stack rolls back, the environment stays fully functional.
3. **At migration time, per environment:** execute Phases 1–5 of the runbook (retain-bridge deploy → detach →
   `cdk import` → smoke-test → cleanup).

Rolling back before Phase 3 is always safe because the tables are retained in-place with deletion protection; see the
`Rollback procedure` section of the runbook for the full matrix.

### Who does this affect

- **You have an existing Easy Genomics deployment:** yes, you must follow the runbook.
- **You're deploying Easy Genomics for the first time:** no migration needed and no special flags required. The
  preflight reports every easy-genomics table as "missing (fresh deploy; skipping)" and exits cleanly. All subsequent
  deploys will continue to pass the preflight because the new construct provisions tables with deletion protection +
  PITR from day one.
