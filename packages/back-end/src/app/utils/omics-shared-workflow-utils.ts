import type { ListSharesCommandInput, ShareDetails } from '@aws-sdk/client-omics';
import { ShareStatus } from '@aws-sdk/client-omics';
import type { OmicsService } from '@BE/services/omics-service';
import { workflowIdFromOmicsShare } from '@BE/utils/laboratory-workflow-access-utils';

/**
 * Owner AWS account id for a shared workflow.
 * Prefer ShareDetails.ownerId; fall back to the account segment of resourceArn.
 */
export function ownerAccountIdFromOmicsShare(share: ShareDetails): string | undefined {
  if (share.ownerId) {
    return share.ownerId;
  }
  const arn = share.resourceArn;
  if (!arn) {
    return undefined;
  }
  // arn:aws:omics:<region>:<accountId>:workflow/<id>
  const parts = arn.split(':');
  if (parts.length >= 5 && parts[4]) {
    return parts[4];
  }
  return undefined;
}

export function isActiveOmicsShare(share: ShareDetails): boolean {
  return share.status === undefined || share.status === ShareStatus.ACTIVE;
}

export type SharedWorkflowSummary = {
  id: string;
  name: string;
  ownerAccountId?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTooManyRequestsError(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'TooManyRequestsException' || err?.$metadata?.httpStatusCode === 429;
}

/**
 * ListShares is aggressively rate-limited; SDK default retries (~3 attempts, sub-second
 * backoff) are often insufficient under concurrent lab-page loads.
 */
async function listSharedWorkflowsPage(
  omicsService: Pick<OmicsService, 'listSharedWorkflows'>,
  input: ListSharesCommandInput,
  maxAttempts = 5,
): Promise<Awaited<ReturnType<OmicsService['listSharedWorkflows']>>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await omicsService.listSharedWorkflows(input);
    } catch (error) {
      lastError = error;
      if (!isTooManyRequestsError(error) || attempt === maxAttempts) {
        throw error;
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    }
  }
  throw lastError;
}

/**
 * Paginates ListShares (resourceOwner OTHER) and returns ACTIVE shared workflows.
 */
export async function listAllSharedWorkflowSummaries(
  omicsService: Pick<OmicsService, 'listSharedWorkflows'>,
): Promise<SharedWorkflowSummary[]> {
  const out: SharedWorkflowSummary[] = [];
  let nextToken: string | undefined;
  do {
    const page = await listSharedWorkflowsPage(omicsService, <ListSharesCommandInput>{
      resourceOwner: 'OTHER',
      maxResults: 100,
      nextToken,
    });
    for (const share of page.shares ?? []) {
      if (!isActiveOmicsShare(share)) {
        continue;
      }
      const id = workflowIdFromOmicsShare(share);
      if (!id) {
        continue;
      }
      out.push({
        id,
        name: share.shareName ?? id,
        ownerAccountId: ownerAccountIdFromOmicsShare(share),
      });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

/**
 * Resolves workflowOwnerId for a cross-account shared HealthOmics workflow by
 * matching workflowId against ListShares. Returns undefined when the workflow
 * is not an ACTIVE share (i.e. treat as private / own-account).
 */
export async function resolveSharedWorkflowOwnerId(
  omicsService: Pick<OmicsService, 'listSharedWorkflows'>,
  workflowId: string,
): Promise<string | undefined> {
  const shared = await listAllSharedWorkflowSummaries(omicsService);
  const match = shared.find((s) => s.id === workflowId);
  return match?.ownerAccountId;
}
