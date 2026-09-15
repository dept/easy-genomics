import {
  analyzeUploadFileAlerts,
  buildBannerDetail,
  UPLOAD_ALERT_BANNER_LEAD,
} from '../../../src/app/utils/run-upload-file-alerts';

describe('run-upload-file-alerts', () => {
  describe('analyzeUploadFileAlerts', () => {
    it('returns no alerts for an empty set', () => {
      const result = analyzeUploadFileAlerts([]);
      expect(result.codes).toEqual([]);
      expect(result.bannerDetail).toBeNull();
      expect(result.flaggedFileCount).toBe(0);
    });

    it('allows all single-end files (R1 only) without alerts', () => {
      const result = analyzeUploadFileAlerts([
        { sampleId: 'A', hasR1: true, hasR2: false },
        { sampleId: 'B', hasR1: true, hasR2: false },
        { sampleId: 'C', hasR1: true, hasR2: false },
      ]);
      expect(result.codes).toEqual([]);
      expect(result.flaggedSampleIds.size).toBe(0);
      expect(result.bannerDetail).toBeNull();
    });

    it('allows all complete pairs without alerts', () => {
      const result = analyzeUploadFileAlerts([
        { sampleId: 'A', hasR1: true, hasR2: true },
        { sampleId: 'B', hasR1: true, hasR2: true },
      ]);
      expect(result.codes).toEqual([]);
      expect(result.flaggedFileCount).toBe(0);
    });

    it('flags missing R2 and odd count when paired-end intent exists', () => {
      const result = analyzeUploadFileAlerts([
        { sampleId: '1DXJQC', hasR1: true, hasR2: true },
        { sampleId: '2PBY7M', hasR1: true, hasR2: true },
        { sampleId: '3HTQR2', hasR1: true, hasR2: false },
      ]);
      expect(result.codes).toEqual(expect.arrayContaining(['missing_r2', 'mixed_single_and_paired', 'odd_file_count']));
      expect(result.flaggedSampleIds.has('3HTQR2')).toBe(true);
      expect(result.flaggedFileCount).toBe(1);
      expect(result.bannerDetail).toContain('odd (5)');
      expect(result.bannerDetail).toContain('missing an R1 or R2');
    });

    it('flags missing R1 even without a complete pair', () => {
      const result = analyzeUploadFileAlerts([{ sampleId: 'orphan', hasR1: false, hasR2: true }]);
      expect(result.codes).toContain('missing_r1');
      expect(result.flaggedSampleIds.has('orphan')).toBe(true);
      expect(result.codes).not.toContain('odd_file_count');
    });

    it('does not flag odd count for pure single-end sets', () => {
      const result = analyzeUploadFileAlerts([
        { sampleId: 'A', hasR1: true, hasR2: false },
        { sampleId: 'B', hasR1: true, hasR2: false },
        { sampleId: 'C', hasR1: true, hasR2: false },
      ]);
      expect(result.codes).not.toContain('odd_file_count');
    });
  });

  describe('buildBannerDetail', () => {
    it('returns null when there are no codes', () => {
      expect(buildBannerDetail([], 0)).toBeNull();
    });

    it('combines odd count and missing pair messages', () => {
      const detail = buildBannerDetail(['odd_file_count', 'missing_r2'], 7);
      expect(detail).toBe(
        'The number of files is odd (7) — paired-end data expects an even number of files, and one or more samples are missing an R1 or R2 file.',
      );
    });
  });

  it('exports a stable banner lead-in', () => {
    expect(UPLOAD_ALERT_BANNER_LEAD).toMatch(/need checking/i);
  });
});
