import { folderStatsFromListContents } from '../../../src/app/utils/s3-folder-stats';

describe('folderStatsFromListContents', () => {
  it('counts nested files and sums sizes under a prefix listing', () => {
    expect(
      folderStatsFromListContents([
        { Key: 'run/pubdir/file.txt', Size: 10 },
        { Key: 'run/pubdir/nested/deep.bin', Size: 40 },
        { Key: 'run/pubdir/', Size: 0 },
      ]),
    ).toEqual({ fileCount: 2, totalSize: 50 });
  });

  it('returns zeros for an empty listing', () => {
    expect(folderStatsFromListContents(undefined)).toEqual({ fileCount: 0, totalSize: 0 });
    expect(folderStatsFromListContents([])).toEqual({ fileCount: 0, totalSize: 0 });
  });
});
