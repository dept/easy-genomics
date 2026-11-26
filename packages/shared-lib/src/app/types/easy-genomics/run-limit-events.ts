/**
 * One warned launch or blocked attempt, stored in the run-limit-event-table. OrganizationId is the
 * partition key and EventKey (`${Kind}#${Day}#${EventId}`) the sort key, so one kind over a
 * period is a single Query. Rows expire (ExpiresAt, epoch seconds) 13 months after they occur.
 */
import { RunLimitHit } from '../../schema/easy-genomics/laboratory-run-limits';
import { RunType } from '../base-entity';

export type RunLimitBlockReason = 'limitExceeded' | 'samplesNotCounted' | 'costEstimateFailed';

export type RunLimitEvent = {
  OrganizationId: string;
  EventKey: string;
  Kind: 'warned' | 'blocked';
  Day: string; // YYYY-MM-DD, UTC
  OccurredAt: string;
  LaboratoryId: string;
  Platform: RunType;
  WorkflowExternalId: string;
  WorkflowVersionName?: string;
  UserId: string;
  UserEmail?: string;
  Source: 'review' | 'launch';
  Reason?: RunLimitBlockReason;
  Hits: RunLimitHit[];
  SampleCount?: number;
  CostEstimateUsd?: number;
  ExternalRunId?: string;
  RunName?: string;
  ExpiresAt: number;
};

export type RunLimitEventView = Omit<RunLimitEvent, 'ExpiresAt'> & { UserDisplayName: string };

export type RunLimitEventsResponse = { Events: RunLimitEventView[]; Truncated: boolean };
