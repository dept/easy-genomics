import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { buildMicroreactProject, metadataToCsv } from '../../../src/app/utils/microreact-project';

function decodeBlob(blob: string): string {
  return Buffer.from(blob.replace('data:application/octet-stream;base64,', ''), 'base64').toString('utf-8');
}

describe('metadataToCsv', () => {
  it('converts a TSV to CSV and quotes fields that need it', () => {
    const result = metadataToCsv('samples.tsv', 'id\tcountry\tnote\nS1\tUS\thas, comma\nS2\tUK\tsays "hi"\n');

    expect(result.headers).toEqual(['id', 'country', 'note']);
    expect(result.csv).toBe('id,country,note\nS1,US,"has, comma"\nS2,UK,"says ""hi"""\n');
  });

  it('keeps a CSV as-is and reads quoted headers', () => {
    const result = metadataToCsv('samples.csv', '"sample id",lineage\r\nS1,B.1\r\n');

    expect(result.headers).toEqual(['sample id', 'lineage']);
    expect(result.csv).toBe('"sample id",lineage\r\nS1,B.1\r\n');
  });

  it('rejects a metadata file without data rows', () => {
    expect(() => metadataToCsv('samples.csv', 'id,lineage\n')).toThrow(InvalidRequestError);
  });
});

describe('buildMicroreactProject', () => {
  it('links the metadata table, dataset and trees to the embedded files', () => {
    const project = buildMicroreactProject({
      name: 'viralrecon / run-42',
      metadata: { fileName: 'summary.tsv', content: 'sample\tlineage\nS1\tB.1\n' },
      trees: [{ fileName: 'phylogeny.nwk', content: '(S1:0.1,S2:0.2);\n' }],
    });

    expect(project.schema).toBe('https://microreact.org/schema/v1.json');
    expect(project.meta).toEqual({ name: 'viralrecon / run-42' });
    expect(project.datasets['dataset-1']).toEqual({ id: 'dataset-1', file: 'metadata-file', idFieldName: 'sample' });
    expect(project.tables['table-1']).toEqual({
      title: 'Metadata',
      file: 'metadata-file',
      columns: [{ field: 'sample' }, { field: 'lineage' }],
    });
    expect(decodeBlob(project.files['metadata-file'].blob)).toBe('sample,lineage\nS1,B.1\n');
    expect(project.files['metadata-file']).toMatchObject({ format: 'text/csv', type: 'data', name: 'summary.csv' });
    expect(project.trees['tree-1']).toMatchObject({ type: 'rc', file: 'tree-file-1', labelField: 'sample' });
    expect(project.files['tree-file-1']).toMatchObject({ format: 'text/x-nh', type: 'tree', name: 'phylogeny.nwk' });
    expect(decodeBlob(project.files['tree-file-1'].blob)).toBe('(S1:0.1,S2:0.2);\n');
    expect(project.maps).toEqual({});
  });

  it('adds a map when the metadata has latitude and longitude columns', () => {
    const project = buildMicroreactProject({
      name: 'run',
      metadata: { fileName: 'm.csv', content: 'id,Latitude,Longitude\nS1,1.5,2.5\n' },
      trees: [],
    });

    expect(project.maps['map-1']).toMatchObject({ latitudeField: 'Latitude', longitudeField: 'Longitude' });
  });

  it('rejects an empty tree file', () => {
    expect(() =>
      buildMicroreactProject({
        name: 'run',
        metadata: { fileName: 'm.csv', content: 'id\nS1\n' },
        trees: [{ fileName: 'empty.nwk', content: '  \n' }],
      }),
    ).toThrow('Tree file empty.nwk is empty');
  });
});
