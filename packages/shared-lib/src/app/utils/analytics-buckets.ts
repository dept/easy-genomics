import { CountBucket, DurationBucket, SizeBucket } from '../types/analytics';

/**
 * Coarse bucketing helpers for privacy-safe analytics magnitudes.
 *
 * These are the privacy guarantee for numeric magnitudes: raw counts, sizes and
 * durations are never sent, only the bucket they fall into. They are pure and
 * side-effect free so every call site can share them and they can be unit
 * tested in isolation.
 */

/** Buckets a count into a coarse {@link CountBucket}. */
export function toCountBucket(count: number): CountBucket {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '100+';
}

/** Buckets a byte size into a coarse {@link SizeBucket}. */
export function toSizeBucket(bytes: number): SizeBucket {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0';
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  if (bytes < 10 * MB) return '<10MB';
  if (bytes < 100 * MB) return '10MB-100MB';
  if (bytes < GB) return '100MB-1GB';
  if (bytes < 10 * GB) return '1GB-10GB';
  return '10GB+';
}

/** Buckets a duration (seconds) into a coarse {@link DurationBucket}. */
export function toDurationBucket(seconds: number): DurationBucket {
  if (!Number.isFinite(seconds) || seconds < 60) return '<1m';
  const minutes = seconds / 60;
  if (minutes < 5) return '1-5m';
  if (minutes < 30) return '5-30m';
  if (minutes < 120) return '30m-2h';
  if (minutes < 720) return '2-12h';
  return '12h+';
}
