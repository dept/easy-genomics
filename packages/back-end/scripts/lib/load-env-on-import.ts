import { loadDotEnvAndReconcileRegion } from './load-env';

/**
 * Side-effect import for scripts that use services which read `process.env` at module load (for
 * example `LaboratoryDataTaggingService` builds its table name from `NAME_PREFIX` when imported).
 * Import it before those services; loading `.env.local` inside `main()` is too late for them.
 */
loadDotEnvAndReconcileRegion();
