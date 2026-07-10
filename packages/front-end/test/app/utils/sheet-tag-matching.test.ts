import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { matchSheetToSamples, parseTagCell } from '../../../src/app/utils/sheet-tag-matching';

function tag(name: string, kind?: LaboratoryDataTag['Kind']): LaboratoryDataTag {
  return { TagId: `id-${name}`, Name: name, ColorHex: '#5B4FD4', FileCount: 0, ...(kind ? { Kind: kind } : {}) };
}

const rows = [
  ['sample_id', 'organism'],
  ['EG-0417', 'E. coli'],
  ['EG-0418', 'Salmonella'],
  ['EG-0419', 'E. coli'],
];

describe('parseTagCell', () => {
  it('splits, trims and de-duplicates case-insensitively', () => {
    expect(parseTagCell('E. coli, e. coli ,Salmonella,')).toEqual(['E. coli', 'Salmonella']);
  });
  it('returns an empty array for a blank cell', () => {
    expect(parseTagCell('   ')).toEqual([]);
  });
});

describe('matchSheetToSamples', () => {
  it('applies existing tags and counts sample hits', () => {
    const result = matchSheetToSamples({
      rows,
      nameColumnIndex: 0,
      tagColumnIndex: 1,
      sampleNames: ['EG-0417', 'EG-0418', 'EG-0419'],
      existingTags: [tag('E. coli'), tag('Salmonella')],
    });
    expect(result.perSample).toEqual({
      'EG-0417': ['E. coli'],
      'EG-0418': ['Salmonella'],
      'EG-0419': ['E. coli'],
    });
    expect(result.existingTagHits).toEqual([
      { name: 'E. coli', sampleCount: 2 },
      { name: 'Salmonella', sampleCount: 1 },
    ]);
    expect(result.tagsToCreate).toEqual([]);
    expect(result.unmatchedRows).toEqual([]);
    expect(result.unmatchedSampleNames).toEqual([]);
  });

  it('flags tags that must be created with their sample counts', () => {
    const result = matchSheetToSamples({
      rows,
      nameColumnIndex: 0,
      tagColumnIndex: 1,
      sampleNames: ['EG-0417', 'EG-0418', 'EG-0419'],
      existingTags: [],
    });
    expect(result.tagsToCreate).toEqual([
      { name: 'E. coli', sampleCount: 2 },
      { name: 'Salmonella', sampleCount: 1 },
    ]);
  });

  it('matches sample names case-insensitively and trims whitespace', () => {
    const result = matchSheetToSamples({
      rows: [
        ['sample_id', 'organism'],
        [' eg-0417 ', 'E. coli'],
      ],
      nameColumnIndex: 0,
      tagColumnIndex: 1,
      sampleNames: ['EG-0417'],
      existingTags: [tag('E. coli')],
    });
    expect(result.perSample).toEqual({ 'EG-0417': ['E. coli'] });
    expect(result.unmatchedRows).toEqual([]);
  });

  it('reports rows matching no sample and samples missing from the sheet', () => {
    const result = matchSheetToSamples({
      rows: [
        ['sample_id', 'organism'],
        ['EG-9999', 'E. coli'],
      ],
      nameColumnIndex: 0,
      tagColumnIndex: 1,
      sampleNames: ['EG-0417'],
      existingTags: [tag('E. coli')],
    });
    expect(result.unmatchedRows).toEqual([{ rowNumber: 2, name: 'EG-9999' }]);
    expect(result.unmatchedSampleNames).toEqual(['EG-0417']);
    expect(result.perSample).toEqual({});
  });

  it('rejects workflow, batch and permanent tags instead of applying them', () => {
    const result = matchSheetToSamples({
      rows: [
        ['sample_id', 'organism'],
        ['EG-0417', 'Nextflow'],
        ['EG-0418', 'Run-12'],
        ['EG-0419', 'Permanent'],
      ],
      nameColumnIndex: 0,
      tagColumnIndex: 1,
      sampleNames: ['EG-0417', 'EG-0418', 'EG-0419'],
      existingTags: [tag('Nextflow', 'workflow'), tag('Run-12', 'batch'), tag('Permanent', 'permanent')],
    });
    expect(result.rejected).toEqual([
      { name: 'Nextflow', reason: 'Workflow tags are auto-managed and cannot be applied' },
      { name: 'Run-12', reason: 'Batch tags are not supported on samples' },
      { name: 'Permanent', reason: 'Permanent tags are system-managed and cannot be applied' },
    ]);
    expect(result.perSample).toEqual({});
    expect(result.tagsToCreate).toEqual([]);
  });

  it('warns when a new tag is one edit from an existing tag', () => {
    const result = matchSheetToSamples({
      rows: [
        ['sample_id', 'organism'],
        ['EG-0417', 'E.coli'],
      ],
      nameColumnIndex: 0,
      tagColumnIndex: 1,
      sampleNames: ['EG-0417'],
      existingTags: [tag('E. coli')],
    });
    expect(result.tagsToCreate).toEqual([{ name: 'E.coli', sampleCount: 1 }]);
    expect(result.typoWarnings).toEqual([{ name: 'E.coli', nearest: 'E. coli', distance: 1 }]);
  });
});
