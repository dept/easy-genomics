/**
 * Optional migration: create sequence sets from existing tagged/orphan files and copy file tags
 * to the parent sequence set. Idempotent — skips files already in a sequence set.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-file-tags-to-sequence-sets.ts --laboratoryId=<uuid> [--dry-run]
 */
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';
import {
  LaboratoryDataTaggingService,
  encodeS3ObjectRef,
} from '../src/app/services/easy-genomics/laboratory-data-tagging-service';
import { LaboratorySequenceSetService } from '../src/app/services/easy-genomics/laboratory-sequence-set-service';
import { DataCollectionService } from '../src/app/services/easy-genomics/data-collection-service';

const laboratoryService = new LaboratoryService();
const taggingService = new LaboratoryDataTaggingService();
const sequenceSetService = new LaboratorySequenceSetService();
const dataCollectionService = new DataCollectionService();

function parseArgs(): { laboratoryId: string; dryRun: boolean } {
  const laboratoryId = process.argv.find((a) => a.startsWith('--laboratoryId='))?.split('=')[1];
  if (!laboratoryId) throw new Error('--laboratoryId is required');
  return { laboratoryId, dryRun: process.argv.includes('--dry-run') };
}

function inferPairKey(fileName: string): string {
  return fileName
    .replace(/_R[12](?:_\d+)?\.fastq\.gz$/i, '')
    .replace(/\.R[12]\.fastq\.gz$/i, '')
    .replace(/\.fastq\.gz$/i, '');
}

async function main(): Promise<void> {
  const { laboratoryId, dryRun } = parseArgs();
  const laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
  const bucket = laboratory.S3Bucket;
  if (!bucket) throw new Error('Laboratory has no S3 bucket');

  const labPrefix = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
  const { contents } = await dataCollectionService.listTransactionInputs({
    bucket,
    labPrefix,
    pageSize: 1000,
    maxTotalKeys: 50_000,
  });

  const unlinked: typeof contents = [];
  for (const obj of contents) {
    if (!obj.Key) continue;
    const ref = encodeS3ObjectRef(bucket, obj.Key);
    const setIds = await sequenceSetService.getSequenceSetIdsForFileRefs(laboratoryId, [ref]);
    if (!setIds.get(ref)?.length) unlinked.push(obj);
  }

  const groups = new Map<string, string[]>();
  for (const obj of unlinked) {
    const key = obj.Key!;
    const base = key.split('/').pop() || key;
    const groupKey = inferPairKey(base);
    const list = groups.get(groupKey) || [];
    list.push(key);
    groups.set(groupKey, list);
  }

  console.log(`Found ${unlinked.length} unlinked files → ${groups.size} candidate sequence sets`);

  for (const [sampleId, keys] of groups) {
    const hasR2 = keys.some((k) => /R2/i.test(k.split('/').pop() || ''));
    const layout = hasR2 ? 'paired_end' : 'single_end';
    console.log(`${dryRun ? '[dry-run] ' : ''}Create set "${sampleId}" (${keys.length} files, ${layout})`);

    if (dryRun) continue;

    const set = await sequenceSetService.createSequenceSet(laboratory, 'migration-script', bucket, {
      name: sampleId,
      layout,
      keys,
    });

    const tagIds = new Set<string>();
    for (const key of keys) {
      const ref = encodeS3ObjectRef(bucket, key);
      const assignments = await taggingService.listFileTags(laboratoryId, bucket, [key]);
      for (const tid of assignments[0]?.TagIds || []) {
        tagIds.add(tid);
      }
      void ref;
    }
    if (tagIds.size) {
      await taggingService.applyTagsToSequenceSets(
        laboratory,
        'migration-script',
        [set.SequenceSetId],
        [...tagIds],
        [],
      );
    }
  }

  console.log('Migration complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
