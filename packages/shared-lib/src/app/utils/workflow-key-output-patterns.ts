import {
  WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH,
  WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH,
  type WorkflowKeyOutput,
} from '../types/easy-genomics/workflow-key-outputs';

export type KeyOutputPatternDraft = Pick<WorkflowKeyOutput, 'Label' | 'Pattern'> & {
  ExamplePath?: string;
};

export interface InferredKeyOutputPattern extends KeyOutputPatternDraft {
  MatchCount: number;
}

const JSON_OBJECT_WRAPPER = 'keyOutputs';

/** True when `pattern` matches `relativePath`. `*` matches within one path segment only. */
export function matchKeyOutputPattern(pattern: string, relativePath: string): boolean {
  if (!pattern || !relativePath) return false;
  const patternSegments = pattern.split('/');
  const pathSegments = relativePath.split('/');
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => matchPathSegment(segment, pathSegments[index]));
}

function matchPathSegment(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function dirnameRelative(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

export function basenameRelative(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? path : path.slice(separator + 1);
}

/**
 * Infer a glob from one selected file and the rest of the run's relative paths.
 *
 * Tick `sampleA.consensus.fa` next to 47 siblings and this becomes
 * `dir/*.consensus.fa`. A unique file such as `multiqc_report.html` stays exact.
 */
export function inferKeyOutputPattern(relativePath: string, allRelativePaths: string[]): string {
  const directory = dirnameRelative(relativePath);
  const filename = basenameRelative(relativePath);
  if (!filename) return relativePath;

  const siblingNames = allRelativePaths
    .filter((path) => !path.endsWith('/') && dirnameRelative(path) === directory)
    .map((path) => basenameRelative(path))
    .filter(Boolean);

  const globName = inferFilenameGlob(filename, siblingNames);
  return directory ? `${directory}/${globName}` : globName;
}

function inferFilenameGlob(filename: string, siblingNames: string[]): string {
  const parts = filename.split('.');
  if (parts.length < 2) return filename;

  for (let index = 1; index < parts.length; index += 1) {
    const suffix = `.${parts.slice(index).join('.')}`;
    const matches = siblingNames.filter((name) => name.endsWith(suffix) && name.length > suffix.length);
    if (matches.length >= 2) {
      return `*${suffix}`;
    }
  }

  return filename;
}

export function inferKeyOutputLabel(pattern: string): string {
  const filename = basenameRelative(pattern);
  const stem = filename.startsWith('*.') ? filename.slice(2) : filename;
  const role = stem.includes('.') ? stem.slice(0, stem.indexOf('.')) : stem;
  const words = role.replace(/[_-]+/g, ' ').trim();
  if (!words) return 'Key output';
  const labelled = words.replace(/\b\w/g, (character) => character.toUpperCase());
  return labelled.slice(0, WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH);
}

export function countKeyOutputMatches(pattern: string, allRelativePaths: string[]): number {
  return allRelativePaths.filter((path) => !path.endsWith('/') && matchKeyOutputPattern(pattern, path)).length;
}

/**
 * Collapse selected files into unique inferred roles, most-specific first.
 * Files that share a glob become one row so 48 samples do not produce 48 entries.
 */
export function inferKeyOutputsFromSelection(
  selectedRelativePaths: string[],
  allRelativePaths: string[],
): InferredKeyOutputPattern[] {
  const uniqueSelected = [...new Set(selectedRelativePaths.filter((path) => path && !path.endsWith('/')))];
  const byPattern = new Map<string, InferredKeyOutputPattern>();

  for (const relativePath of uniqueSelected) {
    const pattern = inferKeyOutputPattern(relativePath, allRelativePaths).slice(
      0,
      WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH,
    );
    if (byPattern.has(pattern)) continue;

    byPattern.set(pattern, {
      Label: inferKeyOutputLabel(pattern),
      Pattern: pattern,
      ExamplePath: relativePath,
      MatchCount: countKeyOutputMatches(pattern, allRelativePaths),
    });
  }

  return [...byPattern.values()];
}

export function scoreKeyOutputPatterns(
  drafts: KeyOutputPatternDraft[],
  allRelativePaths: string[],
): InferredKeyOutputPattern[] {
  return drafts.map((draft) => ({
    Label: draft.Label,
    Pattern: draft.Pattern,
    ExamplePath: draft.ExamplePath,
    MatchCount: countKeyOutputMatches(draft.Pattern, allRelativePaths),
  }));
}

export type ParseKeyOutputsJsonResult = { ok: true; outputs: KeyOutputPatternDraft[] } | { ok: false; error: string };

/**
 * Parse the JSON escape hatch. Accepts `{ "keyOutputs": [...] }` or a raw array
 * of `{ label, pattern }` objects.
 */
export function parseKeyOutputsJson(text: string): ParseKeyOutputsJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }

  const rows = extractJsonRows(parsed);
  if (!rows) {
    return {
      ok: false,
      error: `Use { "${JSON_OBJECT_WRAPPER}": [{ "label": "...", "pattern": "..." }] }.`,
    };
  }

  const outputs: KeyOutputPatternDraft[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: 'Each key output must be an object with label and pattern.' };
    }
    const record = row as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : '';
    if (!label || !pattern) {
      return { ok: false, error: 'Each key output needs a non-empty label and pattern.' };
    }
    if (label.length > WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH) {
      return { ok: false, error: `Labels must be ${WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH} characters or fewer.` };
    }
    if (pattern.length > WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH) {
      return { ok: false, error: `Patterns must be ${WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH} characters or fewer.` };
    }
    if (pattern.startsWith('/') || pattern.includes('//')) {
      return { ok: false, error: 'Patterns must be relative paths without a leading slash.' };
    }
    const examplePath = typeof record.examplePath === 'string' ? record.examplePath : undefined;
    outputs.push({ Label: label, Pattern: pattern, ExamplePath: examplePath });
  }

  return { ok: true, outputs };
}

function extractJsonRows(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && JSON_OBJECT_WRAPPER in parsed) {
    const rows = (parsed as Record<string, unknown>)[JSON_OBJECT_WRAPPER];
    return Array.isArray(rows) ? rows : null;
  }
  return null;
}

export function formatKeyOutputsJson(outputs: KeyOutputPatternDraft[]): string {
  return JSON.stringify(
    {
      [JSON_OBJECT_WRAPPER]: outputs.map((output) => ({
        label: output.Label,
        pattern: output.Pattern,
      })),
    },
    null,
    2,
  );
}
