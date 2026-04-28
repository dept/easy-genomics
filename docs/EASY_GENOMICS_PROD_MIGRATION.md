# Easy Genomics API Split — Migration Runbook (all environments)

## Purpose

This runbook describes the exact sequence of steps required to safely migrate a deployment of the Easy Genomics back-end
from the pre-split layout (`easy-genomics-nested-stack` owned by `*-main-back-end-stack`, with the eight DynamoDB tables
defined inside that nested stack) to the split layout (`easy-genomics-nested-stack` owned by the new
`*-easy-genomics-api-stack`, with the eight DynamoDB tables hoisted up to the **top-level** api stack scope so that
`cdk import` can adopt them — the CDK importer does not recurse into nested stacks).

**This runbook is intentionally environment-agnostic.** The same sequence of commands applies to `dev`, `demo`,
`pre-prod`, and `prod`. The Easy Genomics DynamoDB tables are configured with `RemovalPolicy.RETAIN`, deletion
protection, and Point-In-Time Recovery in every environment, so the import-based migration flow below is the **only**
supported path on every stack.

There are two strong reasons we do not special-case prod:

1. **Rehearsal.** Non-prod environments now use the exact same retain + import mechanics, so any bug in the runbook
   (permissions, logical IDs, flag names, etc.) surfaces in dev/demo long before it matters in prod.
2. **Non-prod data is not disposable.** Generating real AWS HealthOmics workflow runs is expensive. The
   `laboratory-run-table` and related tables hold the only easy-genomics-side mapping between lab runs and HealthOmics /
   Seqera run IDs. Losing them in dev means real time and money to recreate test data, not just a seed replay.

A naive `cdk deploy --all` of the split-stack code against an un-migrated environment is **destructive** (the
currently-deployed template has `DeletionPolicy: Delete` on every easy-genomics table in envs that were created with
`envType != prod`) and is **broken even where it is non-destructive** (tables with `DeletionPolicy: Retain` orphan
cleanly, but the new stack then fails to create because the old physical names are still in use). Because we cannot
reliably promote PRs through environments in a strict order — an unrelated PR to `development` can trigger an
auto-deploy at any time — the migration model below relies on a pre-deploy guard
([`packages/back-end/scripts/preflight-deletion-protection.ts`](../packages/back-end/scripts/preflight-deletion-protection.ts))
that runs **before every `cdk deploy`**. On the first deploy against a given environment the guard automatically arms
deletion protection + PITR on every easy-genomics table and halts the deploy; on every subsequent deploy it halts the
deploy again until the per-environment migration (Phases 1–5) completes. This means the split PR can be merged without
any pre-merge manual ceremony: the first CI run against each environment does the arming for you, and no CloudFormation
change is attempted until the operator has explicitly worked through the runbook.

---

## Operating model

The migration is executed in three distinct stages:

1. **Phase 0 — data protections armed (one-time, per environment):** Arm deletion protection and PITR on every
   easy-genomics DynamoDB table in every environment. Two paths are supported:

   - **Default:** let the preflight script do it. The back-end `deploy` / `build-and-deploy` tasks invoke
     [`packages/back-end/scripts/preflight-deletion-protection.ts`](../packages/back-end/scripts/preflight-deletion-protection.ts)
     before `cdk deploy`. On the first run against an un-armed environment (CI or local) the preflight takes an
     on-demand backup, calls `dynamodb:UpdateTable DeletionProtectionEnabled=true` +
     `dynamodb:UpdateContinuousBackups PointInTimeRecoveryEnabled=true` for every table, and halts the deploy with a
     prescriptive report. This is the recommended path in every environment; no pre-merge ceremony is required.
   - **Advanced / optional:** pre-arm manually via `aws dynamodb …` ahead of the split PR landing, using sections
     0.1–0.4 of this runbook. Useful if your change-management policy requires that deletion protection be in place
     before any new code is merged into the branch that auto-deploys the target environment, or if the deploying
     principal does not have the IAM permissions the preflight needs (see "Requirements for the auto-arm path" below).

   Once armed, any subsequent `DeleteTable` call — from a developer, an IAM principal, or CloudFormation itself — is
   rejected by DynamoDB.

2. **Post-merge steady state (no data at risk):** After the split PR merges, CI auto-deploys the new code. The preflight
   runs before `cdk deploy` on every deploy:

   - **First deploy against an un-armed environment:** preflight auto-arms Phase 0 and halts (exit `1`). `cdk deploy` is
     never invoked, so no CloudFormation change is attempted.
   - **Subsequent deploys, before migration:** preflight finds every table compliant, then queries CloudFormation and
     sees the easy-genomics nested stack still inside `*-main-back-end-stack`. It halts with a "migration pending"
     report (exit `1`). Again, no CloudFormation change is attempted.
   - **Preflight unreachable (expired credentials, missing `cloudformation:ListStackResources`, throttling):** the
     preflight fails closed (exit `2`) and `cdk deploy` is not invoked. See "What happens if the preflight cannot reach
     CloudFormation" further down.
   - **Preflight bypassed at the edit-history level (not supported):** if someone reverts the preflight wiring in
     `.projenrc.ts` or runs `cdk deploy --all` directly without going through `pnpm run build-and-deploy`, the DynamoDB
     deletion protection armed by Phase 0 is still the final backstop: CloudFormation's `DeleteTable` calls will be
     rejected, the stack update will fail, and CloudFormation will roll back. Data stays safe, but the error surface is
     noisier than the preflight's banner.

   **CI turns red and stays red on each environment until the per-environment migration below completes.** That is the
   intended signal for operators to schedule the cutover.

