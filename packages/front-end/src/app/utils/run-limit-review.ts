import type { EstimateRunCostResponse } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import type {
  RunLimitHit,
  RunLimitVerdict,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-limits';
import type {
  LaboratoryRunLimits,
  WorkflowCostLimits,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { type CostLimitSource, resolveCostLimits } from '@easy-genomics/shared-lib/src/app/utils/workflow-run-limits';

export type RunLimitReviewInput = {
  /** The response's verdict; undefined means no limits apply and the review step looks as it always has. */
  verdict?: RunLimitVerdict;
  /** Null while loading or after a failed request. */
  estimate: EstimateRunCostResponse | null;
  loading: boolean;
  /** The estimate request threw an error that is not a limit error. */
  estimateFailed: boolean;
  /** A limit error's text, from the estimate call or a launch. */
  serverBlockMessage: string | null;
  runLimits?: LaboratoryRunLimits;
  /** The lab is being reloaded, so `runLimits` may be an out-of-date copy. */
  runLimitsLoading?: boolean;
  /** This run's workflow's own cost amounts, from the same lab copy as `runLimits`. */
  workflowCostLimits?: WorkflowCostLimits;
};

export type RunLimitMessage = { tone: 'warn' | 'block'; role: 'status' | 'alert'; title: string; body: string };

export type RunLimitReview = {
  samplesRow: { countText: string | null; limitText: string } | null;
  /** Basis line; non-null means show the "Not enough runs to estimate" row. */
  notEnoughHistoryText: string | null;
  message: RunLimitMessage | null;
  launchDisabled: boolean;
  /** True: the launch button reads "Launch anyway". */
  launchAnyway: boolean;
};

const BLOCK_TITLE = "This run can't be launched";
const BLOCK_ADVICE = 'Split the samples into smaller runs, or ask an organization admin to change the limit.';
const WARN_ADVICE = 'Check the samples and parameters before you launch.';
const REQUEST_ERROR_PREFIX = 'Request error: ';

// repository/factory.ts drops the response's ErrorCode, so the server's message text is the only signal.
const LIMIT_ERROR_FRAGMENTS = [
  'Split the samples into smaller runs, or ask an organization admin to change the limit.', // EG-339, EG-340
  'The samples in this run could not be counted', // EG-341
  // Matches EG-342's wording before and after it stopped naming the laboratory, so a back-end deployed
  // ahead of or behind the front end is still recognized.
  'so the run was not started', // EG-342
];

/** The server's limit message when `error` is a run limit error (EG-339 to EG-342), otherwise null. */
export function runLimitErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const message = error.message.startsWith(REQUEST_ERROR_PREFIX)
    ? error.message.slice(REQUEST_ERROR_PREFIX.length)
    : error.message;
  return LIMIT_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment)) ? message : null;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatUsdWithCents(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAmountUsd(amount: number): string {
  return Number.isInteger(amount) ? formatCount(amount) : formatUsdWithCents(amount);
}

/** Whole dollars, unless rounding would make an estimate above the amount read as equal to or below it. */
function formatRunUsd(runValue: number, amount: number): string {
  const rounded = Math.round(runValue);
  return rounded <= amount ? formatUsdWithCents(runValue) : formatCount(rounded);
}

function amountOwner(hit: RunLimitHit): string {
  return hit.amountSource === 'workflow' ? "this workflow's" : "this lab's";
}

function warnSentence(hit: RunLimitHit): string {
  if (hit.limit === 'cost') {
    return `This run is estimated at about US$${formatRunUsd(hit.runValue, hit.amount)}, over ${amountOwner(hit)} US$${formatAmountUsd(hit.amount)} warning amount.`;
  }
  return `This run has ${formatCount(hit.runValue)} samples, over this lab's warning amount of ${formatCount(hit.amount)} per run.`;
}

function blockSentence(hit: RunLimitHit): string {
  if (hit.limit === 'cost') {
    return `It's estimated at about US$${formatRunUsd(hit.runValue, hit.amount)}, over ${amountOwner(hit)} US$${formatAmountUsd(hit.amount)} limit.`;
  }
  return `It has ${formatCount(hit.runValue)} samples, and this lab allows ${formatCount(hit.amount)} per run.`;
}

/** Hits at one level, cost before samples. */
function hitsAt(verdict: RunLimitVerdict, level: RunLimitHit['level']): RunLimitHit[] {
  const atLevel = verdict.hits.filter((hit) => hit.level === level);
  return [...atLevel.filter((hit) => hit.limit === 'cost'), ...atLevel.filter((hit) => hit.limit === 'samples')];
}

function warnTitle(hits: RunLimitHit[]): string {
  const hasCost = hits.some((hit) => hit.limit === 'cost');
  const hasSamples = hits.some((hit) => hit.limit === 'samples');
  if (hasCost && hasSamples) {
    return 'Cost and sample warning';
  }
  return hasCost ? 'Cost warning' : 'Sample warning';
}

function hasAnyLimit(runLimits?: LaboratoryRunLimits, workflowCostLimits?: WorkflowCostLimits): boolean {
  return (
    runLimits?.CostWarnAboveUsd !== undefined ||
    runLimits?.CostBlockAboveUsd !== undefined ||
    runLimits?.SamplesWarnAbove !== undefined ||
    runLimits?.SamplesBlockAbove !== undefined ||
    workflowCostLimits?.CostWarnAboveUsd !== undefined ||
    workflowCostLimits?.CostBlockAboveUsd !== undefined
  );
}

/**
 * Set when a cost amount applies that this run can't be checked against because the lab has too few past runs.
 * Each amount is the workflow's own where set, otherwise the lab's, as in the launch check.
 */
function costNotEstimatedSentence(input: RunLimitReviewInput): string | null {
  if (input.verdict?.costEstimate !== 'notEnoughHistory') {
    return null;
  }
  const { blockAbove, warnAbove } = resolveCostLimits(input.runLimits, input.workflowCostLimits);
  const ownerOf = (source: CostLimitSource) => (source === 'workflow' ? "this workflow's" : "this lab's");
  let amountText: string;
  if (blockAbove) {
    amountText = `${ownerOf(blockAbove.source)} US$${formatAmountUsd(blockAbove.amount)} cost limit`;
  } else if (warnAbove) {
    amountText = `${ownerOf(warnAbove.source)} US$${formatAmountUsd(warnAbove.amount)} cost warning amount`;
  } else {
    return null;
  }
  return (
    "There aren't enough past runs of this workflow in this lab to estimate this run's cost, " +
    `so it isn't checked against ${amountText}. It could cost more than that.`
  );
}

function deriveMessage(input: RunLimitReviewInput, labHasLimits: boolean): RunLimitMessage | null {
  if (input.serverBlockMessage) {
    return { tone: 'block', role: 'alert', title: BLOCK_TITLE, body: input.serverBlockMessage };
  }
  if (input.verdict?.outcome === 'block') {
    const sentences = hitsAt(input.verdict, 'block').map(blockSentence);
    return { tone: 'block', role: 'alert', title: BLOCK_TITLE, body: [...sentences, BLOCK_ADVICE].join(' ') };
  }
  const costNotEstimated = costNotEstimatedSentence(input);
  if (input.verdict?.outcome === 'warn') {
    const hits = hitsAt(input.verdict, 'warn');
    const sentences = [...hits.map(warnSentence), ...(costNotEstimated ? [costNotEstimated] : []), WARN_ADVICE];
    return { tone: 'warn', role: 'status', title: warnTitle(hits), body: sentences.join(' ') };
  }
  if (costNotEstimated) {
    return { tone: 'warn', role: 'status', title: 'Cost not estimated', body: costNotEstimated };
  }
  if (input.estimateFailed && labHasLimits) {
    return {
      tone: 'warn',
      role: 'status',
      title: 'Limits not checked',
      body: "This run couldn't be checked against its limits. They're checked again when you launch.",
    };
  }
  return null;
}

function deriveSamplesRow(input: RunLimitReviewInput): RunLimitReview['samplesRow'] {
  const samplesHit = input.verdict?.hits.find((hit) => hit.limit === 'samples');
  // The verdict's amount is the one the message names, so it wins over the lab copy loaded with the page.
  const blockAbove =
    (samplesHit?.level === 'block' ? samplesHit.amount : undefined) ?? input.runLimits?.SamplesBlockAbove;
  const warnAbove = (samplesHit?.level === 'warn' ? samplesHit.amount : undefined) ?? input.runLimits?.SamplesWarnAbove;

  let limitText: string;
  if (blockAbove !== undefined) {
    limitText = `Limit: ${formatCount(blockAbove)} per run`;
  } else if (warnAbove !== undefined) {
    limitText = `Warning above ${formatCount(warnAbove)} per run`;
  } else {
    return null;
  }

  const sampleCount = input.verdict?.sampleCount ?? samplesHit?.runValue;
  return { countText: sampleCount === undefined ? null : formatCount(sampleCount), limitText };
}

function deriveNotEnoughHistoryText(input: RunLimitReviewInput): string | null {
  if (input.verdict?.costEstimate !== 'notEnoughHistory') {
    return null;
  }
  const pastRuns = input.estimate?.comparableRunCount ?? 0;
  if (pastRuns === 0) {
    return 'No past runs of this workflow in this lab';
  }
  return pastRuns === 1
    ? '1 past run of this workflow in this lab'
    : `${pastRuns} past runs of this workflow in this lab`;
}

/** Everything the review step shows about run limits, decided from the server's verdict and any limit error. */
export function deriveRunLimitReview(input: RunLimitReviewInput): RunLimitReview {
  const labHasLimits = hasAnyLimit(input.runLimits, input.workflowCostLimits);
  const message = deriveMessage(input, labHasLimits);
  return {
    samplesRow: deriveSamplesRow(input),
    notEnoughHistoryText: deriveNotEnoughHistoryText(input),
    message,
    launchDisabled: Boolean(input.runLimitsLoading) || (input.loading && labHasLimits) || message?.tone === 'block',
    launchAnyway: !input.serverBlockMessage && input.verdict?.outcome === 'warn',
  };
}
