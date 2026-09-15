import { AssignSampleBatchSchema } from './assign-sample-batch';

describe('AssignSampleBatchSchema', () => {
  const sampleId = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';

  it('accepts ClearBatch', () => {
    const parsed = AssignSampleBatchSchema.safeParse({
      LaboratoryId: 'lab-1',
      SampleIds: [sampleId],
      ClearBatch: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts BatchTagId', () => {
    const parsed = AssignSampleBatchSchema.safeParse({
      LaboratoryId: 'lab-1',
      SampleIds: [sampleId],
      BatchTagId: 'bbbbbbbb-cccc-4ddd-eeee-ffffffffffff',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects when no batch mode is specified', () => {
    const parsed = AssignSampleBatchSchema.safeParse({
      LaboratoryId: 'lab-1',
      SampleIds: [sampleId],
    });
    expect(parsed.success).toBe(false);
  });
});
