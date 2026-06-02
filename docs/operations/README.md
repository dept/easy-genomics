# Operations

Day-2 operational guides: troubleshooting and migration runbooks.

| Doc                                          | What it covers                                                   | Status              |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| troubleshooting.md                           | Common deploy/auth/run failures and the EG-xxx error-code lookup | 🚧 Owned by DOCS-05 |
| [migration-runbooks/](./migration-runbooks/) | Environment migration runbooks                                   | ✅ Available        |

## migration-runbooks/

| Runbook                                                                                 | What it covers                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [EASY_GENOMICS_PROD_MIGRATION.md](./migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md) | Per-environment retain-bridge → detach → `cdk import` migration for the multi-stack back-end split |
