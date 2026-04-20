# Easy Genomics API Split — Migration Runbook (all environments)

## Purpose

This runbook describes the exact sequence of steps required to safely migrate a deployment of the Easy Genomics back-end
from the pre-split layout (`easy-genomics-nested-stack` owned by `*-main-back-end-stack`) to the split layout
(`easy-genomics-nested-stack` owned by the new `*-easy-genomics-api-stack`).

**This runbook is intentionally environment-agnostic.** The same sequence of commands applies to `dev`, `demo`,
`pre-prod` and `prod`. The Easy Genomics DynamoDB tables are configured with `RemovalPolicy.RETAIN`, deletion
protection, and Point-In-Time-Recovery in every environment, so the import- based migration flow below is the **only**
supported path on every stack.

There are two strong reasons we do not special-case prod:

1. **Rehearsal.** Non-prod environments now use the exact same retain + import mechanics, so any bug in the runbook
   (permissions, logical IDs, flag names, etc.) surfaces in dev/demo long before it matters in prod.
2. **Non-prod data is not disposable.** Generating real AWS HealthOmics workflow runs is expensive. The
   `laboratory-run-table` and related tables hold the only easy-genomics-side mapping between lab runs and HealthOmics /
   Seqera run IDs. Losing them in dev means real time and money to recreate test data, not just a seed replay.

A naive `cdk deploy --all` will **fail** on any existing environment because every easy-genomics DynamoDB table has a
fixed physical name (`${namePrefix}-organization-table`, `${namePrefix}-laboratory-table`, etc.) and CloudFormation
cannot create a duplicate while the retained original is still around.

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

## Phase 1 — Safety net (no downtime)

Goal: guarantee that every table is recoverable independent of CloudFormation before we change any stack membership.

The code change that introduces `deletionProtection: true` and PITR on every environment has already landed. Phase 1 is
mostly about verifying it has actually been deployed and that on-demand backups exist.

### 1.1 Deploy the RETAIN / deletionProtection / PITR code update

From the commit that introduces the `dynamodb-construct.ts` change **but NOT yet** the stack-split refactor (or the same
commit with a targeted deploy of only the old stack):

```bash
cd packages/back-end
# Targeted deploy; do NOT run --all yet, that would trigger the split.
pnpm cdk deploy "${OLD_STACK}" --require-approval any-change
```

The diff should show no resource ADDs / REMOVEs. Expect only metadata changes: `DeletionPolicy: Retain`,
`UpdateReplacePolicy: Retain`, `DeletionProtectionEnabled: true`, `PointInTimeRecoverySpecification`.

### 1.2 Verify PITR + deletion protection are active on every table

```bash
for t in "${EG_TABLES[@]}"; do
  aws dynamodb describe-continuous-backups \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text
  aws dynamodb describe-table \
    --region "$AWS_REGION" \
    --table-name "$t" \
    --query 'Table.DeletionProtectionEnabled' \
    --output text
done
```

Each table should report `ENABLED` for PITR and `True` for deletion protection. If any table reports otherwise, halt and
investigate before proceeding.

### 1.3 Take an on-demand backup of every table

PITR gives you 35 days of per-second recovery. On-demand backups are an independent safety net that survives even a
table delete.

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

### 1.4 (Optional) Back up the non-prod data-provisioning lab bucket

Only applies if the environment has a `${account}-${NAME_PREFIX}-lab-bucket` and you care about its contents:

```bash
aws s3 sync "s3://${AWS_ACCOUNT_ID}-${NAME_PREFIX}-lab-bucket" \
           "./backups/${NAME_PREFIX}-lab-bucket-${TS}"
```

Restore is symmetrical after Phase 3 once the new bucket exists.

---

## Phase 2 — Detach tables from the old stack (brief downtime starts here)

Goal: remove the easy-genomics nested stack (and everything inside it) from `OLD_STACK` with `Retain` semantics so the
physical tables survive as **orphaned AWS resources** — no longer tracked by CloudFormation but fully intact.

### 2.1 Announce maintenance window

Disable front-end traffic to the easy-genomics API for the duration of Phase 2 + Phase 3 + Phase 4. HealthOmics +
NF-Tower routes stay live because they're served from a different API Gateway in `OLD_STACK`.

### 2.2 Check out the stack-split commit and build

