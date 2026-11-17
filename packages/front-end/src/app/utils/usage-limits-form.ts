import type { UpdateLaboratoryRunLimits } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';

export type RunLimitField = 'CostWarnAboveUsd' | 'CostBlockAboveUsd' | 'SamplesWarnAbove' | 'SamplesBlockAbove';

export const RUN_LIMIT_FIELDS: RunLimitField[] = [
  'CostWarnAboveUsd',
  'CostBlockAboveUsd',
  'SamplesWarnAbove',
  'SamplesBlockAbove',
];

/** What the four inputs of a lab row hold while it is being edited. */
export type RunLimitsDraft = Record<RunLimitField, string>;

export interface RunLimitsDraftError {
  field: RunLimitField;
  message: string;
}

export const COST_BLOCK_NOT_ABOVE_WARN = 'The cost block amount needs to be higher than the warn amount.';
export const SAMPLES_BLOCK_NOT_ABOVE_WARN = 'The samples block amount needs to be higher than the warn amount.';
export const AMOUNT_NOT_POSITIVE = 'Amounts need to be more than 0.';
export const SAMPLES_NOT_WHOLE = 'Sample amounts need to be whole numbers.';

const NOT_SET = 'Not set';
const SAMPLE_FIELDS: RunLimitField[] = ['SamplesWarnAbove', 'SamplesBlockAbove'];

export function runLimitsToDraft(limits: UpdateLaboratoryRunLimits | undefined): RunLimitsDraft {
  const draft = {} as RunLimitsDraft;
  for (const field of RUN_LIMIT_FIELDS) {
    const value = limits?.[field];
    draft[field] = value === undefined ? '' : String(value);
  }
  return draft;
}

/**
 * Blank fields are omitted rather than sent as 0 or null: the server clears every
 * field missing from the body. Call only when runLimitsDraftError returns null.
 */
export function draftToRunLimits(draft: RunLimitsDraft): UpdateLaboratoryRunLimits {
  const limits: UpdateLaboratoryRunLimits = {};
  for (const field of RUN_LIMIT_FIELDS) {
    const trimmed = draft[field].trim();
    if (trimmed !== '') {
      limits[field] = Number(trimmed);
    }
  }
  return limits;
}

function parsedAmount(draft: RunLimitsDraft, field: RunLimitField): number | undefined {
  const trimmed = draft[field].trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

function blockNotAboveWarn(warn: number | undefined, block: number | undefined): boolean {
  return warn !== undefined && block !== undefined && block <= warn;
}

/** Browser-side check for a quick message; the server stays authoritative. */
export function runLimitsDraftError(draft: RunLimitsDraft): RunLimitsDraftError | null {
  for (const field of RUN_LIMIT_FIELDS) {
    const amount = parsedAmount(draft, field);
    if (amount === undefined) continue;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { field, message: AMOUNT_NOT_POSITIVE };
    }
    if (SAMPLE_FIELDS.includes(field) && !Number.isInteger(amount)) {
      return { field, message: SAMPLES_NOT_WHOLE };
    }
  }

  if (blockNotAboveWarn(parsedAmount(draft, 'CostWarnAboveUsd'), parsedAmount(draft, 'CostBlockAboveUsd'))) {
    return { field: 'CostBlockAboveUsd', message: COST_BLOCK_NOT_ABOVE_WARN };
  }
  if (blockNotAboveWarn(parsedAmount(draft, 'SamplesWarnAbove'), parsedAmount(draft, 'SamplesBlockAbove'))) {
    return { field: 'SamplesBlockAbove', message: SAMPLES_BLOCK_NOT_ABOVE_WARN };
  }
  return null;
}

export function formatRunLimit(value: number | undefined, kind: 'usd' | 'count'): string {
  if (value === undefined) return NOT_SET;
  const amount = value.toLocaleString('en-US');
  return kind === 'usd' ? `US$${amount}` : amount;
}

export function usageLimitsNote(editingLabName: string | null, error: RunLimitsDraftError | null): string {
  if (error) return error.message;
  if (editingLabName !== null) return `Editing ${editingLabName}. Leave an amount blank to skip it.`;
  return 'Runs already going are never stopped by a change here.';
}
