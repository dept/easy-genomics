/**
 * One-off migration: remove legacy `OrganizationAccess` from the user-table.
 * Org/lab membership is the source of truth in organization-user-table and
 * laboratory-user-table; the pre-token hook builds JWT claims from those tables.
 *
 * See README: scripts/README-remove-user-organization-access.md
 *
 * Run from `packages/back-end`:
 *   pnpm run migrate:remove-user-organization-access [-- --dry-run] [-- --verify-only] [-- --force]
 *
 * Behaviour:
 *   By default, every user with a stored `OrganizationAccess` is verified against
 *   organization-user-table and laboratory-user-table (rebuilt with the same
 *   helper used by the Cognito pre-token Lambda). A user is updated only if its
 *   rebuilt access matches what is stored. Mismatches are listed and skipped.
 *
 * Options:
 *   --dry-run      Verify and log decisions; no writes.
 *   --verify-only  Verify only; never write, even outside dry-run.
 *   --force        Skip verification and remove `OrganizationAccess` from every
 *                  matching user. Use with care.
 *   --verbose      Print full per-user diffs for mismatches.
 *
 * Requires `.env.local` (or environment) with: NAME_PREFIX, REGION.
 * Uses default AWS credentials. Your identity needs:
 *   - dynamodb:Scan and dynamodb:UpdateItem on the user-table
 *   - dynamodb:Query on organization-user-table (UserId_Index GSI)
 *   - dynamodb:Query on laboratory-user-table (UserId_Index GSI)
 */