3. **Phases 1–5 (per environment, at an operator's choosing):** Execute the retain-bridge → detach → import → smoke-test
   → cleanup sequence documented below.

Deletion protection is the backstop that turns the window between "PR merged" and "migration executed" from _dangerous_
into _noisy but safe_. `DeletionPolicy: Retain` in the deployed CloudFormation template is still required for the actual
migration to run cleanly; Phase 1 adds it via a short-lived "retain bridge" deploy.

---

## Scope of resources affected

### DynamoDB tables (stateful; MUST be imported)

Physical table names (substitute `${namePrefix}` with `${envType}-${envName}`, e.g. `dev-acme`, `demo-acme`,
`prod-acme`):

1. `${namePrefix}-organization-table`
2. `${namePrefix}-laboratory-table`
3. `${namePrefix}-user-table`
4. `${namePrefix}-organization-user-table`
5. `${namePrefix}-laboratory-user-table`
6. `${namePrefix}-laboratory-run-table`
7. `${namePrefix}-unique-reference-table`
8. `${namePrefix}-laboratory-workflow-access-table`

All eight tables are pinned to `RemovalPolicy.RETAIN` with deletion protection and PITR enabled — see
`packages/back-end/src/infra/constructs/dynamodb-construct.ts`.

### SNS topics, SQS queues, IAM roles, Lambdas, API Gateway (stateless; replaced)

Auto-named by CDK, zero persistent data worth keeping:

- SNS topics: `organization-deletion-topic`, `laboratory-deletion-topic`, `user-deletion-topic`,
  `laboratory-run-update-topic`, `user-invite-topic`, `folder-download-topic`.
- SQS queues: matching `*-management-queue` / `*-queue` for each topic above.
- All easy-genomics Lambda functions, their IAM execution roles, and API Gateway methods/resources.

They will be deleted from the old stack and recreated in the new stack as part of `cdk deploy`. The one visible effect
is that the REST API **invoke URL will change** because the easy-genomics API Gateway is a brand-new resource in the new
stack. The front-end must be redeployed with the new URL (either via `AWS_EASY_GENOMICS_API_URL` or, in envs that have
it, via the `ApiDomainStack` custom domain).

### S3 buckets (out of scope for this migration)

Only the non-prod data-provisioning lab bucket is CDK-managed, and its `removalPolicy` is still `DESTROY`. If your lower
environment has lab files in that bucket that you want to keep, back them up separately via `aws s3 sync` before
Phase 2. Prod lab buckets are not managed by this stack and are unaffected.

### What does NOT move (preserved automatically)

- Cognito User Pool, groups, users (stays in `BackEndStack/auth-nested-stack`).
- KMS keys (Cognito IDP key, pipeline key).
- VPC, subnets, security groups.
- AWS HealthOmics + NF-Tower nested stacks and everything inside them.
- AWS HealthOmics workflow run artifacts themselves — those live in the HealthOmics service and the HealthOmics-owned S3
  output buckets, neither of which this CDK app manages.

---

## Prerequisites

- AWS CLI v2 configured with credentials for the target account, having `cloudformation:*`, `dynamodb:*`,
  `iam:PassRole`.
- Local clone of this repo on the commit that is about to be deployed.
- `aws-cdk` ≥ 2.176.0 (matches `packages/back-end/package.json`).
- A short maintenance window for the easy-genomics REST API. HealthOmics, NF-Tower and Cognito stay available
  throughout. Typical duration: 15–30 min in non-prod, 30–45 min in prod depending on data size.

Set convenience variables for the rest of the runbook. Replace the placeholder values with those for the environment
you're migrating:

```bash
export AWS_REGION=us-east-1
export ENV_NAME=acme               # value of env-name in easy-genomics.yaml
export ENV_TYPE=dev                # dev | demo | pre-prod | prod
export NAME_PREFIX="${ENV_TYPE}-${ENV_NAME}"
export OLD_STACK="${NAME_PREFIX}-main-back-end-stack"
export NEW_STACK="${NAME_PREFIX}-easy-genomics-api-stack"

export EG_TABLES=(
  "${NAME_PREFIX}-organization-table"
  "${NAME_PREFIX}-laboratory-table"
  "${NAME_PREFIX}-user-table"
  "${NAME_PREFIX}-organization-user-table"
  "${NAME_PREFIX}-laboratory-user-table"
  "${NAME_PREFIX}-laboratory-run-table"
  "${NAME_PREFIX}-unique-reference-table"
  "${NAME_PREFIX}-laboratory-workflow-access-table"
)
```

**Rehearse in a lower environment first.** The intended rollout order is `dev` → `demo` → `pre-prod` → `prod`. Run the
full runbook against each environment, fix anything that breaks, then promote.

---

## Phase 0 — Arm data protections (one-time, per environment)

**Goal: put every easy-genomics table into a state where no actor — CloudFormation, CLI, or SDK — can delete it, BEFORE
any `cdk deploy` of the split-stack code touches that environment.**

This phase is performed **once per environment**. It is idempotent and zero-downtime; rerunning it is always safe. It
must be completed for every environment the split PR will eventually deploy to (`dev`, `demo`, `pre-prod`, `prod`), but
the timing — before or after the split PR lands on `development` — is flexible. See the two paths below.

### Why this phase is mandatory

Once the split PR is merged to `development`, any push to that branch (including the split PR itself) triggers
`cicd-release-quality.yml`, which runs the back-end deploy against the target environment. If deletion protection is not
already on by the time CloudFormation starts, CFN will happily call `DeleteTable` on every easy-genomics table during
the nested-stack removal. In an environment created with `envType: dev` / `demo` / `pre-prod`, the currently-deployed
template has `DeletionPolicy: Delete` on those tables (that was the pre-split default), so the delete call **succeeds**
and the data is gone.

Arming deletion protection via the AWS API — out-of-band from CloudFormation — is what prevents this.

### Default path: let the preflight do it automatically

The back-end `deploy` / `build-and-deploy` tasks run
[`packages/back-end/scripts/preflight-deletion-protection.ts`](../packages/back-end/scripts/preflight-deletion-protection.ts)
_before_ `cdk deploy`. On the first invocation against an un-armed environment the preflight auto-arms Phase 0 in one
shot:

1. Takes an on-demand backup of each un-protected table.
2. Calls `dynamodb:UpdateTable DeletionProtectionEnabled=true`.
3. Calls `dynamodb:UpdateContinuousBackups PointInTimeRecoveryEnabled=true`.
4. Halts the deploy with a clear "PREFLIGHT AUTO-ARM COMPLETED — deploy intentionally halted" report pointing at Phase 1
   of this runbook.

This is the recommended path. The simplest way to execute Phase 0 on every environment is to merge the split PR and let
the first auto-deploy do the arming — no CloudFormation change is attempted (the preflight exits before `cdk deploy`
runs), so the operation is safe even though CI will red-build.

If you prefer to run it locally instead of via CI, check out the merged code and run `pnpm run build-and-deploy` pointed
at the target environment. The auto-arm path triggers identically.

Requirements for the auto-arm path:

- The deploying principal must have `dynamodb:UpdateTable`, `dynamodb:UpdateContinuousBackups`, `dynamodb:CreateBackup`,
  `dynamodb:DescribeTable`, and `dynamodb:DescribeContinuousBackups` on every easy-genomics table, plus
  `cloudformation:ListStackResources` on `*-main-back-end-stack` (used by the post-arming migration-state check). The CI
  role already has these; local developers typically do.
- You must NOT pass `--no-auto-arm` — that reverts to a read-only mode where the preflight fails with the manual CLI
  commands below instead of mutating anything.

There is intentionally **no** full-bypass flag on the preflight — the guard runs on every deploy, including sandbox and
greenfield environments. Fresh environments are not harmed by this: the preflight reports every easy-genomics table as
"missing (fresh deploy; skipping)" and exits cleanly.

### Advanced path: manual pre-merge arming (optional)

If your change-management policy requires that deletion protection be in place **before** the split PR is merged into
the branch that auto-deploys the target environment — or if you simply prefer to decouple "PR approval" from
"first-deploy side effects" — you can pre-arm via the AWS CLI ahead of time. Sections 0.1–0.4 below document the
equivalent commands. You do NOT need the preflight script checked out for this path; any reasonably current `aws` CLI
against the target account is enough.

You can mix paths across environments: for example, pre-arm production manually during a scheduled change window and let
the preflight auto-arm `dev` / `demo` / `pre-prod` on their first post-merge CI run. The preflight's auto-arm is a no-op
if both protections are already on, so running it against an environment that was already pre-armed is safe and only
takes a new on-demand backup.

Sections 0.1–0.4 are also useful as reference material — they show exactly what the preflight does under the hood — and
are the only viable path if the preflight reports a backup failure you want to retake with a specific `--backup-name`.

### 0.1 Arm deletion protection on every easy-genomics table

```bash
for t in "${EG_TABLES[@]}"; do
  aws dynamodb update-table \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --deletion-protection-enabled
done
```

Rerun is safe: if a table already has deletion protection, the call is a no-op.

### 0.2 Enable Point-In-Time Recovery on every easy-genomics table

```bash
for t in "${EG_TABLES[@]}"; do
  aws dynamodb update-continuous-backups \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
done
```

### 0.3 Verify the arming is in place

```bash
for t in "${EG_TABLES[@]}"; do
  printf "%s\t" "$t"
  aws dynamodb describe-table \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --query 'Table.DeletionProtectionEnabled' --output text
  aws dynamodb describe-continuous-backups \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text
done
```

Each table must report `True` for deletion protection and `ENABLED` for PITR before you run Phase 1 in that environment.
If you are following the default (preflight-driven) path you will typically see this output automatically at the end of
the preflight's auto-arm report; if you are on the manual pre-merge path, run the block above before merging the split
PR. Either way, do not proceed to Phase 1 until every table in the target environment shows both fields green — a single
un-armed table is enough to let CloudFormation drop it during the Phase 2 detach.

### 0.4 (Optional but recommended) Snapshot an on-demand backup per table

PITR gives continuous per-second recovery for 35 days. On-demand backups are an independent safety net that survives
even a rogue admin who disables deletion protection and runs `delete-table`.

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
for t in "${EG_TABLES[@]}"; do
  aws dynamodb create-backup \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --backup-name "pre-split-${TS}-${t}"
done
aws dynamodb list-backups --region "$AWS_REGION" \
  --time-range-lower-bound "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"
```

Record each returned `BackupArn` in the change ticket.

### 0.5 What Phase 0 does NOT do

Phase 0 only blocks DynamoDB's `DeleteTable` API. It does NOT add `DeletionPolicy: Retain` to the CloudFormation
template. That template-level metadata is what Phase 2 needs for a clean `DELETE_SKIPPED (DeletionPolicy: Retain)` event
during the nested-stack removal. Phase 1 handles that, but only at migration time, per environment.

---

## What CI does after the split PR merges

As soon as the PR is merged, the existing `cicd-release-quality.yml` pipeline fires on the target branch and runs
`pnpm run cicd-build-deploy-back-end`. The per-environment behaviour depends on whether Phase 0 arming has already
happened against that environment.

### First post-merge run against an un-armed environment

1. The back-end `deploy` task invokes the preflight script.
2. The preflight finds every easy-genomics table unprotected and takes the auto-arm path: on-demand backup +
   `UpdateTable DeletionProtectionEnabled=true` + `UpdateContinuousBackups PointInTimeRecoveryEnabled=true` per table.
3. The preflight exits `1` with its "PREFLIGHT AUTO-ARM COMPLETED — deploy intentionally halted" report.
4. `cdk deploy` never runs. CI reports a red build; no CloudFormation change was attempted.

### Subsequent runs against an armed-but-un-migrated environment

1. The preflight finds every table compliant and then queries CloudFormation for the resources of
   `*-main-back-end-stack`.
2. It finds the easy-genomics nested stack still present in `*-main-back-end-stack`, so it concludes the migration is
   pending and exits `1` with its "PREFLIGHT: migration pending — deploy intentionally halted" report.
3. `cdk deploy` never runs. CI reports a red build; no CloudFormation change was attempted.

### What happens if the preflight cannot reach CloudFormation

If the `ListStackResources` call fails (network, expired credentials, missing IAM permission on
`cloudformation:ListStackResources`, throttling) the preflight fails closed: it prints a clear error naming the
underlying cause and exits `2`. `cdk deploy` never runs. This is strictly better than letting the deploy proceed because
`cdk deploy` itself would fail on its first CloudFormation call a moment later with a far less readable error.

### What this means operationally

Until an operator executes Phases 1–5 in a given environment, every auto-deploy to that environment will red-build. That
is intentional — it is the loud signal that the cutover has not yet happened in that environment. Unrelated development
work continues to merge and red-build; the failures are non-destructive, only noisy.

If CI reports _green_ for a post-merge deploy on an environment that has not yet been migrated, **stop and
investigate**: that would mean either the preflight silently passed when it should not have, or Phase 0 did not actually
arm deletion protection on that environment. Check the eight physical tables via `aws dynamodb describe-table` before
anything else.

---

## Phase 1 — Retain bridge (per environment, at migration time)

**Goal: add `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` to every easy-genomics table _in the
currently-deployed CloudFormation template for `OLD_STACK`_, without removing the tables from the stack.** This is the
metadata Phase 2 needs to detach the tables cleanly (via `DELETE_SKIPPED`) rather than relying on deletion protection's
hard rejection.

Because the split PR is already merged to `development`, the tip of that branch cannot be used directly for this step —
`pnpm run build-and-deploy` from that tip will halt at the preflight's "migration pending" check, and even if the
preflight were bypassed, deletion protection from Phase 0 would reject the `DeleteTable` calls and force a noisy
CloudFormation rollback. Instead, build a short-lived "retain bridge" working tree that keeps the old stack topology but
picks up the new `dynamodb-construct.ts`.

### 1.1 Assemble the retain-bridge working tree

```bash
# Identify the last commit on the deployment branch BEFORE the split PR was merged.
# Concretely: the first parent of the merge commit on `development`.
#   git log --first-parent development   # find the merge commit
#   git log --pretty=%P -n 1 <merge-sha> # first SHA printed is the pre-PR parent
export PRE_PR_SHA=<sha>

# Create a throwaway branch pinned to that pre-PR state.
git switch -c retain-bridge-${ENV_TYPE}-${ENV_NAME} "$PRE_PR_SHA"

# Pull ONLY the new dynamodb-construct.ts file out of the merged PR.
git checkout development -- packages/back-end/src/infra/constructs/dynamodb-construct.ts

# Sanity-check: the ONLY staged/modified file should be dynamodb-construct.ts.
git status
git diff --stat HEAD

pnpm install --frozen-lockfile
cd packages/back-end
pnpm run build
```

If `git status` shows any file other than `dynamodb-construct.ts`, stop and clean up — a cross-file dependency in the
new code means the bridge cannot be constructed this simply, and the rest of the runbook must be revisited.

### 1.2 Deploy the retain bridge

> Note: Phases 1, 2, and 3 call `pnpm cdk diff` / `pnpm cdk deploy` / `pnpm cdk import` **directly** rather than going
> through `pnpm run build-and-deploy`. That is intentional. The preflight script is wired into `build-and-deploy` and
> will halt on "migration pending" until the cutover is complete, which is the correct behaviour for routine CI/CD
> deploys but would block the migration itself. The raw `cdk` commands below are the supported escape hatch for
> operators executing the runbook.

```bash
pnpm cdk diff "${OLD_STACK}"
```

Expected diff: **no resource adds or removes**. Only metadata changes on the eight easy-genomics tables —
`DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`. Deletion protection and PITR are already on (Phase 0), so CDK
will note them as already-set and render no change for those attributes.

If the diff shows any resource add or remove, **abort** and investigate. The bridge is supposed to be a metadata-only
deploy.

If the diff looks correct, deploy:

```bash
pnpm cdk deploy "${OLD_STACK}" --require-approval any-change
```

### 1.3 Confirm the deployed template now carries the retain metadata

Because the easy-genomics tables live inside `easy-genomics-nested-stack`, inspect that nested stack directly:

```bash
NESTED=$(aws cloudformation describe-stack-resources \
  --region "$AWS_REGION" \
  --stack-name "$OLD_STACK" \
  --query "StackResources[?ResourceType=='AWS::CloudFormation::Stack' && contains(LogicalResourceId, 'easygenomics')].PhysicalResourceId" \
  --output text)

aws cloudformation get-template \
  --region "$AWS_REGION" \
  --stack-name "$NESTED" \
  --template-stage Processed \
  --query 'TemplateBody' \
  --output json \
  | jq '[.Resources | to_entries[] | select(.value.Type == "AWS::DynamoDB::Table") | {id: .key, del: .value.DeletionPolicy, upd: .value.UpdateReplacePolicy}]'
```

Every entry in the returned array must show `"del": "Retain"` and `"upd": "Retain"`. If any table is still `"Delete"`
(or missing the field), halt — the bridge deploy did not land correctly, and Phase 2 will destroy data unless deletion
protection kicks in.

### 1.4 (Optional) Take a fresh on-demand backup

Phase 0 already produced an on-demand backup per table — either via the preflight's auto-arm (each backup is named
`preflight-autoarm-<UTC-timestamp>`) or via the manual Phase 0.4 step. Taking a fresh snapshot immediately before detach
gives you a narrower RPO if rollback is ever needed:

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
for t in "${EG_TABLES[@]}"; do
  aws dynamodb create-backup \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --backup-name "pre-detach-${TS}-${t}"
done
```

### 1.5 (Optional) Back up the non-prod data-provisioning lab bucket

Only applies if the environment has a `${account}-${NAME_PREFIX}-lab-bucket` and you care about its contents:

```bash
aws s3 sync "s3://${AWS_ACCOUNT_ID}-${NAME_PREFIX}-lab-bucket" \
           "./backups/${NAME_PREFIX}-lab-bucket-${TS}"
```

Restore is symmetrical after Phase 3 once the new bucket exists.

### 1.6 Switch back to the merged branch for the remaining phases

```bash
cd <repo-root>
git switch development
git branch -D retain-bridge-${ENV_TYPE}-${ENV_NAME}   # throw away the bridge branch
pnpm install --frozen-lockfile
cd packages/back-end
pnpm run build
```

Phases 2–5 all run from `development` (the merged split code).

---

## Phase 2 — Detach tables from the old stack (brief downtime starts here)

Goal: remove the easy-genomics nested stack (and everything inside it) from `OLD_STACK` with `Retain` semantics so the
physical tables survive as **orphaned AWS resources** — no longer tracked by CloudFormation but fully intact.

### 2.1 Announce maintenance window

Disable front-end traffic to the easy-genomics API for the duration of Phase 2 + Phase 3 + Phase 4. HealthOmics +
NF-Tower routes stay live because they're served from a different API Gateway in `OLD_STACK`.

### 2.2 Confirm you are on the merged split-stack code

```bash
cd <repo-root>
git switch development
git pull --ff-only
pnpm install --frozen-lockfile
cd packages/back-end
pnpm run build   # compile + synth
```

### 2.3 Deploy only the old stack update

This removes easy-genomics from `OLD_STACK`. Because we're NOT passing `--all`, the new stack is not touched yet.

```bash
pnpm cdk deploy "${OLD_STACK}" --require-approval any-change
```

Watch the CloudFormation events. You should see:

- `UPDATE_IN_PROGRESS` on `OLD_STACK`.
- `DELETE_IN_PROGRESS` / `DELETE_COMPLETE` on the `easy-genomics-nested-stack` and its child resources.
- For each table, `DELETE_SKIPPED (DeletionPolicy: Retain)` — this is the desired signal, and it only happens because
  Phase 1 put `DeletionPolicy: Retain` into the deployed template.
- Eventually `UPDATE_COMPLETE` on `OLD_STACK`.

If any table shows `DELETE_IN_PROGRESS` instead of `DELETE_SKIPPED`, **halt immediately**: Phase 1 did not actually land
the retain metadata. Deletion protection (Phase 0) will still reject the delete call and CloudFormation will roll back,
leaving the environment intact — but re-run Phase 1 before retrying Phase 2, otherwise you're relying on a backstop
rather than the primary mechanism.

Verify the tables still exist and are orphaned:

```bash
for t in "${EG_TABLES[@]}"; do
  aws dynamodb describe-table --region "$AWS_REGION" --table-name "$t" \
    --query 'Table.[TableName,TableStatus,ItemCount,DeletionProtectionEnabled]' \
    --output text
done
```

Every row should read `... ACTIVE <count> True`.

---

## Phase 3 — Create the new stack and import the tables

Goal: stand up `NEW_STACK` with everything except the DynamoDB tables, then use `cdk import` to adopt the eight orphaned
tables into the new stack.

### 3.1 Import the orphaned tables (non-interactive, mapping-file driven)

`cdk import` is the supported CDK command for this. We run it **non-interactively** with a pre-built
`--resource-mapping` JSON file rather than the interactive prompt flow, for two reasons documented in the "Why a mapping
file" callout below.

The eight tables are owned by the **top-level** `EasyGenomicsApiStack` (not a nested stack), so a single `cdk import`
invocation against `NEW_STACK` is sufficient to adopt all of them.

#### 3.1.1 Synthesize and build the resource-mapping file

```bash
cd packages/back-end

# Synthesize the cloud assembly. The preflight script (which guards
# build-and-deploy) is intentionally skipped here because Phase 0 has
# already completed for this environment; we just need the template
# files in cdk.out.
pnpm cdk synth --quiet

# Generate cdk.out/${NEW_STACK}.import-mapping.json — one entry per
# easy-genomics DynamoDB table, keyed by the table's CloudFormation
# LogicalResourceId in the synthesized template.
pnpm tsx scripts/build-import-mapping.ts --print
```

The script:

- Reads `cdk.out/${NEW_STACK}.template.json` (produced by the preceding `cdk synth`).
- Discovers every `AWS::DynamoDB::Table` in that template.
- Verifies that all eight expected easy-genomics tables are present (it fails closed if any are missing — see
  troubleshooting below).
- Writes the mapping JSON to `cdk.out/${NEW_STACK}.import-mapping.json`.
- With `--print`, also dumps the JSON to stdout so you can sanity-check the LogicalResourceId → TableName pairs before
  running `cdk import`.

A successful run logs (logical IDs vary by environment because they include CDK-generated hash suffixes):

```
build-import-mapping: wrote 8 table mapping(s) to .../cdk.out/${NEW_STACK}.import-mapping.json
  devdemoeasygenomicsdynamodbdevdemoorganizationtable82D88512  =>  TableName=dev-demo-organization-table
  devdemoeasygenomicsdynamodbdevdemolaboratorytableC343156B    =>  TableName=dev-demo-laboratory-table
  devdemoeasygenomicsdynamodbdevdemousertable1D1C0BA2          =>  TableName=dev-demo-user-table
  ...
```

Verify the eight `TableName` values match the eight physical names you confirmed orphaned at the end of Phase 2.3 (they
should — the script computes them from the same `namePrefix` rule the stack uses).

#### 3.1.2 Run `cdk import` non-interactively

```bash
pnpm cdk import "${NEW_STACK}" \
  --resource-mapping "cdk.out/${NEW_STACK}.import-mapping.json" \
  --require-approval any-change
```

With the mapping file present, `cdk import` does **not** prompt for any resource — it consumes the eight table entries
from the file and silently skips every other importable resource (Lambdas, API Gateway methods, IAM roles, etc.). Those
stateless resources will be freshly created in step 3.2.

Expect output similar to:

```
${NEW_STACK}
✨  Importing existing resources into stack 'devdemoeasygenomicsapistack'...
   ✅  AWS::DynamoDB::Table dev-demo-organization-table  (logical id: devdemoeasygenomicsdynamodb...82D88512)
   ✅  AWS::DynamoDB::Table dev-demo-laboratory-table    (logical id: devdemoeasygenomicsdynamodb...C343156B)
   ...
✨  Import complete!
```

#### Why a mapping file (and not the interactive `cdk import` prompts)

1. `cdk import` walks **every** importable resource in the new stack template — REST API, every API Gateway method,
   every Lambda permission. That's hundreds of prompts before any DynamoDB prompt appears, and it's easy for an operator
   to mis-skip a table prompt under that volume.
2. Earlier development-environment rehearsals hit a worse failure mode: the eight tables previously lived inside
   `EasyGenomicsNestedStack`, and the CDK importer **does not recurse into nested stacks**. The interactive flow walked
   all the parent-stack resources, never offered the table prompts, and exited "successfully" with zero tables adopted.
   The codebase has since reparented the tables onto the top-level `EasyGenomicsApiStack` (so single-stack import is now
   sufficient), but we keep the mapping-file approach because it is the only way to make the import step reproducible,
   reviewable in code review, and resistant to operator fatigue.

#### Troubleshooting

- **`build-import-mapping.ts` reports "missing one or more expected easy-genomics tables".** The synthesized template
  you pointed it at does not contain all eight tables at top-level scope. Either you ran it against the wrong stack
  name, or you're on a code revision where the tables still live inside a nested stack. Verify with
  `jq -r '.Resources | to_entries[] | select(.value.Type=="AWS::DynamoDB::Table") | .value.Properties.TableName' cdk.out/${NEW_STACK}.template.json`
  and reconcile before continuing — DO NOT proceed with a partial mapping.

- **`cdk import` exits "Import complete!" but `aws cloudformation describe-stack-resources` (step 3.3) shows zero
  DynamoDB tables in `NEW_STACK`.** Almost always means `cdk import` ran without `--resource-mapping` (or the mapping
  file was empty / wrong stack). Re-generate the mapping file and rerun step 3.1.2 with the explicit
  `--resource-mapping` flag. The orphaned tables are unaffected by the empty import — Phase 0 deletion protection +
  `Retain` removal policy guarantee they survive.

### 3.2 Deploy the new stack normally to create the stateless resources

```bash
pnpm cdk deploy "${NEW_STACK}" --require-approval any-change
```

This creates:

- The new easy-genomics REST API Gateway (new invoke URL).
- All easy-genomics Lambdas and their IAM execution roles.
- The SNS topics and SQS queues (empty).
- `DataProvisioningNestedStack` custom resources. (In non-prod, these will re-seed the default org / lab / test-user
  records into the already- imported tables. The seed records use fixed UUIDs so they simply overwrite themselves; they
  do not create duplicates.)

The eight DynamoDB tables are already tracked by `NEW_STACK` after step 3.1, so this deploy will not attempt to create
them again. If it does, stop and re-run `cdk import` — that indicates the import transaction was not committed.

### 3.3 Sanity-check ownership

```bash
aws cloudformation list-stack-resources \
  --region "$AWS_REGION" \
  --stack-name "$NEW_STACK" \
  --query 'StackResourceSummaries[?ResourceType==`AWS::DynamoDB::Table`].[LogicalResourceId,PhysicalResourceId,ResourceStatus]' \
  --output table
```

Expect all eight tables listed under `NEW_STACK`, with the original physical names.

Note: prefer `list-stack-resources` over `describe-stack-resources` here. For large stacks, `describe-stack-resources`
does not reliably return a complete set of resources (and an empty filter with `--output table` prints nothing), which
can look like "no tables" even when ownership is correct.

Also confirm the old stack no longer lists them:

```bash
aws cloudformation list-stack-resources \
  --region "$AWS_REGION" \
  --stack-name "$OLD_STACK" \
  --query 'StackResourceSummaries[?ResourceType==`AWS::DynamoDB::Table`].[LogicalResourceId,PhysicalResourceId,ResourceStatus]' \
  --output table
```

Should return an empty array for the easy-genomics tables.

### 3.4 Capture the new API URL

```bash
aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$NEW_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`EasyGenomicsApiUrl`].OutputValue' \
  --output text
```

Record this value — you will feed it to the front-end in Phase 4 as `AWS_EASY_GENOMICS_API_URL` (or wire it behind the
`ApiDomainStack` custom domain if enabled for the environment).

---

## Phase 4 — Smoke-test and re-enable traffic

### 4.1 Back-end smoke tests

Hit a couple of read endpoints directly against the new API URL, using a valid Cognito JWT, to confirm:

```bash
curl -H "Authorization: Bearer $COGNITO_TOKEN" \
  "${NEW_EG_API_URL%/}/easy-genomics/organization/list-organizations"
```

Expected: the list returned reflects existing data (organizations, labs, users, lab runs) — **not** an empty result. If
it returns empty, the import didn't actually adopt the tables; go to the rollback procedure.

### 4.2 Front-end rollout

Redeploy the front-end so it routes easy-genomics calls to the new API.

**CI/CD (recommended / default):** you do **not** need to manually create a new GitHub Actions secret or variable. The
repo's CI workflows derive `AWS_EASY_GENOMICS_API_URL` automatically at deploy time by reading the `EasyGenomicsApiUrl`
CloudFormation output from the `${ENV_TYPE}-${ENV_NAME}-easy-genomics-api-stack` stack and exporting it into the job
environment. If that stack/output doesn't exist yet (pre-migration), the variable is left unset and the front-end falls
back to the legacy single-API behavior.

**Manual / local deployments:** if you're deploying the front-end outside of the repo's CI workflows, you must set
`AWS_EASY_GENOMICS_API_URL` yourself to the value from Phase 3.4 (the `EasyGenomicsApiUrl` output of `NEW_STACK`, no
trailing slash), then rebuild/redeploy the front-end. `HttpFactory` will then route easy-genomics calls to the new API
and HealthOmics / NF-Tower calls to the existing back-end API.

### 4.3 Re-open traffic

Traffic can resume. Monitor CloudWatch for 5xx on either API for ~30 min.

---

## Phase 5 — Cleanup (same day or next)

1. Delete the on-demand backups from Phase 0.4 / Phase 1.4 only after a retention window you're comfortable with
   (recommend ≥ 7 days in non-prod, ≥ 30 days in prod).
2. Keep PITR and deletion protection enabled permanently — they're now enforced by code in the new stack.
3. Update any env-specific runbooks / SSM parameters / secret stores with the new API URL.
4. Verify the next CI auto-deploy against this environment goes **green**. Once the migration is complete,
   `cdk deploy --all` is once again a safe no-op for both stacks on this environment.

---

## Rollback procedure

If CI auto-deploy fails immediately after PR merge (before Phase 1):

- This is the **expected** behavior. What failed depends on the state of that environment:
  - Environment had never been armed before: the preflight auto-armed deletion protection and PITR on every table, took
    backups, and halted the deploy (exit `1`, "PREFLIGHT AUTO-ARM COMPLETED" banner). `cdk deploy` was never invoked, so
    no CloudFormation change was attempted.
  - Environment was already armed (by a previous preflight run or by the manual Phase 0.1–0.4 path): the preflight
    queried CloudFormation, found the easy-genomics nested stack still in `*-main-back-end-stack`, and halted the deploy
    with the "PREFLIGHT: migration pending" banner. Again, `cdk deploy` was never invoked.
  - Edge case — preflight wiring missing or `cdk deploy --all` invoked directly: CloudFormation tried to delete
    protected tables, DynamoDB refused, CloudFormation rolled back. The environment is in its pre-merge state.
- Nothing to undo in any of the three cases. Schedule Phases 1–5 at your convenience. Subsequent auto-deploys will keep
  red-building with the "migration pending" banner until the migration completes in this environment.

If Phase 1.2 (retain bridge deploy) fails:

- No resource changes were applied, since the bridge is a metadata-only update. Fix the error (usually a stale build
  artifact from the wrong branch) and re-run.

If Phase 2 fails (old stack update rolls back):

- `DeletionPolicy: Retain` (Phase 1) + deletion protection (Phase 0) means the tables are untouched.
- Investigate the failure, fix, and re-run Phase 2.

If Phase 3.1 (`cdk import`) fails before completion:

- The tables remain orphaned. Re-run `cdk import` after fixing the error.

If Phase 3.2 (new stack deploy) fails after the import:

- CloudFormation will roll back. The imported tables still have `DeletionPolicy: Retain`, so they will orphan again
  rather than delete. Re-try the deploy.

If Phase 4 reveals data issues (missing rows, wrong data):

1. Disable front-end traffic immediately.
2. Use PITR to restore each affected table to a point before the migration:

   ```bash
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name "${NAME_PREFIX}-organization-table" \
     --target-table-name "${NAME_PREFIX}-organization-table-restored" \
     --restore-date-time "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)"
   ```

3. Swap the restored table in for the canonical name. DynamoDB has no direct rename, so either:

   - Delete the bad canonical table (requires disabling deletion protection first), then restore the on-demand backup
     from Phase 0.4 / Phase 1.4 into the canonical name, or
   - Point-in-time restore to a new name and do a one-off `aws dynamodb scan` + `batch-write` copy back into the
     canonical table.

4. Post-mortem.

If the team decides to fully abandon the split:

- Revert the stack-split commit in git.
- Run `cdk import "${OLD_STACK}"` to re-adopt the tables into the original nested stack.
- Delete `NEW_STACK`. It's now empty apart from the imported tables, which will orphan again with Retain; you can then
  re-import those back into the reverted `OLD_STACK`.
- Deletion protection and PITR (Phase 0) can be left armed indefinitely — they are independent of stack topology.

---

## Appendix A — Table-to-construct-path mapping (for debugging `cdk import`)

The supported way to drive `cdk import` is the mapping-file flow described in Phase 3.1. This appendix exists for
operators who need to debug a mapping problem (e.g. cross-checking the JSON the script wrote, or reading raw
CloudFormation events). It is **not** a manual-prompt fallback — never operate `cdk import` against this stack
interactively, for the reasons documented in Phase 3.1.

The eight tables are created at the **top-level** `EasyGenomicsApiStack` scope (not inside any nested stack). Their
construct paths inside the synthesized cloud assembly are below; the mapping is identical across environments and the
only thing that changes is `${NAME_PREFIX}`.

| Physical TableName                                | Construct path                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `${NAME_PREFIX}-organization-table`               | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-organization-table/Resource`               |
| `${NAME_PREFIX}-laboratory-table`                 | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-table/Resource`                 |
| `${NAME_PREFIX}-user-table`                       | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-user-table/Resource`                       |
| `${NAME_PREFIX}-organization-user-table`          | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-organization-user-table/Resource`          |
| `${NAME_PREFIX}-laboratory-user-table`            | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-user-table/Resource`            |
| `${NAME_PREFIX}-laboratory-run-table`             | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-run-table/Resource`             |
| `${NAME_PREFIX}-unique-reference-table`           | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-unique-reference-table/Resource`           |
| `${NAME_PREFIX}-laboratory-workflow-access-table` | `${NAME_PREFIX}-easy-genomics-api-stack/${NAME_PREFIX}-easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-workflow-access-table/Resource` |

The corresponding CloudFormation `LogicalResourceId` is a flattened, hash-suffixed version of that path (see the
`--print` output of `scripts/build-import-mapping.ts` for the exact IDs in your environment). Do not hand-edit the
mapping file to use the construct path — `cdk import --resource-mapping` keys on `LogicalResourceId`, not path.

---

## Appendix B — Why not `cdk deploy --import-existing-resources`?

aws-cdk ≥ 2.170 supports `cdk deploy --import-existing-resources`, which adopts any already-existing resource whose
physical name matches a `CREATE` in the change set. In theory this collapses Phase 2 and Phase 3 into a single deploy.

It is **not** recommended for this migration:

1. Change-set ordering within a single `cdk deploy --all` is not guaranteed to run the `OLD_STACK` update before the
   `NEW_STACK` create. If the new stack's create runs first, the tables are still owned by the old stack and the import
   will fail with `ResourceAlreadyOwnedByStack`.
2. `cdk import` produces a more explicit, auditable paper trail (a dedicated change set with `ChangeSetType: IMPORT`).
   That is valuable in any incident review, not just prod ones.

If you want to experiment with `--import-existing-resources` in a sandbox, do so against a throwaway environment first.

---

## Appendix C — Cleanup / destroy for throwaway environments

Now that every environment uses `RemovalPolicy.RETAIN` + deletion protection + PITR, the old `cdk destroy` → "everything
vanishes" flow no longer works out of the box, not even in dev. That is intentional: it protects real data. When you
truly want to tear down a sandbox env:

```bash
# 1. Disable deletion protection on each table so CloudFormation / the CLI
#    can actually drop them.
for t in "${EG_TABLES[@]}"; do
  aws dynamodb update-table \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --no-deletion-protection-enabled
done

# 2. (Optional) Disable PITR to avoid paying for backups of a dying env.
for t in "${EG_TABLES[@]}"; do
  aws dynamodb update-continuous-backups \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=false
done

# 3. Explicitly delete the tables.
for t in "${EG_TABLES[@]}"; do
  aws dynamodb delete-table --region "$AWS_REGION" --table-name "$t"
done

# 4. Run cdk destroy as usual.
pnpm cdk destroy "${NEW_STACK}" "${OLD_STACK}"
```

Only run the above against environments you are certain you no longer need.
