import { main as backfillLaboratoryRunAttributes } from '../backfill-laboratory-run-attributes';
import { main as migrateLaboratoryS3AccessSeed } from '../migrate-laboratory-s3-access-seed';

export type DeployMigrationPhase = 'pre' | 'post';

export interface DeployMigration {
  id: string;
  phase: DeployMigrationPhase;
  main: () => Promise<void>;
}

export const DEPLOY_MIGRATIONS: DeployMigration[] = [
  {
    // Must run before new code depends on PollStatus/NotifiedAt existing on every run row —
    // in-flight runs are otherwise invisible to process-poll-active-runs, and pre-existing
    // terminal runs trigger a burst of stale "run finished" emails the next time they're touched.
    id: '2026-08-backfill-laboratory-run-attributes',
    phase: 'pre',
    main: backfillLaboratoryRunAttributes,
  },
  {
    // Must run after cdk deploy: depends on the laboratory-s3-access-table existing.
    id: '2026-08-migrate-laboratory-s3-access-seed',
    phase: 'post',
    main: migrateLaboratoryS3AccessSeed,
  },
];
