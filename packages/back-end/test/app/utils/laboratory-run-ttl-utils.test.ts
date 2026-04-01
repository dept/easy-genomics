import {
  getRetentionMonthsOrDefault,
  shouldExpireWithRetentionMonths,
} from '../../../src/app/utils/laboratory-run-ttl-utils';

describe('laboratory-run-ttl-utils', () => {
  describe('getRetentionMonthsOrDefault', () => {
    it('treats 0 as explicit never-delete, not missing', () => {
      expect(getRetentionMonthsOrDefault(0)).toBe(0);
    });

    it('coerces string "0" from JSON so it is not replaced by the default', () => {
      expect(getRetentionMonthsOrDefault('0')).toBe(0);
    });

    it('uses default only for null, undefined, or empty string', () => {
      expect(getRetentionMonthsOrDefault(undefined)).toBe(6);
      expect(getRetentionMonthsOrDefault(null)).toBe(6);
      expect(getRetentionMonthsOrDefault('')).toBe(6);
    });

    it('floors positive numbers and coerces numeric strings', () => {
      expect(getRetentionMonthsOrDefault(12)).toBe(12);
      expect(getRetentionMonthsOrDefault('9')).toBe(9);
      expect(getRetentionMonthsOrDefault(3.7)).toBe(3);
    });
  });

  describe('shouldExpireWithRetentionMonths', () => {
    it('is false for 0 and true for positive', () => {
      expect(shouldExpireWithRetentionMonths(0)).toBe(false);
      expect(shouldExpireWithRetentionMonths(6)).toBe(true);
    });
  });
});
