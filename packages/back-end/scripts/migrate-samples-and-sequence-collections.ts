/**
 * Optional migration: rewrite DynamoDB sort-key prefixes and attribute names after the
 * sequence-set → sample and data-collection → sequence-collection rename.
 *
 * Does not delete data — rows are copied under new sort keys (old rows removed only when
 * the sort key changes). Idempotent for rows already on the new prefixes.
 *
 * Run from packages/back-end (recommended) or repo root:
 *   pnpm tsx scripts/migrate-samples-and-sequence-collections.ts [--dry-run]
 *
 * Requires:
 *   - NAME_PREFIX, REGION in .env.local or the environment (see .env.local.example)
 *   - Valid AWS credentials with dynamodb:Scan, dynamodb:PutItem, dynamodb:DeleteItem on
 *     `${NAME_PREFIX}-laboratory-data-tagging-table`
 *
 * Credentials: uses the AWS SDK default chain (in order):
 *   1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN env vars
 *   2. AWS_PROFILE → ~/.aws/credentials + ~/.aws/config (incl. SSO cache after `aws sso login`)
 *   3. EC2/ECS instance role (when run on AWS)
 *
 * Temporary console/SSO keys start with ASIA… and require AWS_SESSION_TOKEN; they expire
 * (often within hours). `aws configure` stores whatever you paste — it does not refresh
 * SSO. Use `aws sso login --profile <profile>` or paste a fresh session from the console.
 *
 * Verify credentials before migrating:
 *   aws sts get-caller-identity
 *   # or with a profile:
 *   AWS_PROFILE=<profile> aws sts get-caller-identity
 */
import path from 'path';
import dotenv from 'dotenv';
import { DeleteItemCommand, DynamoDBClient, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { migrateItem, needsMigration } from './lib/migrate-samples-and-sequence-collections-lib';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  dotenv.config({ path: envPath });
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }
  const required = ['NAME_PREFIX', 'REGION'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}. Set in packages/back-end/.env.local or environment.`);
    process.exit(1);
  }
}

function credentialSourceSummary(): string {
  const parts: string[] = [];
  if (process.env.AWS_ACCESS_KEY_ID) {
    const key = process.env.AWS_ACCESS_KEY_ID;
    const kind = key.startsWith('ASIA') ? 'temporary (ASIA…)' : key.startsWith('AKIA') ? 'long-lived (AKIA…)' : 'env';
    parts.push(`AWS_ACCESS_KEY_ID from environment (${kind})`);
    parts.push(
      process.env.AWS_SESSION_TOKEN ? 'AWS_SESSION_TOKEN set' : 'AWS_SESSION_TOKEN missing (required for ASIA keys)',
    );
  } else if (process.env.AWS_PROFILE) {
    parts.push(`AWS_PROFILE=${process.env.AWS_PROFILE}`);
  } else {
    parts.push('default profile (~/.aws/credentials or SSO cache)');
  }
  parts.push(`region=${process.env.AWS_REGION ?? '(SDK default)'}`);
  return parts.join('; ');
}

async function verifyCredentials(): Promise<void> {
  console.log(`Credential source: ${credentialSourceSummary()}`);
  const sts = new STSClient({});
  try {
    const who = await sts.send(new GetCallerIdentityCommand({}));
    console.log(`Authenticated as ${who.Arn} (account ${who.Account})`);
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : 'Error';
    console.error(`\nAWS authentication failed (${name}).`);
    if (process.env.AWS_ACCESS_KEY_ID?.startsWith('ASIA')) {
      console.error(
        'You are using temporary credentials. Ensure AWS_SESSION_TOKEN is set and not expired.\n' +
          'Environment variables override ~/.aws/credentials — unset stale AWS_* exports or refresh:\n' +
          '  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN\n' +
          '  aws sso login --profile <your-profile>\n' +
          '  export AWS_PROFILE=<your-profile>',
      );
    } else {
      console.error(
        'Refresh credentials, then confirm with:\n' +
          '  aws sts get-caller-identity\n' +
          'Run this script from packages/back-end if you rely on .env.local for REGION.',
      );
    }
    throw err;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const dryRun = process.argv.includes('--dry-run');
  const tableName = `${process.env.NAME_PREFIX}-laboratory-data-tagging-table`;

  await verifyCredentials();

  const client = new DynamoDBClient({});
  console.log(`${dryRun ? '[dry-run] ' : ''}Scanning ${tableName}…`);

  let migrated = 0;
  let scanned = 0;
  let startKey: Record<string, unknown> | undefined;

  do {
    const scan = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: startKey as never,
      }),
    );
    for (const raw of scan.Items || []) {
      scanned++;
      const item = unmarshall(raw) as Record<string, unknown>;
      if (!needsMigration(item)) continue;

      const next = migrateItem(item);
      const laboratoryId = item.LaboratoryId as string;
      const oldSk = item.Sk as string;
      const newSk = next.Sk as string;

      if (dryRun) {
        console.log(`  would migrate LaboratoryId=${laboratoryId} Sk ${oldSk} → ${newSk}`);
        migrated++;
        continue;
      }

      // DynamoDB sort keys cannot be updated in place — delete old item and put migrated copy.
      if (oldSk !== newSk) {
        await client.send(
          new DeleteItemCommand({
            TableName: tableName,
            Key: marshall({ LaboratoryId: laboratoryId, Sk: oldSk }),
          }),
        );
      }
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: marshall(next, { removeUndefinedValues: true }),
        }),
      );
      migrated++;
      if (migrated % 100 === 0) console.log(`Migrated ${migrated} rows…`);
    }
    startKey = scan.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  console.log(`Done. Scanned ${scanned} rows, ${dryRun ? 'would migrate' : 'migrated'} ${migrated}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
