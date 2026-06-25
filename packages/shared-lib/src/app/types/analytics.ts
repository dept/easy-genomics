import { z } from 'zod';

/**
 * Privacy-safe upstream analytics event taxonomy.
 *
 * This file is the single source of truth for the shape of every analytics
 * event that the Easy Genomics front-end may send to the project's central
 * PostHog project. It is deliberately small and explicit.
 *
 * Design principles (see the privacy-safe analytics design doc):
 *  - Anonymous by construction. We never send emails, names, run names, file
 *    names, S3 keys, sample IDs, sample-sheet contents, workflow parameters,
 *    free-text search queries, JWTs, raw IPs, AWS account IDs, domain names or
 *    hostnames.
 *  - Identifiers are opaque. `deployment_id` is a random per-deployment value;
 *    user / lab / org identifiers are one-way salted SHA-256 hashes computed in
 *    the browser. The per-deployment salt means the same person at two
 *    institutions looks like two unrelated hashes.
 *  - Magnitudes are bucketed, never raw, so counts/sizes/durations cannot be
 *    used to fingerprint a specific run or user.
 */

/**
 * Per-user analytics consent state.
 *  - `unset`   : the user has not yet answered the consent banner (default).
 *  - `granted` : the user explicitly accepted.
 *  - `denied`  : the user explicitly rejected (or revoked) consent.
 */
export const AnalyticsConsentSchema = z.enum(['unset', 'granted', 'denied']);
export type AnalyticsConsent = z.infer<typeof AnalyticsConsentSchema>;

/** Coarse bucket for counts (e.g. number of files, number of invitees). */
export const CountBucketSchema = z.enum(['0', '1', '2-5', '6-20', '21-100', '100+']);
export type CountBucket = z.infer<typeof CountBucketSchema>;

/** Coarse bucket for byte sizes (e.g. total upload size). */
export const SizeBucketSchema = z.enum(['0', '<10MB', '10MB-100MB', '100MB-1GB', '1GB-10GB', '10GB+']);
export type SizeBucket = z.infer<typeof SizeBucketSchema>;

/** Coarse bucket for durations in seconds (e.g. run latency). */
export const DurationBucketSchema = z.enum(['<1m', '1-5m', '5-30m', '30m-2h', '2-12h', '12h+']);
export type DurationBucket = z.infer<typeof DurationBucketSchema>;

/** The two run platforms supported by Easy Genomics. */
export const AnalyticsPlatformSchema = z.enum(['seqera', 'omics']);
export type AnalyticsPlatform = z.infer<typeof AnalyticsPlatformSchema>;

/**
 * Super-properties attached to every event by the analytics driver on init.
 * These describe the deployment, never the user.
 */
export const AnalyticsSuperPropertiesSchema = z.object({
  deployment_id: z.string(),
  app_version: z.string(),
  env_type: z.string(),
});
export type AnalyticsSuperProperties = z.infer<typeof AnalyticsSuperPropertiesSchema>;

/**
 * The first event set. Each schema describes ONLY the per-call properties;
 * super-properties (deployment_id, app_version, env_type) are merged in by the
 * driver and are not repeated here.
 */
export const AnalyticsEventPropertiesSchemas = {
  app_loaded: z.object({
    app_version: z.string(),
    env_type: z.string(),
    deployment_age_days: z.number().int().nonnegative().optional(),
  }),
  signed_in: z.object({
    method: z.enum(['password', 'google_sso']),
  }),
  signed_out: z.object({}).strict(),
  invitation_accepted: z.object({
    role: z.string(),
  }),
  lab_viewed: z.object({
    lab_id_hash: z.string(),
    tab: z.string(),
  }),
  lab_tab_changed: z.object({
    lab_id_hash: z.string().optional(),
    from_tab: z.string(),
    to_tab: z.string(),
  }),
  user_invited: z.object({
    role: z.string(),
    count_bucket: CountBucketSchema,
  }),
  run_wizard_started: z.object({
    platform: AnalyticsPlatformSchema,
  }),
  run_step_completed: z.object({
    step: z.string(),
    platform: AnalyticsPlatformSchema,
  }),
  run_wizard_abandoned: z.object({
    step_at_exit: z.string(),
    platform: AnalyticsPlatformSchema,
  }),
  run_launched: z.object({
    platform: AnalyticsPlatformSchema,
    workflow_id_hash: z.string(),
    file_count_bucket: CountBucketSchema,
    upload_size_bucket: SizeBucketSchema,
  }),
  run_status_changed: z.object({
    from_status: z.string(),
    to_status: z.string(),
    platform: AnalyticsPlatformSchema,
    duration_bucket: DurationBucketSchema.optional(),
    transaction_id: z.string(),
  }),
  run_cancelled: z.object({
    platform: AnalyticsPlatformSchema,
    status_at_cancel: z.string(),
  }),
  file_upload_failed: z.object({
    error_code: z.string(),
    size_bucket: SizeBucketSchema.optional(),
  }),
  sample_sheet_validation_failed: z.object({
    error_type: z.string(),
  }),
  file_browser_action: z.object({
    action: z.enum(['navigate', 'search', 'download_file', 'download_folder']),
  }),
  error_toast_shown: z.object({
    error_code: z.string(),
  }),
} as const;

/** Union of all valid analytics event names. */
export const AnalyticsEventNameSchema = z.enum(
  Object.keys(AnalyticsEventPropertiesSchemas) as [
    keyof typeof AnalyticsEventPropertiesSchemas,
    ...(keyof typeof AnalyticsEventPropertiesSchemas)[],
  ],
);
export type AnalyticsEventName = z.infer<typeof AnalyticsEventNameSchema>;

/** Strongly-typed map of event name -> its property type. */
export type AnalyticsEventPropertiesMap = {
  [K in keyof typeof AnalyticsEventPropertiesSchemas]: z.infer<(typeof AnalyticsEventPropertiesSchemas)[K]>;
};
