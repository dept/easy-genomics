import {
  draftToRunLimits,
  formatRunLimit,
  runLimitsDraftError,
  runLimitsToDraft,
  usageLimitsNote,
  type RunLimitsDraft,
} from '../../../src/app/utils/usage-limits-form';

const draft = (fields: Partial<RunLimitsDraft>): RunLimitsDraft => ({
  CostWarnAboveUsd: '',
  CostBlockAboveUsd: '',
  SamplesWarnAbove: '',
  SamplesBlockAbove: '',
  ...fields,
});

describe('draftToRunLimits', () => {
  it('omits blank fields so the server clears them', () => {
    expect(draftToRunLimits(draft({ CostWarnAboveUsd: '150', SamplesBlockAbove: ' 500 ' }))).toEqual({
      CostWarnAboveUsd: 150,
      SamplesBlockAbove: 500,
    });
  });

  it('sends {} when every field is blank', () => {
    expect(draftToRunLimits(draft({}))).toEqual({});
  });

  it('keeps cents on cost amounts', () => {
    expect(draftToRunLimits(draft({ CostWarnAboveUsd: '149.50' }))).toEqual({ CostWarnAboveUsd: 149.5 });
  });
});

describe('runLimitsDraftError', () => {
  it.each([
    [
      { CostWarnAboveUsd: '400', CostBlockAboveUsd: '400' },
      'CostBlockAboveUsd',
      'The cost block amount needs to be higher than the warn amount.',
    ],
    [
      { CostWarnAboveUsd: '400', CostBlockAboveUsd: '300' },
      'CostBlockAboveUsd',
      'The cost block amount needs to be higher than the warn amount.',
    ],
    [
      { SamplesWarnAbove: '500', SamplesBlockAbove: '500' },
      'SamplesBlockAbove',
      'The samples block amount needs to be higher than the warn amount.',
    ],
    [{ CostWarnAboveUsd: '0' }, 'CostWarnAboveUsd', 'Amounts need to be more than 0.'],
    [{ SamplesBlockAbove: '-5' }, 'SamplesBlockAbove', 'Amounts need to be more than 0.'],
    [{ SamplesWarnAbove: '2.5' }, 'SamplesWarnAbove', 'Sample amounts need to be whole numbers.'],
    [{ CostBlockAboveUsd: 'abc' }, 'CostBlockAboveUsd', 'Amounts need to be more than 0.'],
  ])('rejects %j', (fields, field, message) => {
    expect(runLimitsDraftError(draft(fields))).toEqual({ field, message });
  });

  it.each([
    {},
    { CostBlockAboveUsd: '400' },
    { SamplesWarnAbove: '300' },
    { CostWarnAboveUsd: '150', CostBlockAboveUsd: '400', SamplesWarnAbove: '300', SamplesBlockAbove: '500' },
  ])('accepts %j', (fields) => {
    expect(runLimitsDraftError(draft(fields))).toBeNull();
  });

  it('reports the cost error before the samples error, as the design does', () => {
    const error = runLimitsDraftError(
      draft({ CostWarnAboveUsd: '4', CostBlockAboveUsd: '4', SamplesWarnAbove: '5', SamplesBlockAbove: '5' }),
    );
    expect(error?.field).toBe('CostBlockAboveUsd');
  });
});

describe('runLimitsToDraft', () => {
  it('round-trips stored limits', () => {
    expect(runLimitsToDraft({ CostWarnAboveUsd: 150 })).toEqual(draft({ CostWarnAboveUsd: '150' }));
    expect(runLimitsToDraft(undefined)).toEqual(draft({}));
  });
});

describe('formatRunLimit', () => {
  it('formats amounts', () => {
    expect(formatRunLimit(1500, 'usd')).toBe('US$1,500');
    expect(formatRunLimit(1000, 'count')).toBe('1,000');
    expect(formatRunLimit(undefined, 'usd')).toBe('Not set');
  });
});

describe('usageLimitsNote', () => {
  it('picks the note', () => {
    expect(usageLimitsNote(null, null)).toBe('Runs already going are never stopped by a change here.');
    expect(usageLimitsNote('Sequencing', null)).toBe('Editing Sequencing. Leave an amount blank to skip it.');
    expect(usageLimitsNote('Sequencing', { field: 'SamplesBlockAbove', message: 'X' })).toBe('X');
  });
});
