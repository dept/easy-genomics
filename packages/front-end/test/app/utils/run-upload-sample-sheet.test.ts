import { mergeInputFileKeys, removeInputFileKeys } from '../../../src/app/utils/run-input-file-keys';

describe('run-upload-sample-sheet', () => {
  describe('mergeInputFileKeys', () => {
    it('merges without duplicates', () => {
      expect(mergeInputFileKeys(['a/1.fastq.gz'], ['a/2.fastq.gz', 'a/1.fastq.gz'])).toEqual([
        'a/1.fastq.gz',
        'a/2.fastq.gz',
      ]);
    });

    it('returns empty when both inputs empty', () => {
      expect(mergeInputFileKeys([], [])).toEqual([]);
    });
  });

  describe('removeInputFileKeys', () => {
    it('removes specified keys', () => {
      expect(removeInputFileKeys(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    });
  });
});
