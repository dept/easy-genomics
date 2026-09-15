/**
 * One-time idempotent migration: seed ALLOW rows for each laboratory's current S3Bucket.
 *
 * Wired into `pnpm run deploy` (runs after CDK so the access table exists). Safe to re-run.
 * Runtime fallback in `isS3BucketAccessAllowed` also covers unmigrated labs that still have
 * a configured S3Bucket and zero access rows.
 *
 * Usage (from packages/back-end):
 *   pnpm run migrate-laboratory-s3-access-seed
 *   NAME_PREFIX=<prefix> AWS_REGION=<region> npx tsx scripts/migrate-laboratory-s3-access-seed.ts
 */
import { ScanCommandOutput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryS3AccessService } from '../src/app/services/easy-genomics/laboratory-s3-access-service';
import { DynamoDBService } from '../src/app/services/dynamodb-service';
import { shouldSeedAllowForLaboratory } from './lib/migrate-laboratory-s3-access-seed-lib';
import { resolveNamePrefix } from './lib/resolve-name-prefix';

class LaboratoryScanService extends DynamoDBService {
  readonly TABLE_NAME = `${process.env.NAME_PREFIX}-laboratory-table`;

  async scanAll(): Promise<Laboratory[]> {
    const labs: Laboratory[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response: ScanCommandOutput = await this.findAll({
        TableName: this.TABLE_NAME,
        ...(startKey ? { ExclusiveStartKey: startKey as never } : {}),
      });
      for (const item of response.Items || []) {
        labs.push(unmarshall(item) as Laboratory);
      }
      startKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);
    return labs;
  }
}

export async function main(): Promise<void> {
  // Resolved here, not at module top level: registry.ts imports this module's `main` statically,
  // which would otherwise run before run-deploy-migrations.ts's entrypoint has loaded .env.local.
  const namePrefix = resolveNamePrefix();
  process.env.NAME_PREFIX = namePrefix;
  console.log(`Seeding laboratory S3 access for NAME_PREFIX=${namePrefix}`);

  const scanService = new LaboratoryScanService();
  const accessService = new LaboratoryS3AccessService();

  let laboratories: Laboratory[];
  try {
    laboratories = await scanService.scanAll();
  } catch (err: any) {
    // Fresh/greenfield deploy: laboratory table may not exist yet.
    if (err?.name === 'ResourceNotFoundException' || err?.__type?.includes('ResourceNotFoundException')) {
      console.log('Laboratory table not found; nothing to seed.');
      return;
    }
    throw err;
  }

  let seeded = 0;
  let skipped = 0;

  for (const lab of laboratories) {
    const bucket = lab.S3Bucket?.trim();
    const existing = bucket ? await accessService.findAssignment(lab.LaboratoryId, bucket) : undefined;

    if (!shouldSeedAllowForLaboratory({ configuredBucket: lab.S3Bucket, existing })) {
      skipped++;
      continue;
    }

    await accessService.upsert({
      LaboratoryId: lab.LaboratoryId,
      BucketName: bucket!,
      OrganizationId: lab.OrganizationId,
      Effect: 'ALLOW',
    });
    seeded++;
    console.log(`Seeded ALLOW for lab ${lab.LaboratoryId} bucket ${bucket}`);
  }

  console.log(`Done. Seeded=${seeded} skipped=${skipped} totalLabs=${laboratories.length}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
