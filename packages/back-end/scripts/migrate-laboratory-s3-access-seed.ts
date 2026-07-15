/**
 * One-time idempotent migration: seed ALLOW rows for each laboratory's current S3Bucket.
 *
 * Usage (from packages/back-end):
 *   NAME_PREFIX=<prefix> AWS_REGION=<region> npx tsx scripts/migrate-laboratory-s3-access-seed.ts
 */
import { ScanCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryS3AccessService } from '../src/app/services/easy-genomics/laboratory-s3-access-service';
import { DynamoDBService } from '../src/app/services/dynamodb-service';

const namePrefix = process.env.NAME_PREFIX;
if (!namePrefix) {
  console.error('NAME_PREFIX environment variable is required');
  process.exit(1);
}

class LaboratoryScanService extends DynamoDBService {
  readonly TABLE_NAME = `${namePrefix}-laboratory-table`;

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

async function main(): Promise<void> {
  const scanService = new LaboratoryScanService();
  const accessService = new LaboratoryS3AccessService();
  const laboratories = await scanService.scanAll();

  let seeded = 0;
  let skipped = 0;

  for (const lab of laboratories) {
    const bucket = lab.S3Bucket?.trim();
    if (!bucket) {
      skipped++;
      continue;
    }

    const existing = await accessService.findAssignment(lab.LaboratoryId, bucket);
    if (existing && existing.Effect !== 'DENY') {
      skipped++;
      continue;
    }

    await accessService.upsert({
      LaboratoryId: lab.LaboratoryId,
      BucketName: bucket,
      OrganizationId: lab.OrganizationId,
      Effect: 'ALLOW',
    });
    seeded++;
    console.log(`Seeded ALLOW for lab ${lab.LaboratoryId} bucket ${bucket}`);
  }

  console.log(`Done. Seeded=${seeded} skipped=${skipped} totalLabs=${laboratories.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
