import { createLabFooterMessage } from '../../../src/app/utils/create-lab-footer';

describe('createLabFooterMessage', () => {
  it('asks for both when the name and bucket are missing', () => {
    expect(createLabFooterMessage({ hasName: false, hasBucket: false, otherErrorCount: 0 })).toBe(
      'Add a lab name and a bucket to continue.',
    );
  });

  it('asks for the name alone when only the name is missing', () => {
    expect(createLabFooterMessage({ hasName: false, hasBucket: true, otherErrorCount: 0 })).toBe(
      'Add a lab name to continue.',
    );
  });

  it('asks for the bucket alone when only the bucket is missing', () => {
    expect(createLabFooterMessage({ hasName: true, hasBucket: false, otherErrorCount: 3 })).toBe(
      'Add a bucket to continue.',
    );
  });

  it('points at the highlighted fields when only other fields have errors', () => {
    expect(createLabFooterMessage({ hasName: true, hasBucket: true, otherErrorCount: 1 })).toBe(
      'Fix the highlighted fields to continue.',
    );
  });

  it('returns null when nothing is wrong', () => {
    expect(createLabFooterMessage({ hasName: true, hasBucket: true, otherErrorCount: 0 })).toBeNull();
  });
});
