import { buildImportDestKey } from '../../../src/app/utils/data-collections-copy-jobs';
import {
  buildLaboratorySourcePrefix,
  buildSourcePrefix,
  buildSourceRootOptions,
  defaultS3ImportLabel,
  folderSearchScopeNote,
  isSourceFolderMissing,
} from '../../../src/app/utils/data-collections-source-prefix';

describe('buildLaboratorySourcePrefix', () => {
  const laboratory = { OrganizationId: 'org-1', LaboratoryId: 'lab-1' };

  it('places a typed folder under the laboratory folder', () => {
    expect(buildLaboratorySourcePrefix(laboratory, 'sample-3-18/')).toBe('org-1/lab-1/sample-3-18/');
  });

  it('adds the trailing slash when it is missing', () => {
    expect(buildLaboratorySourcePrefix(laboratory, 'aws-healthomics')).toBe('org-1/lab-1/aws-healthomics/');
  });

  it('strips leading slashes from the typed folder', () => {
    expect(buildLaboratorySourcePrefix(laboratory, '//imports/run-1/')).toBe('org-1/lab-1/imports/run-1/');
  });

  it('returns exactly the laboratory folder for a blank prefix', () => {
    expect(buildLaboratorySourcePrefix(laboratory, '')).toBe('org-1/lab-1/');
    expect(buildLaboratorySourcePrefix(laboratory, '/')).toBe('org-1/lab-1/');
  });
});

describe('buildSourcePrefix', () => {
  it('places a typed folder under an allowed folder', () => {
    expect(buildSourcePrefix('sample-3-18/', 'run-1')).toBe('sample-3-18/run-1/');
  });

  it('returns the allowed folder itself for a blank or slash-only prefix', () => {
    expect(buildSourcePrefix('sample-3-18/', '')).toBe('sample-3-18/');
    expect(buildSourcePrefix('sample-3-18/', '//')).toBe('sample-3-18/');
  });
});

describe('a folder that names no folder', () => {
  it.each(['   ', ' / ', '/  /'])('lists the root itself for %p', (typedPrefix) => {
    expect(buildSourcePrefix('her-folder/', typedPrefix)).toBe('her-folder/');
    expect(buildLaboratorySourcePrefix({ OrganizationId: 'org-1', LaboratoryId: 'lab-1' }, typedPrefix)).toBe(
      'org-1/lab-1/',
    );
  });
});

describe('isSourceFolderMissing', () => {
  it.each(['', '   ', '/', ' / ', '//'])('requires a folder in the lab folder, so %p is missing', (typedPrefix) => {
    expect(isSourceFolderMissing(typedPrefix, '')).toBe(true);
  });

  it('accepts a typed folder in the lab folder', () => {
    expect(isSourceFolderMissing('run-1', '')).toBe(false);
    expect(isSourceFolderMissing('/run-1/', '')).toBe(false);
  });

  it.each(['', '   ', '/', 'run-1'])('never requires a folder in an allowed folder (%p)', (typedPrefix) => {
    expect(isSourceFolderMissing(typedPrefix, 'her-folder/')).toBe(false);
  });
});

describe('defaultS3ImportLabel', () => {
  it('names the import after the typed folder', () => {
    expect(defaultS3ImportLabel('sample-3-18/run-1/', '', 'lab-bucket')).toBe('run-1');
    expect(defaultS3ImportLabel('run-1', 'her-folder/', 'lab-bucket')).toBe('run-1');
  });

  it.each(['', '   ', '/'])(
    'names a blank folder (%p) in an allowed folder after the allowed folder',
    (typedPrefix) => {
      expect(defaultS3ImportLabel(typedPrefix, 'her-folder/', 'lab-bucket')).toBe('her-folder');
    },
  );

  it('uses the last folder of a nested allowed folder', () => {
    expect(defaultS3ImportLabel('', 'partners/site-a/', 'lab-bucket')).toBe('site-a');
  });

  it('skips blank segments in the typed folder', () => {
    expect(defaultS3ImportLabel('run-1/   ', '', 'lab-bucket')).toBe('run-1');
  });

  it('falls back to the bucket, then to "import", in the lab folder', () => {
    expect(defaultS3ImportLabel('', '', 'lab-bucket')).toBe('lab-bucket');
    expect(defaultS3ImportLabel('', '', '')).toBe('import');
  });

  it('lands a file at the top of an allowed folder under imports/<folder name>/', () => {
    const listedSourcePrefix = buildSourcePrefix('her-folder/', '');
    const destPrefix = `org-1/lab-1/imports/${defaultS3ImportLabel('', 'her-folder/', 'lab-bucket')}/`;
    expect(buildImportDestKey('her-folder/S1_R1_001.fastq.gz', listedSourcePrefix, destPrefix)).toBe(
      'org-1/lab-1/imports/her-folder/S1_R1_001.fastq.gz',
    );
  });
});

describe('buildSourceRootOptions', () => {
  const labFolder = { label: "This lab's folder", value: 'laboratory' };

  it("offers only this lab's folder when the bucket has no wider grant", () => {
    expect(buildSourceRootOptions('', false)).toEqual([labFolder]);
  });

  it('offers the allowed folder by name', () => {
    expect(buildSourceRootOptions('her-folder/', false)).toEqual([
      labFolder,
      { label: 'her-folder/', value: 'allowed' },
    ]);
  });

  it('offers the whole bucket under a whole-bucket grant', () => {
    expect(buildSourceRootOptions('', true)).toEqual([labFolder, { label: 'Whole bucket', value: 'bucket' }]);
  });
});

describe('a folder typed from the bucket root', () => {
  it('lists the typed folder', () => {
    expect(buildSourcePrefix('', 'sequencer-drop/run-1')).toBe('sequencer-drop/run-1/');
    expect(buildSourcePrefix('', '/sequencer-drop/')).toBe('sequencer-drop/');
  });

  it.each(['', '   ', '/', ' / '])('still requires a folder for %p, as in the lab folder', (typedPrefix) => {
    expect(isSourceFolderMissing(typedPrefix, '')).toBe(true);
  });

  it('names the import after the typed folder and lands it under imports/<name>/', () => {
    const listedSourcePrefix = buildSourcePrefix('', 'sequencer-drop/run-1/');
    const label = defaultS3ImportLabel('sequencer-drop/run-1/', '', 'drop-bucket');
    expect(label).toBe('run-1');
    expect(
      buildImportDestKey(
        'sequencer-drop/run-1/S1_R1_001.fastq.gz',
        listedSourcePrefix,
        `org-1/lab-1/imports/${label}/`,
      ),
    ).toBe('org-1/lab-1/imports/run-1/S1_R1_001.fastq.gz');
  });
});

describe('folderSearchScopeNote', () => {
  it('says paths start at the bucket root when the whole bucket is searched', () => {
    expect(folderSearchScopeNote(true, '')).toBe('Paths start at the bucket root.');
  });

  it('names the allowed folder and allows a blank folder when an allowed folder is searched', () => {
    expect(folderSearchScopeNote(false, 'partner-drop/runs/')).toBe(
      'Paths start inside partner-drop/runs/. Leave it blank to search the whole allowed folder.',
    );
  });

  it("explains the lab folder, without offering a blank folder, when this lab's folder is searched", () => {
    expect(folderSearchScopeNote(false, '')).toBe(
      "Paths start inside this lab's folder in the bucket, so you don't need to type the lab or organization IDs.",
    );
  });
});
