# Upgrading

> **Note:** This page currently holds the critical upgrade-safety warning relocated from the root `README.md`. The full
> upgrade / version-migration guide is owned by DOCS-03 and will expand this page.

## Upgrading From An Earlier Release? Read This First

> **DATA-LOSS HAZARD — applies to every existing Easy Genomics deployment.**
>
> This release splits the back-end CloudFormation topology into multiple top-level stacks. Without the safeguards
> described below, applying it to an existing environment would cause CloudFormation to call `DeleteTable` on every
> easy-genomics DynamoDB table (`*-organization-table`, `*-laboratory-table`, `*-laboratory-run-table`, and five
> others). On deployments created with `env-type: dev`, `demo`, or `pre-prod`, the currently-deployed template's
> `DeletionPolicy` is `Delete`, so those calls would succeed and the data would be **permanently lost**.
>
> The back-end `deploy` task now runs a mandatory preflight check
> ([`packages/back-end/scripts/preflight-deletion-protection.ts`](../../packages/back-end/scripts/preflight-deletion-protection.ts))
> before `cdk deploy`. On the **first** run against an un-armed environment it will automatically:
>
> 1. Take an on-demand backup of every affected easy-genomics DynamoDB table.
> 2. Enable `DeletionProtectionEnabled` on each one (blocks all future `DeleteTable` calls, CloudFormation's included).
> 3. Enable Point-In-Time Recovery on each one.
> 4. Halt the deploy with a message pointing at the migration runbook.
>
> You then execute the per-environment migration (retain-bridge → detach → `cdk import`) documented in
> [`docs/operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md`](../operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md).
> Re-running the deploy command after that is green. The preflight has no full-bypass flag by design; fresh / greenfield
> deploys already complete silently because tables that do not yet exist are a no-op for the guard.
>
> Read the migration runbook end-to-end **before** merging this release into your deployment branch. Recent changelog
> entries for this release are captured in [`CHANGELOG.md`](../../CHANGELOG.md).
