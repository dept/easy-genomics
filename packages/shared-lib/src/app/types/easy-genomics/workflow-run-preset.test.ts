import { isRunSpecificParam, omitRunSpecificParams } from './workflow-run-preset';

describe('isRunSpecificParam', () => {
  it.each(['input', 'output', 'outdir', 'runname', 'run_name'])('treats %s as run specific', (name: string) => {
    expect(isRunSpecificParam(name)).toBe(true);
  });

  it('matches regardless of the casing used by the parameter template', () => {
    expect(isRunSpecificParam('Outdir')).toBe(true);
    expect(isRunSpecificParam('INPUT')).toBe(true);
  });

  it('leaves reusable analysis parameters alone', () => {
    expect(isRunSpecificParam('genome')).toBe(false);
    expect(isRunSpecificParam('max_memory')).toBe(false);
    // Guards against a prefix/substring match rather than an exact one.
    expect(isRunSpecificParam('input_format')).toBe(false);
    expect(isRunSpecificParam('save_output')).toBe(false);
  });
});

describe('omitRunSpecificParams', () => {
  it('strips the per-run S3 paths and run name while keeping reusable values', () => {
    expect(
      omitRunSpecificParams({
        input: 's3://bucket/org/lab/aws-healthomics/abc123/sample-sheet.csv',
        outdir: 's3://bucket/org/lab/aws-healthomics/abc123/results',
        run_name: 'Tuesday run',
        genome: 'GRCh38',
        max_memory: 16,
        save_reference: true,
      }),
    ).toEqual({
      genome: 'GRCh38',
      max_memory: 16,
      save_reference: true,
    });
  });

  it('returns an empty map when a run carries nothing reusable', () => {
    expect(omitRunSpecificParams({ input: 's3://bucket/in.csv', outdir: 's3://bucket/results' })).toEqual({});
  });

  it('does not mutate the caller-supplied parameters', () => {
    const params = { outdir: 's3://bucket/results', genome: 'GRCh38' };
    omitRunSpecificParams(params);
    expect(params).toEqual({ outdir: 's3://bucket/results', genome: 'GRCh38' });
  });
});
