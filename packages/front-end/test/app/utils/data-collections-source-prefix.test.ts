import { buildLaboratorySourcePrefix, buildSourcePrefix } from '../../../src/app/utils/data-collections-source-prefix';

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
