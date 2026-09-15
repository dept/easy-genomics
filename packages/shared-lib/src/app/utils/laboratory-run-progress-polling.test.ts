import {
  DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
  DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
  getRunDetailProgressPollIntervalMs,
  getRunDetailProgressPollIntervalSecondsOrDefault,
  getRunListStatusPollIntervalMs,
  getRunListStatusPollIntervalSecondsOrDefault,
} from './laboratory-run-progress-polling';

describe('laboratory-run-progress-polling', () => {
  describe('getRunListStatusPollIntervalSecondsOrDefault', () => {
    it('uses the default for missing values', () => {
      expect(getRunListStatusPollIntervalSecondsOrDefault(undefined)).toBe(
        DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
      );
      expect(getRunListStatusPollIntervalSecondsOrDefault(null)).toBe(DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS);
      expect(getRunListStatusPollIntervalSecondsOrDefault('')).toBe(DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS);
    });

    it('accepts in-range numeric inputs and floors decimals', () => {
      expect(getRunListStatusPollIntervalSecondsOrDefault(120)).toBe(120);
      expect(getRunListStatusPollIntervalSecondsOrDefault('45')).toBe(45);
      expect(getRunListStatusPollIntervalSecondsOrDefault(90.9)).toBe(90);
    });

    it('falls back to the default for out-of-range values', () => {
      expect(getRunListStatusPollIntervalSecondsOrDefault(29)).toBe(DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS);
      expect(getRunListStatusPollIntervalSecondsOrDefault(1801)).toBe(DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS);
    });
  });

  describe('getRunDetailProgressPollIntervalSecondsOrDefault', () => {
    it('uses the default for missing values', () => {
      expect(getRunDetailProgressPollIntervalSecondsOrDefault(undefined)).toBe(
        DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
      );
      expect(getRunDetailProgressPollIntervalSecondsOrDefault(null)).toBe(
        DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
      );
      expect(getRunDetailProgressPollIntervalSecondsOrDefault('')).toBe(
        DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
      );
    });

    it('accepts in-range numeric inputs and floors decimals', () => {
      expect(getRunDetailProgressPollIntervalSecondsOrDefault(30)).toBe(30);
      expect(getRunDetailProgressPollIntervalSecondsOrDefault('25')).toBe(25);
      expect(getRunDetailProgressPollIntervalSecondsOrDefault(15.8)).toBe(15);
    });

    it('falls back to the default for out-of-range values', () => {
      expect(getRunDetailProgressPollIntervalSecondsOrDefault(9)).toBe(
        DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
      );
      expect(getRunDetailProgressPollIntervalSecondsOrDefault(301)).toBe(
        DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
      );
    });
  });

  it('converts the resolved values to milliseconds', () => {
    expect(getRunListStatusPollIntervalMs(45)).toBe(45_000);
    expect(getRunDetailProgressPollIntervalMs(undefined)).toBe(
      DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS * 1000,
    );
  });
});