import path from 'path';
import { isDeepStrictEqual } from 'util';
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import dotenv from 'dotenv';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import {
  LaboratoryAccess,
  LaboratoryAccessDetails,
  OrganizationAccess,
  OrganizationAccessDetails,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { buildOrganizationAccessFromMemberships } from '../src/app/utils/organization-access-builder';

interface Options {
  dryRun: boolean;
  verifyOnly: boolean;
  force: boolean;
  verbose: boolean;
}

function parseArgs(): Options {
  return {
    dryRun: process.argv.includes('--dry-run'),
    verifyOnly: process.argv.includes('--verify-only'),
    force: process.argv.includes('--force'),
    verbose: process.argv.includes('--verbose'),
  };
}

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  dotenv.config({ path: envPath });
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }
  const required = ['NAME_PREFIX', 'REGION'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing required env: ${missing.join(', ')}. Set in .env.local or environment.`);
    process.exit(1);
  }
}

/**
 * Normalises an OrganizationAccess for comparison so that:
 *  - Missing `LaboratoryAccess` is treated as an empty map.
 *  - Missing `OrganizationAdmin` / `LabManager` / `LabTechnician` are treated as `false`.
 *  - Object key order does not matter (handled by deep equal on plain objects).
 */
function normalizeOrganizationAccess(input: OrganizationAccess | undefined | null): OrganizationAccess {
  const result: OrganizationAccess = {};
  if (!input) return result;

  for (const [orgId, rawOrgDetails] of Object.entries(input)) {
    const orgDetails: OrganizationAccessDetails = rawOrgDetails ?? ({} as OrganizationAccessDetails);
    const labAccess: LaboratoryAccess = {};
    const inputLabAccess = orgDetails.LaboratoryAccess ?? {};
    for (const [labId, rawLab] of Object.entries(inputLabAccess)) {
      const lab: LaboratoryAccessDetails = rawLab ?? ({} as LaboratoryAccessDetails);
      labAccess[labId] = {
        Status: lab.Status,
        LabManager: lab.LabManager ?? false,
        LabTechnician: lab.LabTechnician ?? false,
      };
    }
    result[orgId] = {
      Status: orgDetails.Status,
      OrganizationAdmin: orgDetails.OrganizationAdmin ?? false,
      LaboratoryAccess: labAccess,
    };
  }
  return result;
}

async function queryAllByUserId(
  client: DynamoDBClient,
  tableName: string,
  userId: string,
): Promise<Record<string, AttributeValue>[]> {
  const all: Record<string, AttributeValue>[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const response = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'UserId_Index',
        KeyConditionExpression: '#UserId = :userId',
        ExpressionAttributeNames: { '#UserId': 'UserId' },
        ExpressionAttributeValues: { ':userId': { S: userId } },
        ExclusiveStartKey: lastKey,
      }),
    );
    if (response.Items) all.push(...response.Items);
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return all;
}

async function rebuildOrganizationAccess(
  client: DynamoDBClient,
  organizationUserTable: string,
  laboratoryUserTable: string,
  userId: string,
): Promise<OrganizationAccess> {
  const [orgUserItems, labUserItems] = await Promise.all([
    queryAllByUserId(client, organizationUserTable, userId),
    queryAllByUserId(client, laboratoryUserTable, userId),
  ]);
  const organizationUsers = orgUserItems.map((i) => unmarshall(i) as OrganizationUser);
  const laboratoryUsers = labUserItems.map((i) => unmarshall(i) as LaboratoryUser);
  return buildOrganizationAccessFromMemberships(organizationUsers, laboratoryUsers);
}

interface UserRow {
  UserId: string;
  OrganizationAccess?: OrganizationAccess;
}

async function* scanUsersWithOrganizationAccess(client: DynamoDBClient, tableName: string): AsyncGenerator<UserRow> {
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastKey,
        FilterExpression: 'attribute_exists(OrganizationAccess)',
        ProjectionExpression: 'UserId, OrganizationAccess',
      }),
    );
    for (const item of response.Items ?? []) {
      yield unmarshall(item) as UserRow;
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  loadEnv();

  const userTable = `${process.env.NAME_PREFIX}-user-table`;
  const orgUserTable = `${process.env.NAME_PREFIX}-organization-user-table`;
  const labUserTable = `${process.env.NAME_PREFIX}-laboratory-user-table`;
  const client = new DynamoDBClient({});

  const willWrite = !opts.dryRun && !opts.verifyOnly;

  console.log(`User table:           ${userTable}`);
  console.log(`Organization-user:    ${orgUserTable}`);
  console.log(`Laboratory-user:      ${labUserTable}`);
  console.log(
    `Mode: ${
      opts.verifyOnly
        ? 'VERIFY-ONLY'
        : opts.dryRun
          ? 'DRY RUN'
          : opts.force
            ? 'APPLY (force, no verification)'
            : 'APPLY with per-user verification'
    }`,
  );
  console.log('');

  let scanned = 0;
  let matched = 0;
  let mismatched = 0;
  let updated = 0;
  const mismatches: { userId: string; stored: OrganizationAccess; rebuilt: OrganizationAccess }[] = [];

  for await (const userRow of scanUsersWithOrganizationAccess(client, userTable)) {
    scanned++;
    const userId = userRow.UserId;
    if (!userId) continue;

    let isMatch = true;
    let rebuilt: OrganizationAccess = {};

    if (!opts.force) {
      rebuilt = await rebuildOrganizationAccess(client, orgUserTable, labUserTable, userId);
      const a = normalizeOrganizationAccess(userRow.OrganizationAccess);
      const b = normalizeOrganizationAccess(rebuilt);
      isMatch = isDeepStrictEqual(a, b);
    }

    if (!opts.force && !isMatch) {
      mismatched++;
      mismatches.push({
        userId,
        stored: userRow.OrganizationAccess ?? {},
        rebuilt,
      });
      console.log(`MISMATCH UserId=${userId}: skipping (rebuilt access differs from stored).`);
      if (opts.verbose) {
        console.log('  stored : ' + JSON.stringify(normalizeOrganizationAccess(userRow.OrganizationAccess)));
        console.log('  rebuilt: ' + JSON.stringify(normalizeOrganizationAccess(rebuilt)));
      }
      continue;
    }

    matched++;

    if (!willWrite) {
      console.log(
        opts.force
          ? `Would REMOVE OrganizationAccess for UserId=${userId} (force, unverified)`
          : `OK UserId=${userId}: would REMOVE OrganizationAccess (matches membership tables)`,
      );
      continue;
    }

    await client.send(
      new UpdateItemCommand({
        TableName: userTable,
        Key: { UserId: { S: userId } },
        UpdateExpression: 'REMOVE OrganizationAccess',
      }),
    );
    updated++;
    console.log(`REMOVED OrganizationAccess for UserId=${userId}`);
  }

  console.log('');
  console.log(`Scanned     : ${scanned}`);
  console.log(`Matched     : ${matched}`);
  console.log(`Mismatched  : ${mismatched}`);
  console.log(`Updated     : ${updated}`);

  if (mismatched > 0) {
    console.log('');
    console.log(
      'Some users had a stored OrganizationAccess that differs from organization-user-table / laboratory-user-table.',
    );
    console.log(
      'They were SKIPPED. Review the mismatches above (re-run with --verbose for diffs), reconcile the membership',
    );
    console.log('tables, then re-run the migration. Use --force to remove regardless (the membership tables are the');
    console.log('authoritative source after the code change).');
    if (willWrite) {
      process.exitCode = 2;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
