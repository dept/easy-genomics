import { CreateSampleSchema } from './create-sample';
import { CreateSequenceCollectionSchema } from './create-sequence-collection';

describe('CreateSampleSchema', () => {
  it('requires Name and Keys when creating a new sample', () => {
    const parsed = CreateSampleSchema.safeParse({
      LaboratoryId: 'lab-1',
      S3Bucket: 'bucket-1',
      Layout: 'paired_end',
    });
    expect(parsed.success).toBe(false);
  });

  it('allows ExistingSampleId without Name or Keys', () => {
    const parsed = CreateSampleSchema.safeParse({
      LaboratoryId: 'lab-1',
      S3Bucket: 'bucket-1',
      Layout: 'paired_end',
      ExistingSampleId: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('CreateSequenceCollectionSchema', () => {
  const columns = [{ columnName: 'sample', role: 'sample_id' as const, required: true }];

  it('requires Name and SampleIds when creating a new collection', () => {
    const parsed = CreateSequenceCollectionSchema.safeParse({
      LaboratoryId: 'lab-1',
      Columns: columns,
    });
    expect(parsed.success).toBe(false);
  });

  it('allows ExistingSequenceCollectionId without Name', () => {
    const parsed = CreateSequenceCollectionSchema.safeParse({
      LaboratoryId: 'lab-1',
      Columns: columns,
      ExistingSequenceCollectionId: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    });
    expect(parsed.success).toBe(true);
  });
});
