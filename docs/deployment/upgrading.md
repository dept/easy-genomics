# Upgrading Easy Genomics

This guide is for lab IT staff who run their own Easy Genomics deployment. DEPT will notify you of new releases via chat
and share release notes. Once you have the target version, follow the procedure for your upgrade tier.

> Quick-jump: [Tier 1 — Routine](#3-tier-1-routine-upgrade) ·
> [Tier 2 — Additive DynamoDB](#4-tier-2-additive-dynamodb-changes) ·
> [Tier 3 — Breaking Migration](#5-tier-3-breaking-migration)

> **Dry-run notice:** This procedure has not yet been validated end-to-end against a live staging environment. Follow it
> as best-knowledge guidance and report any discrepancies to DEPT.

---

## 1. Find Your Upgrade Tier

### 1.1 Determine your current version

In your local clone of the repository:

```bash
git describe --tags
```

Or check your deployment's GitHub [Releases](https://github.com/dept/easy-genomics/releases) page to see the latest tag.

### 1.2 Find the target version

DEPT will share release notes with you when a new version is ready. You can also browse
[GitHub Releases](https://github.com/dept/easy-genomics/releases) directly.

### 1.3 Classify your upgrade

Look up your upgrade pair in the [Version Compatibility Matrix](#8-version-compatibility-matrix) at the bottom of this
page. Every row is labelled **Tier 1**, **Tier 2**, or **Tier 3**.

| Tier                       | What it means                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **1 — Routine**            | CDK / front-end changes only. No DynamoDB schema changes.                                  |
| **2 — Additive DynamoDB**  | New tables, new streams, new TTL fields, or new GSIs added. Existing data is untouched.    |
| **3 — Breaking Migration** | CloudFormation topology change or one-way data migration. A dedicated runbook is required. |

---

## 2. Pre-Upgrade Checklist (all tiers)

Complete this before starting any upgrade procedure.

- [ ] **AWS credentials are valid.**
  ```bash
  aws sts get-caller-identity
  ```
- [ ] **No workflow runs are actively processing.** In-flight runs may lose status updates during the deploy window.
      Check the Easy Genomics UI and wait for any running jobs to finish or be cancelled.
- [ ] **Record your current version.**
  ```bash
  git describe --tags   # save this; you will need it if you roll back
  ```
- [ ] **Tier 2 and Tier 3 only:** Notify lab users of a maintenance window (~15 min for Tier 2, longer for Tier 3 — see
      the runbook).

---

## 3. Tier 1: Routine Upgrade

No infrastructure or schema changes. Rolling deploy; no downtime expected.

**Steps**

1. Fetch the new tag and check it out:
   ```bash
   git fetch --tags
   git checkout <target-tag>    # e.g. git checkout v1.3.1
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Deploy:
   ```bash
   pnpm run build-and-deploy
   ```
4. Run [post-upgrade smoke tests](#6-post-upgrade-smoke-tests).
5. Confirm with users that the app is working normally.

**Rollback**

Always safe. Check out the previous tag and redeploy:

```bash
git checkout <previous-tag>
pnpm install
pnpm run build-and-deploy
```

---

## 4. Tier 2: Additive DynamoDB Changes

New tables, streams, TTL fields, or GSIs are added. All changes are purely additive — existing data is untouched. Expect
a ~5–10 min deploy window during which old and new application code may briefly coexist.

**Steps**

1. Complete the [pre-upgrade checklist](#2-pre-upgrade-checklist-all-tiers).

2. Set convenience variables (substitute your environment values):

   ```bash
   export AWS_REGION=us-east-1
   export ENV_TYPE=prod            # dev | demo | pre-prod | prod
   export ENV_NAME=acme            # value of env-name in easy-genomics.yaml
   export NAME_PREFIX="${ENV_TYPE}-${ENV_NAME}"
   ```

3. Take an on-demand backup of all DynamoDB tables:

   ```bash
   for TABLE in \
     organization laboratory user organization-user laboratory-user \
     laboratory-run unique-reference laboratory-workflow-access laboratory-data-tagging; do
     aws dynamodb create-backup \
       --table-name "${NAME_PREFIX}-${TABLE}-table" \
       --backup-name "${NAME_PREFIX}-${TABLE}-pre-upgrade-$(date +%Y%m%d)" \
       --region "$AWS_REGION" \
       --query 'BackupDetails.BackupStatus' \
       --output text
   done
   ```

   Each line should print `CREATING`. Backups complete asynchronously; you do not need to wait before proceeding.

4. Fetch the new tag and check it out:
   ```bash
   git fetch --tags
   git checkout <target-tag>
   ```
5. Install dependencies:
   ```bash
   pnpm install
   ```
6. Deploy:
   ```bash
   pnpm run build-and-deploy
   ```
7. Run [post-upgrade smoke tests](#6-post-upgrade-smoke-tests).
8. Confirm with users that the app is working normally.

**DynamoDB notes**

- New tables are created automatically by CDK on first deploy. No manual setup is needed.
- All tables use `RemovalPolicy.RETAIN` with deletion protection enabled. A failed or interrupted deploy **cannot delete
  your data**.
- The `unique-reference-table` enforces uniqueness for organisation names and user emails. It is managed transactionally
  by the application — no operator action is needed on upgrade.
- LSIs (Local Secondary Indexes) cannot be added to an existing table. Any release that requires a new LSI on an
  existing table will be classified **Tier 3**, not Tier 2.

**Rollback**

Safe. Redeploy the previous tag:

```bash
git checkout <previous-tag>
pnpm install
pnpm run build-and-deploy
```

New empty tables or attributes created by the failed/unwanted upgrade are orphaned but harmless. Delete them manually in
the AWS Console or via the CLI if you want a clean slate.

---

## 5. Tier 3: Breaking Migration

A CloudFormation topology change or one-way data migration is required. **A dedicated runbook is provided for each Tier
3 release.** Do not run any deploy command until you have read the runbook end-to-end.

| Breaking release                   | Runbook                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| v1.4 → next (back-end stack split) | [`docs/operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md`](../operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md) |

**Rollback**

Rollback safety is phase-dependent. See the **Rollback procedure** section of the relevant runbook for the full decision
matrix. General rules:

- **Before Phase 3 (`cdk import`):** Redeploying the previous tag is always safe. Tables are retained in place with
  deletion protection; no data is at risk.
- **After Phase 3:** Forward-fix only. Tables have been re-parented into the new CloudFormation stack. Rolling back to
  the old stack would orphan the data.

---

## 6. Post-Upgrade Smoke Tests

Run these after every upgrade, regardless of tier, before announcing the upgrade complete to your users.

### 6.1 Application loads

Open the application URL in a browser (your `app-domain-name` from `easy-genomics.yaml`, or the `ApplicationUrl`
CloudFormation output). Confirm the login page renders without errors.

### 6.2 Authentication

Log in as the system admin account. Confirm the dashboard loads.

### 6.3 Data integrity

Verify that existing organisations and laboratories are visible in the UI. If you prefer a direct API check, first
obtain a Cognito ID token (via the Easy Genomics login flow or AWS CLI), then:

```bash
export API_URL=https://<your-api-domain>    # no trailing slash
export COGNITO_TOKEN=<id-token>

# Should return existing organisations — NOT an empty list
curl -s -H "Authorization: Bearer $COGNITO_TOKEN" \
  "${API_URL}/easy-genomics/organization/list-organizations" | jq '.totalItems'

# Should return existing laboratories
curl -s -H "Authorization: Bearer $COGNITO_TOKEN" \
  "${API_URL}/easy-genomics/laboratory/list-laboratories" | jq '.totalItems'
```

### 6.4 CloudWatch error check

In the AWS Console, go to **CloudWatch → Log Groups**. Filter by `${ENV_TYPE}-${ENV_NAME}` and review the last 15
minutes across all Lambda log groups. No `ERROR`-level entries should appear after a healthy deploy.

---

## 7. Rollback Reference

| Tier                  | Redeploy previous tag? | Notes                                                                      |
| --------------------- | ---------------------- | -------------------------------------------------------------------------- |
| 1 — Routine           | ✅ Always safe         | No caveats.                                                                |
| 2 — Additive DynamoDB | ✅ Safe                | Orphaned empty tables/attributes are harmless; delete manually if desired. |
| 3 — Breaking          | ⚠️ Phase-dependent     | Before Phase 3: safe. After Phase 3: forward-fix only. See runbook.        |

---

## 8. Version Compatibility Matrix

Use this table to find your upgrade tier. If you are skipping multiple versions (e.g. v1.2 → v1.4), use the highest tier
that appears in any of the intermediate steps.

| Upgrade         | Tier | Change summary                                                                     | Runbook                                                                                             |
| --------------- | ---- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| v1.0.1 → v1.1   | 1    | UI only (skip button)                                                              | —                                                                                                   |
| v1.1 → v1.2     | 2    | Folder download as ZIP, sample sheet upload, smart search; new Lambda dependencies | —                                                                                                   |
| v1.2 → v1.2.1   | 1    | Build config fixes                                                                 | —                                                                                                   |
| v1.2.1 → v1.2.2 | 1    | Workflow result file access patches                                                | —                                                                                                   |
| v1.2.2 → v1.3   | 2    | TTL added to `laboratory-run-table`; HealthOmics run tagging                       | —                                                                                                   |
| v1.3 → v1.3.1   | 1    | Bug fixes                                                                          | —                                                                                                   |
| v1.3.1 → v1.4   | 2    | New `laboratory-data-tagging-table`; DynamoDB stream on `laboratory-run-table`     | —                                                                                                   |
| v1.4 → next     | 3    | Back-end CloudFormation stack split; DynamoDB table re-parenting                   | [EASY_GENOMICS_PROD_MIGRATION.md](../operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md) |

> **Maintainers:** When a new release ships, add a row to this table, classify its tier, and — for Tier 3 releases — add
> the runbook to `docs/operations/migration-runbooks/` before tagging.

---

## 9. Maintainer: Cutting a Release

This section is for **DEPT engineers** preparing a new Easy Genomics release. Lab operators do not need to read this.

### 9.1 Review what changed

```bash
export PREV_TAG=v1.4          # last released tag
export NEXT_TAG=v1.5          # tag you are about to cut

# Commit summary
git log ${PREV_TAG}..HEAD --oneline

# Infrastructure / CDK changes (tier signal)
git diff ${PREV_TAG}..HEAD -- packages/back-end/src/infra/

# DynamoDB table definitions specifically
git diff ${PREV_TAG}..HEAD -- \
  packages/back-end/src/infra/stacks/ \
  packages/back-end/src/infra/constructs/dynamodb-construct.ts
```

### 9.2 Classify the tier

Work through these rules in order — stop at the first match.

| Rule                                                                            | Tier  |
| ------------------------------------------------------------------------------- | ----- |
| Any CloudFormation stack topology change (stack added, removed, or renamed)     | **3** |
| Any LSI added to an existing table                                              | **3** |
| Any one-way data migration required (attribute rename, key format change, etc.) | **3** |
| Any new DynamoDB table, GSI, stream, or TTL attribute added                     | **2** |
| Front-end or Lambda changes only, no infra changes                              | **1** |

When in doubt, classify higher. A Tier 2 treated as Tier 1 skips the backup step; a Tier 3 treated as Tier 2 skips the
runbook entirely — both are dangerous.

### 9.3 Write the CHANGELOG entry

Add a new section above `## [Unreleased]` (or replace it if this is the unreleased content):

```markdown
## [vX.Y.Z] — <short title>

### Added

- …

### Changed

- …

### Fixed

- …

### Migration

<!-- Tier 2: describe any manual steps (usually none for additive changes) -->
<!-- Tier 3: include the hazard notice and runbook link, e.g.: -->
<!-- > **DATA-LOSS HAZARD for existing deployments.** See [runbook](./docs/operations/migration-runbooks/YOUR_RUNBOOK.md) BEFORE deploying. -->
```

### 9.4 Update the compatibility matrix

Add a row to the [Version Compatibility Matrix](#8-version-compatibility-matrix) table in this file:

```markdown
| v1.4 → v1.5 | 2 | <one-line change summary> | — |
```

For Tier 3 releases, add the runbook path in the last column and place the runbook file in
`docs/operations/migration-runbooks/` before tagging.

### 9.5 Tag and share

```bash
# Create a signed tag
git tag -s ${NEXT_TAG} -m "${NEXT_TAG}"
git push origin ${NEXT_TAG}
```

Then share the release notes with the lab via chat. Include:

- The new version tag (e.g. `v1.5`)
- The upgrade tier and what it means for them (routine / backup needed / follow the runbook)
- A link to this file for the full procedure
- Any Tier 3 runbook link if applicable
