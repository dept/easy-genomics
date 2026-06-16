import { BulkCreateSamplesSchema } from './bulk-create-samples';

const basePayload = {
  LaboratoryId: 'lab-1',
  S3Bucket: 'bucket-1',
  ImportLabel: 'import-1',
  Samples: [
    {
      Name: 'sample-a',
      Layout: 'paired_end' as const,
      Keys: ['org/lab/file_R1.fq.gz', 'org/lab/file_R2.fq.gz'],
    },
  ],
};

describe('BulkCreateSamplesSchema batch fields', () => {
  it('accepts NewBatchName when BatchTagId is omitted', () => {
    const parsed = BulkCreateSamplesSchema.safeParse({
      ...basePayload,
      NewBatchName: 'January run',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts BatchTagId when NewBatchName is omitted', () => {
    const parsed = BulkCreateSamplesSchema.safeParse({
      ...basePayload,
      BatchTagId: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when both NewBatchName and BatchTagId are set', () => {
    const parsed = BulkCreateSamplesSchema.safeParse({
      ...basePayload,
      NewBatchName: 'January run',
      BatchTagId: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts when neither NewBatchName nor BatchTagId is set', () => {
    const parsed = BulkCreateSamplesSchema.safeParse(basePayload);
    expect(parsed.success).toBe(true);
  });
});
