import { zipRootFolderName } from '../../../../../src/app/controllers/easy-genomics/file/process-folder-download-job.lambda';

describe('zipRootFolderName', () => {
  it('falls back when a label cleans to a parent-directory segment', () => {
    expect(zipRootFolderName('org/lab/out/', '..')).toEqual('key-outputs');
    expect(zipRootFolderName('org/lab/out/', '../out')).toEqual('key-outputs');
    expect(zipRootFolderName('org/lab/out/', '.')).toEqual('key-outputs');
  });

  it('keeps a normal label', () => {
    expect(zipRootFolderName('org/lab/out/', 'FastQC reports')).toEqual('FastQC_reports');
  });
});
