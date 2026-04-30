/**
 * Pre-deploy safety check that runs BEFORE `cdk deploy` in the back-end
 * `deploy` / `build-and-deploy` tasks.
 *
 * Purpose
 * -------
 * This version of the back-end splits the old `easy-genomics-nested-stack`
 * out of `*-main-back-end-stack` into a new top-level
 * `*-easy-genomics-api-stack`. During that CloudFormation update, the old
 * nested stack is removed, which causes CloudFormation to call
 * `DeleteTable` on every easy-genomics DynamoDB table using whatever
 * `DeletionPolicy` is in the currently-deployed template.
 *
 * In deployments created from an `envType: dev` / `demo` / `pre-prod`
 * configuration (or any pre-split code revision that didn't set RETAIN),
 * that policy is `Delete`. Without deletion protection armed on the
 * actual DynamoDB tables, those `DeleteTable` calls SUCCEED and the data
 * is lost.
 *
 * This script runs outside of CloudFormation, so it catches the problem
 * BEFORE any destructive API call is made.
 *
 * Behaviour
 * ---------
 * The preflight runs two checks, in order, before handing control back
 * to `cdk deploy`:
 *
 *   1. Table-level arming check. If any easy-genomics DynamoDB table is
 *      missing deletion protection or PITR, auto-arm the Phase 0
 *      protections described in `docs/EASY_GENOMICS_PROD_MIGRATION.md`:
 *
 *        a. Take an on-demand backup of each affected table
 *           (belt-and-braces safety net that survives even a rogue
 *           admin who later disables deletion protection and runs
 *           `delete-table`).
 *        b. Call `dynamodb:UpdateTable DeletionProtectionEnabled=true`.
 *        c. Call `dynamodb:UpdateContinuousBackups` to enable PITR.
 *
 *      All three operations are idempotent — setting a value that is
 *      already set is a no-op. Tables that are already compliant are
 *      not touched. After auto-arming, the preflight intentionally
 *      exits non-zero to halt the deploy with a clear, prescriptive
 *      message, because Phases 1-5 of the migration (retain bridge →
 *      detach → `cdk import` → smoke-test → cleanup) still need to be
 *      executed by an operator before the split deploy can succeed.
 *
 *   2. Migration-state check. If every table is compliant, confirm that
 *      the old `*-main-back-end-stack` no longer owns the easy-genomics
 *      nested stack. If it does, the migration is still pending — we
 *      halt the deploy with a friendly message rather than letting
 *      `cdk deploy` trip the CloudFormation rollback that would
 *      otherwise fire when DynamoDB rejects the nested-stack
 *      `DeleteTable` calls.
 *
 * If both checks pass the preflight exits 0 and `cdk deploy --all`
 * runs normally.
 *
 * Flags
 * -----
 *   --no-auto-arm
 *       Read-only behaviour: still run the check, but DO NOT modify any
 *       AWS resource. Instead, fail with the manual CLI commands the
 *       operator would have to run. Useful when the deploying principal
 *       is not authorised to call `UpdateTable` / `UpdateContinuousBackups`
 *       and you want to hand the fix-up off to someone who is.
 *
 * There is intentionally NO full-bypass flag. Fresh / greenfield deploys
 * are not in any danger from this preflight: tables that don't exist yet
 * are reported as "missing (fresh deploy; skipping)" and never mutated.
 * On first deploy of a brand-new environment the preflight completes
 * silently with zero actions.
 *
 * Edge cases
 * ----------
 *  - If a table doesn't exist at all, it is skipped (fresh deploy;
 *    nothing at risk).
 *  - Backup creation failures are logged but are NOT treated as preflight
 *    failures; the backup is an additive safety net, not the critical
 *    arming action.
 *  - `UpdateTable` / `UpdateContinuousBackups` failures ARE treated as
 *    hard failures; the operator must resolve them (typically IAM) and
 *    rerun.
 *
 * See `docs/EASY_GENOMICS_PROD_MIGRATION.md` for the full migration
 * runbook this guard protects.
 */

