import {
  coerceNumericParamValue,
  coerceNumericWorkflowParams,
  isVersionLikeParam,
} from './coerce-numeric-workflow-params';

describe('isVersionLikeParam', () => {
  it('recognises dotted version strings with at least two separators', () => {
    expect(isVersionLikeParam('5.3.7')).toBe(true);
    expect(isVersionLikeParam(' 1.0.0 ')).toBe(true);
    expect(isVersionLikeParam('10.2.3.4')).toBe(true);
  });

  it('rejects decimals, integers and non-strings', () => {
    expect(isVersionLikeParam('42')).toBe(false);
    expect(isVersionLikeParam('3.14')).toBe(false);
    expect(isVersionLikeParam('0.5')).toBe(false);
    expect(isVersionLikeParam(42)).toBe(false);
  });
});

describe('coerceNumericParamValue', () => {
  it('coerces integer and decimal strings when untyped', () => {
    expect(coerceNumericParamValue('42')).toBe(42);
    expect(coerceNumericParamValue(' 3.14 ')).toBe(3.14);
    expect(coerceNumericParamValue('-7')).toBe(-7);
    expect(coerceNumericParamValue('0')).toBe(0);
    expect(coerceNumericParamValue('0.5')).toBe(0.5);
  });

  it('coerces untyped and number/integer-typed values, but not string or boolean', () => {
    expect(coerceNumericParamValue('10', 'number')).toBe(10);
    expect(coerceNumericParamValue('10', 'integer')).toBe(10);
    expect(coerceNumericParamValue('10', undefined)).toBe(10);
    expect(coerceNumericParamValue('10', 'string')).toBe('10');
    expect(coerceNumericParamValue('10', 'boolean')).toBe('10');
  });

  it('leaves non-numeric and ambiguous strings alone', () => {
    expect(coerceNumericParamValue('s3://bucket/out')).toBe('s3://bucket/out');
    expect(coerceNumericParamValue('5.3.7')).toBe('5.3.7');
    expect(coerceNumericParamValue('007')).toBe('007');
    expect(coerceNumericParamValue('01')).toBe('01');
    expect(coerceNumericParamValue('1e3')).toBe('1e3');
    expect(coerceNumericParamValue('')).toBe('');
    expect(coerceNumericParamValue('  ')).toBe('  ');
    expect(coerceNumericParamValue('3.14', 'integer')).toBe('3.14');
  });

  it('passes through non-string values unchanged', () => {
    expect(coerceNumericParamValue(8)).toBe(8);
    expect(coerceNumericParamValue(true)).toBe(true);
    expect(coerceNumericParamValue(null)).toBeNull();
  });
});

describe('coerceNumericWorkflowParams', () => {
  it('coerces a flat params map, honouring per-field types', () => {
    expect(
      coerceNumericWorkflowParams(
        {
          threads: '8',
          sampleId: '123',
          outdir: 's3://bucket/out',
          version: '5.3.7',
          empty: '',
        },
        { sampleId: 'string' },
      ),
    ).toEqual({
      threads: 8,
      sampleId: '123',
      outdir: 's3://bucket/out',
      version: '5.3.7',
      empty: '',
    });
  });
});
