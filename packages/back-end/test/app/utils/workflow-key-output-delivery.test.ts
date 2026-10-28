import {
  deliveryDestinationOverlapsSource,
  filesMatchingKeyOutputs,
  keyOutputDeliveryObjectKey,
} from '../../../src/app/utils/workflow-key-output-delivery';

describe('filesMatchingKeyOutputs', () => {
  const root = 'org/lab/results/1234567/';

  it('keeps files whose relative path matches a pattern', () => {
    const matches = filesMatchingKeyOutputs(
      [
        { Key: `${root}reports/summary.html`, Size: 8 },
        { Key: `${root}work/tmp.txt`, Size: 1 },
        { Key: `${root}reports/`, Size: 0 },
      ],
      root,
      ['reports/summary.html'],
    );

    expect(matches).toEqual([{ key: `${root}reports/summary.html`, relativePath: 'reports/summary.html', size: 8 }]);
  });
});

describe('keyOutputDeliveryObjectKey', () => {
  it('joins the destination prefix and the run-relative path', () => {
    expect(keyOutputDeliveryObjectKey('reports/summary.html', 'incoming/')).toEqual('incoming/reports/summary.html');
  });
});

describe('deliveryDestinationOverlapsSource', () => {
  it('rejects a destination inside the run output prefix on the same bucket', () => {
    expect(
      deliveryDestinationOverlapsSource({
        sourceBucket: 'lab-bucket',
        sourcePrefix: 'org/lab/results/1234567/',
        destinationBucket: 'lab-bucket',
        destinationPrefix: 'org/lab/results/1234567/out/',
      }),
    ).toBe(true);
  });

  it('treats the root of the run bucket as an overlap', () => {
    expect(
      deliveryDestinationOverlapsSource({
        sourceBucket: 'lab-bucket',
        sourcePrefix: 'org/lab/results/1234567/',
        destinationBucket: 'lab-bucket',
        destinationPrefix: '',
      }),
    ).toBe(true);
  });

  it('allows a different bucket', () => {
    expect(
      deliveryDestinationOverlapsSource({
        sourceBucket: 'lab-bucket',
        sourcePrefix: 'org/lab/results/1234567/',
        destinationBucket: 'results-bucket',
        destinationPrefix: 'incoming/',
      }),
    ).toBe(false);
  });
});