import { join } from 'path';
import { CloudFormationClient, ListStackResourcesCommand, StackResourceSummary } from '@aws-sdk/client-cloudformation';
import {
  CreateBackupCommand,
  DescribeContinuousBackupsCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateContinuousBackupsCommand,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';
import { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import { loadConfigurations } from '@easy-genomics/shared-lib/src/app/utils/configuration';

const EG_TABLE_SUFFIXES = [
  'organization-table',
  'laboratory-table',
  'user-table',
  'organization-user-table',
  'laboratory-user-table',
  'laboratory-run-table',
  'unique-reference-table',
  'laboratory-workflow-access-table',
  'laboratory-data-tagging-table',
] as const;

type FailureReason = 'deletion-protection-disabled' | 'pitr-disabled';

type TableCheckFailure = {
  tableName: string;
  reason: FailureReason;
};

type DeployEnv = {
  envName: string;
  envType: string;
  awsRegion: string;
  namePrefix: string;
};

type ArmActionKind = 'backup' | 'deletion-protection' | 'pitr';

type ArmAction =
  | { kind: ArmActionKind; ok: true; detail?: string }
  | { kind: ArmActionKind; ok: false; detail: string };

type MigrationState =
  // `*-main-back-end-stack` does not exist (fresh / greenfield deploy).
  | { kind: 'fresh' }
  // `*-main-back-end-stack` exists and still contains an easy-genomics
  // nested stack, i.e. Phases 1-5 of the runbook have NOT been executed
  // for this environment yet. The deploy must be halted here — letting
  // `cdk deploy` continue would trigger a CloudFormation rollback when
  // DynamoDB deletion protection rejects the nested-stack `DeleteTable`
  // calls.
  | { kind: 'pending'; nestedStack: { logicalId: string; physicalId: string } }
  // `*-main-back-end-stack` exists but no longer contains the
  // easy-genomics nested stack. The migration is complete (or was never
  // applicable). Pass through to `cdk deploy`.
  | { kind: 'complete' }
  // Something else went wrong talking to CloudFormation (permissions,
  // network). We fail closed: `cdk deploy` needs CloudFormation too, so
  // any transient CFN failure here would fail the deploy a moment later
  // with a far less readable error. Surfacing it from the preflight
  // gives the operator a clean message and a chance to fix it before
  // anything else runs.
  | { kind: 'unknown'; reason: string };

function resolveDeployEnv(): DeployEnv {
  // Mirror `packages/back-end/src/main.ts` so the preflight check targets
  // exactly the deployment the subsequent `cdk deploy` will act on.
  if (process.env.CI_CD === 'true') {
    const envName = process.env.ENV_NAME;
    const envType = process.env.ENV_TYPE;
    const awsRegion = process.env.AWS_REGION;
    if (!envName || !envType || !awsRegion) {
      throw new Error(
        'Preflight: CI_CD=true but ENV_NAME / ENV_TYPE / AWS_REGION are not all set. ' +
          'Fix the CI environment or run locally without CI_CD=true to fall back to easy-genomics.yaml.',
      );
    }
    return { envName, envType, awsRegion, namePrefix: `${envType}-${envName}` };
  }

  const configPath = join(__dirname, '../../../config/easy-genomics.yaml');
  const configurations: { [p: string]: ConfigurationSettings }[] = loadConfigurations(configPath);
  if (configurations.length !== 1) {
    throw new Error(
      `Preflight: expected exactly one configuration collection in easy-genomics.yaml, found ${configurations.length}. ` +
        'Fix the configuration before running `build-and-deploy`.',
    );
  }
  const [configuration] = configurations;
  const envName = Object.keys(configuration)[0];
  const settings = Object.values(configuration)[0];
  const envType = settings['env-type'];
  const awsRegion = settings['aws-region'];
  if (!envName || !envType || !awsRegion) {
    throw new Error('Preflight: env-name / env-type / aws-region missing from easy-genomics.yaml.');
  }
  return { envName, envType, awsRegion, namePrefix: `${envType}-${envName}` };
}

async function checkTable(client: DynamoDBClient, tableName: string): Promise<TableCheckFailure[] | 'missing'> {
  const failures: TableCheckFailure[] = [];

  let describe;
  try {
    describe = await client.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return 'missing';
    }
    throw err;
  }

  if (describe.Table?.DeletionProtectionEnabled !== true) {
    failures.push({ tableName, reason: 'deletion-protection-disabled' });
  }

  // Even if deletion protection is already on, verify PITR too. We treat an
  // un-armed PITR state as a regression from what the new
  // `dynamodb-construct.ts` code promises and from what the migration
  // runbook's rollback path assumes is available.
  const backups = await client.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
  const pitrStatus = backups.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
  if (pitrStatus !== 'ENABLED') {
    failures.push({ tableName, reason: 'pitr-disabled' });
  }

  return failures;
}

async function armTable(
  client: DynamoDBClient,
  tableName: string,
  reasons: Set<FailureReason>,
  backupTs: string,
): Promise<ArmAction[]> {
  const actions: ArmAction[] = [];

  // 1. Snapshot BEFORE mutating. The backup is an independent safety net
  //    that outlives even a later deliberate disabling of deletion
  //    protection. DynamoDB backup names are scoped per-table, so the
  //    timestamp alone is enough to avoid collisions on retries within
  //    the same second.
  try {
    const backup = await client.send(
      new CreateBackupCommand({
        TableName: tableName,
        BackupName: `preflight-autoarm-${backupTs}`,
      }),
    );
    actions.push({
      kind: 'backup',
      ok: true,
      detail: backup.BackupDetails?.BackupArn ?? '(no ARN returned)',
    });
  } catch (err) {
    // A backup failure is logged loudly but is NOT fatal: the critical
    // operation is the arming itself. If the backup failed because of an
    // IAM gap, the arming call below will also fail and we'll halt there
    // with a hard error.
    actions.push({
      kind: 'backup',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (reasons.has('deletion-protection-disabled')) {
    try {
      await client.send(
        new UpdateTableCommand({
          TableName: tableName,
          DeletionProtectionEnabled: true,
        }),
      );
      actions.push({ kind: 'deletion-protection', ok: true });
    } catch (err) {
      actions.push({
        kind: 'deletion-protection',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (reasons.has('pitr-disabled')) {
    try {
      await client.send(
        new UpdateContinuousBackupsCommand({
          TableName: tableName,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      );
      actions.push({ kind: 'pitr', ok: true });
    } catch (err) {
      actions.push({
        kind: 'pitr',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return actions;
}

async function checkMigrationState(client: CloudFormationClient, oldStackName: string): Promise<MigrationState> {
  // Paginate through the old stack's resources looking for a child stack
  // whose identity screams "easy-genomics". CDK's nested-stack construct
  // names mangle to camelCase + a hash in the LogicalResourceId (e.g.
  // `easygenomicsnestedstack9A1B2C3D`), and the PhysicalResourceId is the
  // child stack's ARN (which contains the full nested-stack name). Both
  // are reliable matches, so we accept a hit on either.
  const collected: StackResourceSummary[] = [];
  let nextToken: string | undefined;
  try {
    do {
      const resp = await client.send(new ListStackResourcesCommand({ StackName: oldStackName, NextToken: nextToken }));
      if (resp.StackResourceSummaries) {
        collected.push(...resp.StackResourceSummaries);
      }
      nextToken = resp.NextToken;
    } while (nextToken);
  } catch (err) {
    // CloudFormation returns a ValidationError (plain Error with that
    // code) for "stack does not exist". We treat that as a greenfield
    // deploy.
    const message = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(message)) {
      return { kind: 'fresh' };
    }
    return { kind: 'unknown', reason: message };
  }

  const nestedStacks = collected.filter(
    (r) =>
      r.ResourceType === 'AWS::CloudFormation::Stack' &&
      // Match the logical id (camelCased construct path) or the physical id
      // (the resolved nested stack ARN/name). Both contain the literal
      // "easygenomics" / "easy-genomics" when this is the easy-genomics
      // nested stack. Case-insensitive to be safe against CDK naming
      // changes.
      [r.LogicalResourceId, r.PhysicalResourceId].some(
        (candidate) => candidate !== undefined && /easy[-]?genomics/i.test(candidate),
      ),
  );

  if (nestedStacks.length === 0) {
    return { kind: 'complete' };
  }

  const [first] = nestedStacks;
  return {
    kind: 'pending',
    nestedStack: {
      logicalId: first.LogicalResourceId ?? '(unknown)',
      physicalId: first.PhysicalResourceId ?? '(unknown)',
    },
  };
}

function printMigrationPendingReport(
  namePrefix: string,
  oldStackName: string,
  nestedStack: { logicalId: string; physicalId: string },
): void {
  const hr = '='.repeat(78);
  console.error('');
  console.error(hr);
  console.error('PREFLIGHT: migration pending — deploy intentionally halted.');
  console.error(hr);
  console.error('');
  console.error(`Environment: ${namePrefix}`);
  console.error('');
  console.error('Good news:');
  console.error('  - All easy-genomics DynamoDB tables have deletion protection and PITR');
  console.error('    enabled. Your data cannot be deleted by CloudFormation or anything else.');
  console.error('');
  console.error('What this check found:');
  console.error(`  - Stack "${oldStackName}" still contains the easy-genomics nested stack:`);
  console.error(`      logical id:  ${nestedStack.logicalId}`);
  console.error(`      physical id: ${nestedStack.physicalId}`);
  console.error('    This means Phases 1-5 of the migration runbook have NOT yet been');
  console.error('    executed for this environment.');
  console.error('');
  console.error('Why we are halting instead of continuing:');
  console.error('  - If we handed control to `cdk deploy` now, CloudFormation would try to');
  console.error('    remove the nested stack and issue DeleteTable on every easy-genomics');
  console.error('    DynamoDB table.');
  console.error('  - DynamoDB would reject those calls because of deletion protection, and');
  console.error('    CloudFormation would roll the stack back. Your data would stay safe,');
  console.error('    but you would see a noisy, hard-to-read CloudFormation failure instead');
  console.error('    of this message.');
  console.error('');
  console.error('What to do next:');
  console.error('  1. Read docs/EASY_GENOMICS_PROD_MIGRATION.md. Phase 0 is already done.');
  console.error(`  2. Execute Phases 1-5 for the "${namePrefix}" environment.`);
  console.error('  3. Rerun `pnpm run build-and-deploy`. The preflight will pass and');
  console.error('     `cdk deploy --all` will succeed.');
  console.error('');
  console.error(hr);
  console.error('');
}

function printManualFailureReport(namePrefix: string, awsRegion: string, failures: TableCheckFailure[]): void {
  const byReason = new Map<FailureReason, string[]>();
  for (const f of failures) {
    const bucket = byReason.get(f.reason) ?? [];
    bucket.push(f.tableName);
    byReason.set(f.reason, bucket);
  }

  const unprotected = byReason.get('deletion-protection-disabled') ?? [];
  const withoutPitr = byReason.get('pitr-disabled') ?? [];
  const allAffected = Array.from(new Set(failures.map((f) => f.tableName)));

  const hr = '='.repeat(78);
  console.error('');
  console.error(hr);
  console.error('PREFLIGHT SAFETY CHECK FAILED (--no-auto-arm) — deploy aborted.');
  console.error(hr);
  console.error('');
  console.error('This release removes the easy-genomics nested stack from *-main-back-end-stack.');
  console.error('When CloudFormation applies that change it will call DeleteTable on each');
  console.error('easy-genomics DynamoDB table. Without deletion protection armed on the');
  console.error('underlying tables, those calls WILL SUCCEED and irrecoverably delete data.');
  console.error('');
  console.error('You ran the preflight with --no-auto-arm, so no AWS resources were modified.');
  console.error('');
  if (unprotected.length > 0) {
    console.error('Tables missing deletion protection (HIGH RISK):');
    for (const t of unprotected) {
      console.error(`  - ${t}`);
    }
    console.error('');
  }
  if (withoutPitr.length > 0) {
    console.error('Tables missing Point-In-Time Recovery (recovery path unavailable):');
    for (const t of withoutPitr) {
      console.error(`  - ${t}`);
    }
    console.error('');
  }
  console.error('To fix manually, run the following against the target AWS account/region');
  console.error('before retrying the deploy:');
  console.error('');
  console.error(`  export AWS_REGION=${awsRegion}`);
  console.error('');
  if (unprotected.length > 0) {
    console.error('  # Arm deletion protection on every affected table:');
    for (const t of unprotected) {
      console.error(
        `  aws dynamodb update-table --region "$AWS_REGION" --table-name ${t} --deletion-protection-enabled`,
      );
    }
    console.error('');
  }
  if (withoutPitr.length > 0) {
    console.error('  # Enable Point-In-Time Recovery on every affected table:');
    for (const t of withoutPitr) {
      console.error(
        `  aws dynamodb update-continuous-backups --region "$AWS_REGION" --table-name ${t} ` +
          "--point-in-time-recovery-specification 'PointInTimeRecoveryEnabled=true'",
      );
    }
    console.error('');
  }
  console.error('Or drop --no-auto-arm and let the preflight perform these Phase 0 steps');
  console.error('automatically.');
  console.error('');
  console.error('Then follow docs/EASY_GENOMICS_PROD_MIGRATION.md starting at Phase 1');
  console.error(`(retain bridge) to complete the migration for the "${namePrefix}" environment.`);
  console.error('');
  console.error(hr);
  console.error(`Affected tables: ${allAffected.length}`);
  console.error(hr);
  console.error('');
}

function printAutoArmReport(namePrefix: string, armResults: Map<string, ArmAction[]>, hardFailures: number): void {
  const hr = '='.repeat(78);
  console.error('');
  console.error(hr);
  if (hardFailures > 0) {
    console.error('PREFLIGHT AUTO-ARM PARTIALLY FAILED — deploy aborted.');
  } else {
    console.error('PREFLIGHT AUTO-ARM COMPLETED — deploy intentionally halted.');
  }
  console.error(hr);
  console.error('');
  console.error(`Environment: ${namePrefix}`);
  console.error('');
  console.error('Per-table actions:');
  console.error('');
  for (const [tableName, actions] of armResults) {
    console.error(`  ${tableName}`);
    for (const action of actions) {
      const label =
        action.kind === 'backup'
          ? 'on-demand backup'
          : action.kind === 'deletion-protection'
            ? 'arm deletion protection'
            : 'enable PITR';
      if (action.ok) {
        const detail = action.detail ? ` (${action.detail})` : '';
        console.error(`    ok   - ${label}${detail}`);
      } else {
        console.error(`    FAIL - ${label}: ${action.detail}`);
      }
    }
  }
  console.error('');

  if (hardFailures > 0) {
    console.error(`${hardFailures} critical arming action(s) failed. The most common cause is missing IAM`);
    console.error('permissions on the deploying principal. Confirm it has:');
    console.error('  - dynamodb:UpdateTable');
    console.error('  - dynamodb:UpdateContinuousBackups');
    console.error('  - dynamodb:CreateBackup');
    console.error('  - dynamodb:DescribeTable');
    console.error('  - dynamodb:DescribeContinuousBackups');
    console.error('against every easy-genomics table, then rerun the deploy.');
    console.error('');
    console.error(hr);
    console.error('');
    return;
  }

  console.error('All affected tables now have deletion protection + PITR armed, with an');
  console.error('on-demand backup taken immediately before arming. Your data is safe from');
  console.error('any `DeleteTable` call, including the one CloudFormation would issue during');
  console.error('the stack split.');
  console.error('');
  console.error('Why the deploy is still halted');
  console.error('------------------------------');
  console.error('Arming is only Phase 0 of the migration. The stack split itself requires a');
  console.error('retain-bridge deploy, detach, and `cdk import` — steps that must be driven');
  console.error('by an operator (they involve git history and interactive imports). The next');
  console.error('`cdk deploy --all` of this code against an un-migrated environment would');
  console.error('fail on CloudFormation rollback anyway (deletion protection now rejects');
  console.error('CFN`s DeleteTable calls); halting here gives you a clearer signal.');
  console.error('');
  console.error('What to do next');
  console.error('---------------');
  console.error('1. Read docs/EASY_GENOMICS_PROD_MIGRATION.md. You can skip Phase 0 (done).');
  console.error(`2. Execute Phases 1-5 for the "${namePrefix}" environment.`);
  console.error('3. Rerun `pnpm run build-and-deploy`. The preflight will pass silently and');
  console.error('   `cdk deploy --all` will succeed.');
  console.error('');
  console.error(hr);
  console.error('');
}

async function main(): Promise<void> {
  const noAutoArmFlag = process.argv.includes('--no-auto-arm');

  const { envName, envType, awsRegion, namePrefix } = resolveDeployEnv();
  console.log(
    `Preflight: checking easy-genomics DynamoDB tables for "${namePrefix}" (envType=${envType}, envName=${envName}) in ${awsRegion}...`,
  );
  if (noAutoArmFlag) {
    console.log(
      'Preflight: --no-auto-arm set. Any unprotected tables will cause a hard failure; no AWS resources will be modified.',
    );
  }

  const client = new DynamoDBClient({ region: awsRegion });
  const tableNames = EG_TABLE_SUFFIXES.map((suffix) => `${namePrefix}-${suffix}`);

  const failures: TableCheckFailure[] = [];
  let missing = 0;
  let ok = 0;

  for (const tableName of tableNames) {
    const result = await checkTable(client, tableName);
    if (result === 'missing') {
      missing++;
      console.log(`  - ${tableName}: does not exist (fresh deploy; skipping)`);
      continue;
    }
    if (result.length === 0) {
      ok++;
      console.log(`  - ${tableName}: OK (deletion protection + PITR enabled)`);
    } else {
      failures.push(...result);
      const reasons = result.map((r) => r.reason).join(', ');
      console.log(`  - ${tableName}: NEEDS ARMING (${reasons})`);
    }
  }

  console.log('');
  console.log(
    `Preflight summary: ${ok} ok, ${missing} missing (fresh), ${failures.length > 0 ? `${failures.length} issue(s) across ${new Set(failures.map((f) => f.tableName)).size} table(s)` : '0 issues'}.`,
  );

  if (failures.length === 0) {
    // Tables are safe. Before proceeding, confirm the migration isn't
    // still pending — otherwise `cdk deploy` would try to remove the old
    // easy-genomics nested stack and roll back noisily when DynamoDB
    // rejects the `DeleteTable` calls. Halting here gives operators a
    // readable error instead of having to parse a CloudFormation
    // rollback.
    const cfnClient = new CloudFormationClient({ region: awsRegion });
    const oldStackName = `${namePrefix}-main-back-end-stack`;
    console.log(
      `Preflight: checking whether the easy-genomics nested stack has been detached from "${oldStackName}"...`,
    );
    const state = await checkMigrationState(cfnClient, oldStackName);
    switch (state.kind) {
      case 'pending':
        printMigrationPendingReport(namePrefix, oldStackName, state.nestedStack);
        process.exit(1);
        break;
      case 'fresh':
        console.log(`  - "${oldStackName}" does not exist (fresh deploy).`);
        console.log('Preflight passed. Proceeding to cdk deploy.');
        return;
      case 'complete':
        console.log(`  - "${oldStackName}" no longer contains the easy-genomics nested stack.`);
        console.log('Preflight passed. Proceeding to cdk deploy.');
        return;
      case 'unknown':
        // Fail closed. `cdk deploy` needs CloudFormation too; if CFN is
        // unreachable or the principal lacks `cloudformation:ListStackResources`
        // the deploy would fail on its first CFN call anyway, just with a
        // much less readable message. Halt here with a clear error instead.
        console.error('');
        console.error('='.repeat(78));
        console.error('PREFLIGHT: CloudFormation is unreachable — deploy aborted.');
        console.error('='.repeat(78));
        console.error('');
        console.error(`Could not list resources of "${oldStackName}":`);
        console.error(`  ${state.reason}`);
        console.error('');
        console.error('The table-level arming check passed, so your data is safe. But we could');
        console.error('not verify whether the easy-genomics nested stack has been detached from');
        console.error(`"${oldStackName}", and \`cdk deploy\` would have failed on its own first`);
        console.error('CloudFormation call a moment later.');
        console.error('');
        console.error('Most common causes:');
        console.error('  - Expired AWS credentials in the shell / CI role.');
        console.error('  - The deploying principal is missing `cloudformation:ListStackResources`.');
        console.error('  - Transient AWS API issue or throttling — retry usually resolves it.');
        console.error('');
        console.error('Fix the underlying error and rerun the deploy.');
        console.error('');
        console.error('='.repeat(78));
        console.error('');
        process.exit(2);
        break;
    }
  }

  if (noAutoArmFlag) {
    printManualFailureReport(namePrefix, awsRegion, failures);
    process.exit(1);
  }

  console.log('');
  console.log('Auto-arm enabled. Performing Phase 0 (backup + deletion protection + PITR)...');
  console.log('');

  const failuresByTable = new Map<string, Set<FailureReason>>();
  for (const f of failures) {
    const existing = failuresByTable.get(f.tableName) ?? new Set<FailureReason>();
    existing.add(f.reason);
    failuresByTable.set(f.tableName, existing);
  }

  // Compact ISO-8601 timestamp without separators — safe for DynamoDB
  // backup names and unambiguous when scanning `list-backups` output later.
  const backupTs = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  const armResults = new Map<string, ArmAction[]>();
  for (const [tableName, reasons] of failuresByTable) {
    console.log(`  arming ${tableName}...`);
    const actions = await armTable(client, tableName, reasons, backupTs);
    armResults.set(tableName, actions);
  }

  // A backup failure is a soft failure (nice-to-have); any arming failure is
  // hard (the deploy would still be unsafe).
  let hardFailures = 0;
  for (const actions of armResults.values()) {
    for (const action of actions) {
      if (!action.ok && action.kind !== 'backup') {
        hardFailures++;
      }
    }
  }

  printAutoArmReport(namePrefix, armResults, hardFailures);

  // Always halt the deploy after a successful auto-arm: the migration is
  // still pending for this environment and the next `cdk deploy` would roll
  // back at the CloudFormation layer. Exit 2 signals IAM/arming problems so
  // CI can distinguish "migration pending" from "arming failed".
  process.exit(hardFailures > 0 ? 2 : 1);
}

main().catch((err: unknown) => {
  console.error('');
  console.error('Preflight errored before it could complete its checks:');
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  console.error('');
  console.error(
    'This is NOT the same as a failed safety check — the script could not tell whether ' +
      'your tables are safe. Fix the underlying error (most commonly: missing AWS credentials, ' +
      'wrong region, or a misconfigured easy-genomics.yaml) and re-run.',
  );
  process.exit(2);
});
