import type { S3BucketCatalogEntry } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-s3-access';
import { LaboratoryS3AccessService } from '@BE/services/easy-genomics/laboratory-s3-access-service';
import { listDataTaggedS3Buckets } from '@BE/services/easy-genomics/s3-bucket-catalog-service';
import { rowIsAllow, rowIsDeny } from '@BE/utils/laboratory-s3-access-utils';

const CHUNK = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run after Laboratory.EnableNewBucketsByDefault changes between strict and default-on.
 */
export async function migrateS3AccessOnDefaultModeChange(params: {
  organizationId: string;
  laboratoryId: string;
  previousDefaultOn: boolean;
  nextDefaultOn: boolean;
}): Promise<void> {
  const { organizationId, laboratoryId, previousDefaultOn, nextDefaultOn } = params;
  if (previousDefaultOn === nextDefaultOn) {
    return;
  }

  const accessService = new LaboratoryS3AccessService();
  const catalog = await listDataTaggedS3Buckets();
  const catalogNameSet = new Set(catalog.map((c) => c.name));

  const rows = await accessService.listByLaboratoryId(laboratoryId);

  if (!previousDefaultOn && nextDefaultOn) {
    const allowNames = new Set<string>();
    for (const row of rows) {
      if (!rowIsAllow(row)) {
        continue;
      }
      allowNames.add(row.BucketName);
    }

    const denyUpserts: S3BucketCatalogEntry[] = [];
    for (const entry of catalog) {
      if (!allowNames.has(entry.name)) {
        denyUpserts.push(entry);
      }
    }

    for (let i = 0; i < denyUpserts.length; i += CHUNK) {
      const slice = denyUpserts.slice(i, i + CHUNK);
      await Promise.all(
        slice.map((entry) =>
          accessService.upsert({
            LaboratoryId: laboratoryId,
            BucketName: entry.name,
            OrganizationId: organizationId,
            Effect: 'DENY',
          }),
        ),
      );
      if (i + CHUNK < denyUpserts.length) {
        await sleep(0);
      }
    }

    for (const row of rows) {
      if (!rowIsAllow(row)) {
        continue;
      }
      if (catalogNameSet.has(row.BucketName)) {
        await accessService.remove(laboratoryId, row.BucketName);
      }
    }
    return;
  }

  if (previousDefaultOn && !nextDefaultOn) {
    const denyNames = new Set<string>();
    for (const row of rows) {
      if (!rowIsDeny(row)) {
        continue;
      }
      denyNames.add(row.BucketName);
    }

    const allowUpserts: S3BucketCatalogEntry[] = [];
    for (const entry of catalog) {
      if (!denyNames.has(entry.name)) {
        allowUpserts.push(entry);
      }
    }

    for (let i = 0; i < allowUpserts.length; i += CHUNK) {
      const slice = allowUpserts.slice(i, i + CHUNK);
      await Promise.all(
        slice.map((entry) =>
          accessService.upsert({
            LaboratoryId: laboratoryId,
            BucketName: entry.name,
            OrganizationId: organizationId,
            Effect: 'ALLOW',
          }),
        ),
      );
      if (i + CHUNK < allowUpserts.length) {
        await sleep(0);
      }
    }

    for (const row of rows) {
      if (!rowIsDeny(row)) {
        continue;
      }
      await accessService.remove(laboratoryId, row.BucketName);
    }
  }
}
