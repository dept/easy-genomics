/**
 * The following WorkflowRunPreset model represents a named, reusable set of AWS
 * HealthOmics workflow run parameters stored in the workflow-run-preset-table.
 *
 * Both personal and laboratory-shared presets live in the same table. The
 * LaboratoryId serves as the DynamoDB HashKey and the PresetKey serves as the
 * DynamoDB SortKey, where the sort key prefix separates the two tiers:
 *
 *   Personal:   USER#<UserId>#<WorkflowId>#<PresetId>
 *   Laboratory: LAB#<WorkflowId>#<PresetId>
 *
 * This keeps every preset a user can see within a single partition, so the run
 * form loads both tiers with two prefix queries and no secondary index.
 *
 * {
 *   LaboratoryId: <string>,
 *   PresetKey: <string>,
 *   PresetId: <string>,
 *   Scope: <'USER' | 'LAB'>,
 *   WorkflowId: <string>,
 *   Name: <string>,
 *   Params: <Record<string, string | number | boolean>>,
 *   CreatedAt?: <string>,
 *   CreatedBy?: <string>,
 *   CreatedByEmail?: <string>,
 *   ModifiedAt?: <string>,
 *   ModifiedBy?: <string>,
 * }
 */
import { BaseAttributes } from '../base-entity';

export const WORKFLOW_RUN_PRESET_SCOPES = ['USER', 'LAB'] as const;
export type WorkflowRunPresetScope = (typeof WORKFLOW_RUN_PRESET_SCOPES)[number];

/**
 * Maximum presets one owner may keep per workflow, applied independently to each
 * tier: a user may hold 20 personal presets for a workflow, and the laboratory a
 * further 20 shared ones. The cap is enforced server-side and is not shown in the UI.
 */
export const WORKFLOW_RUN_PRESET_LIMIT = 20;

export const WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH = 60;

/**
 * Run parameter values as rendered by the workflow parameter form. Nested objects
 * and arrays are intentionally unsupported — the HealthOmics parameter template is
 * a flat map of scalars.
 */
export type WorkflowRunPresetParams = Record<string, string | number | boolean>;

/**
 * Parameters that belong to one specific run and are never part of a preset.
 *
 * `input` and `outdir` are seeded from the S3 transaction path created for each
 * individual run (the generated sample sheet and its `/results` folder), and the
 * run name is likewise unique per run. Replaying a previous run's values would
 * point a new run at a stale sample sheet and write its results back over the
 * earlier run's output, so these are stripped on save rather than merely hidden.
 */
export const RUN_SPECIFIC_PARAM_NAMES: readonly string[] = ['input', 'output', 'outdir', 'runname', 'run_name'];

const RUN_SPECIFIC_PARAM_LOOKUP: ReadonlySet<string> = new Set(RUN_SPECIFIC_PARAM_NAMES);

export function isRunSpecificParam(name: string): boolean {
  return RUN_SPECIFIC_PARAM_LOOKUP.has(name.toLowerCase());
}

/** Removes the per-run parameters so a preset only ever carries reusable values. */
export function omitRunSpecificParams(params: WorkflowRunPresetParams): WorkflowRunPresetParams {
  return Object.fromEntries(Object.entries(params).filter(([name]) => !isRunSpecificParam(name)));
}

export interface WorkflowRunPreset extends BaseAttributes {
  LaboratoryId: string; // DynamoDB Partition Key (String)
  PresetKey: string; // DynamoDB Sort Key (String)
  PresetId: string;
  Scope: WorkflowRunPresetScope;
  WorkflowId: string;
  Name: string;
  Params: WorkflowRunPresetParams;
  /** Email of the creating user, denormalised so shared lab presets can show authorship without a user lookup. */
  CreatedByEmail?: string;
}

export interface ListWorkflowRunPresetsResponse {
  /** Presets owned by the calling user for this laboratory + workflow. */
  UserPresets: WorkflowRunPreset[];
  /** Presets shared with the whole laboratory for this workflow. */
  LabPresets: WorkflowRunPreset[];
}
