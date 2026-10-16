import { isProtectedLabDataDestination, parseKeyOutputDeliveryUri } from './workflow-key-output-delivery';
import { EditWorkflowKeyOutputDeliverySchema } from '../schema/easy-genomics/workflow-key-outputs';

describe('parseKeyOutputDeliveryUri', () => {
  it('accepts a bucket and prefix', () => {
    expect(parseKeyOutputDeliveryUri('s3://results-bucket/incoming/viralrecon')).toEqual({
      bucket: 'results-bucket',
      prefix: 'incoming/viralrecon/',
    });
  });

  it('accepts a bucket with no prefix', () => {
    expect(parseKeyOutputDeliveryUri('s3://results-bucket')).toEqual({
      bucket: 'results-bucket',
      prefix: '',
    });
  });

  it('rejects a missing bucket and a non-s3 URI, and drops a parent segment', () => {
    expect(parseKeyOutputDeliveryUri('s3:///incoming')).toBeNull();
    expect(parseKeyOutputDeliveryUri('s3://results-bucket/../secret')).toEqual({
      bucket: 'results-bucket',
      prefix: 'secret/',
    });
    expect(parseKeyOutputDeliveryUri('https://results-bucket/incoming')).toBeNull();
    expect(parseKeyOutputDeliveryUri('')).toBeNull();
  });
});

describe('isProtectedLabDataDestination', () => {
  it('rejects an Easy Genomics organization/laboratory prefix', () => {
    expect(
      isProtectedLabDataDestination('b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f/c2f1e7b5-2e3c-5b7e-0a2d-2b3c4d5e6f70/'),
    ).toBe(true);
  });

  it('allows an external incoming prefix', () => {
    expect(isProtectedLabDataDestination('incoming/viralrecon/')).toBe(false);
  });
});

describe('EditWorkflowKeyOutputDeliverySchema', () => {
  const base = {
    LaboratoryId: 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f',
    WorkflowId: 'wf-1',
    Enabled: true,
  };

  it('rejects a non-s3 URI and an empty-bucket URI', () => {
    expect(EditWorkflowKeyOutputDeliverySchema.safeParse({ ...base, DestinationUri: 'https://bucket/prefix' }).success).toBe(
      false,
    );
    expect(EditWorkflowKeyOutputDeliverySchema.safeParse({ ...base, DestinationUri: 's3:///incoming' }).success).toBe(
      false,
    );
  });

  it('rejects a laboratory data prefix', () => {
    expect(
      EditWorkflowKeyOutputDeliverySchema.safeParse({
        ...base,
        DestinationUri: 's3://lab-bucket/b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f/c2f1e7b5-2e3c-5b7e-0a2d-2b3c4d5e6f70/out',
      }).success,
    ).toBe(false);
  });
});