```bash
git checkout <commit-that-splits-easy-genomics>
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
- For each table, `DELETE_SKIPPED (DeletionPolicy: Retain)` — this is the desired signal.
- Eventually `UPDATE_COMPLETE` on `OLD_STACK`.

If any table shows `DELETE_IN_PROGRESS` instead of `DELETE_SKIPPED`, **halt immediately**: the DeletionPolicy was not
applied correctly in Phase 1. Deletion protection (step 1.2 verified) should still reject the delete call and
CloudFormation will roll back.

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

### 3.1 Import the orphaned tables

`cdk import` is the supported CDK command for this. Run it against the new stack. CDK will:

1. Detect that the stack does not yet exist.
2. Identify the DynamoDB tables as "new" resources that have `DeletionPolicy: Retain`, which is CDK's heuristic for
   "this is probably an import target".
3. Prompt you for the physical name of each table.

```bash
pnpm cdk import "${NEW_STACK}" --require-approval any-change
```

At each prompt, paste the matching physical table name from `$EG_TABLES`. For example:

```
demo-easy-genomics-nested-stack/...-organization-table/Resource (AWS::DynamoDB::Table):
  enter TableName: dev-acme-organization-table
demo-easy-genomics-nested-stack/...-laboratory-table/Resource (AWS::DynamoDB::Table):
  enter TableName: dev-acme-laboratory-table
...
```

If `cdk import` complains that other resources (Lambdas, API Gateway methods, IAM roles) are not importable, accept —
those are the auto-named, stateless resources that will be freshly created by step 3.2. The `cdk import` command also
supports a `--resources` flag that restricts it to a specific logical-ID list if you want to narrow the scope; see
`cdk import --help`.

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
aws cloudformation describe-stack-resources \
  --region "$AWS_REGION" \
  --stack-name "$NEW_STACK" \
  --query 'StackResources[?ResourceType==`AWS::DynamoDB::Table`].[LogicalResourceId,PhysicalResourceId]' \
  --output table
```

Expect all eight tables listed under `NEW_STACK`, with the original physical names.

Also confirm the old stack no longer lists them:

```bash
aws cloudformation describe-stack-resources \
  --region "$AWS_REGION" \
  --stack-name "$OLD_STACK" \
  --query 'StackResources[?ResourceType==`AWS::DynamoDB::Table`].[LogicalResourceId,PhysicalResourceId]' \
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

Update the front-end's environment config with the new `AWS_EASY_GENOMICS_API_URL` and redeploy. `HttpFactory` will
route easy-genomics calls to the new API and HealthOmics / NF-Tower calls to the existing back-end API.

### 4.3 Re-open traffic

Traffic can resume. Monitor CloudWatch for 5xx on either API for ~30 min.

---

## Phase 5 — Cleanup (same day or next)

1. Delete the on-demand backups from Phase 1.3 only after a retention window you're comfortable with (recommend ≥ 7 days
   in non-prod, ≥ 30 days in prod).
2. Keep PITR and deletion protection enabled permanently — they're now the default via code.
3. Update any env-specific runbooks / SSM parameters / secret stores with the new API URL.

---

## Rollback procedure

If Phase 2 fails (old stack update rolls back):

- Nothing to do. RETAIN + deletion protection mean the tables are untouched.
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
     from Phase 1.3 into the canonical name, or
   - Point-in-time restore to a new name and do a one-off `aws dynamodb scan` + `batch-write` copy back into the
     canonical table.

4. Post-mortem.

If the team decides to fully abandon the split:

- Revert the stack-split commit in git.
- Run `cdk import "${OLD_STACK}"` to re-adopt the tables into the original nested stack.
- Delete `NEW_STACK`. It's now empty apart from the imported tables, which will orphan again with Retain; you can then
  re-import those back into the reverted `OLD_STACK`.

---

## Appendix A — Table-to-construct-path mapping (for `cdk import` prompts)

`cdk import` prompts you using the CDK construct path, not the final CloudFormation logical ID. The mapping is identical
across environments; the only thing that changes is `${NAME_PREFIX}`.

| Physical TableName                                | Construct path (truncated)                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `${NAME_PREFIX}-organization-table`               | `.../easy-genomics-dynamodb/${NAME_PREFIX}-organization-table/Resource`               |
| `${NAME_PREFIX}-laboratory-table`                 | `.../easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-table/Resource`                 |
| `${NAME_PREFIX}-user-table`                       | `.../easy-genomics-dynamodb/${NAME_PREFIX}-user-table/Resource`                       |
| `${NAME_PREFIX}-organization-user-table`          | `.../easy-genomics-dynamodb/${NAME_PREFIX}-organization-user-table/Resource`          |
| `${NAME_PREFIX}-laboratory-user-table`            | `.../easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-user-table/Resource`            |
| `${NAME_PREFIX}-laboratory-run-table`             | `.../easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-run-table/Resource`             |
| `${NAME_PREFIX}-unique-reference-table`           | `.../easy-genomics-dynamodb/${NAME_PREFIX}-unique-reference-table/Resource`           |
| `${NAME_PREFIX}-laboratory-workflow-access-table` | `.../easy-genomics-dynamodb/${NAME_PREFIX}-laboratory-workflow-access-table/Resource` |

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
