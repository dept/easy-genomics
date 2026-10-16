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

/**
 * `*` matches any characters inside this one segment. `?` is a literal character.
 * The scan is linear, so a long run of stars cannot backtrack.
 */
function matchPathSegment(pattern: string, value: string): boolean {
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let valueAtStar = 0;

  while (valueIndex < value.length) {
    if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
      starIndex = patternIndex;
      patternIndex += 1;
      valueAtStar = valueIndex;
      continue;
    }
    if (patternIndex < pattern.length && pattern[patternIndex] === value[valueIndex]) {
      patternIndex += 1;
      valueIndex += 1;
      continue;
    }
    if (starIndex === -1) return false;
    patternIndex = starIndex + 1;
    valueAtStar += 1;
    valueIndex = valueAtStar;
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
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
 * Tick `sampleA.consensus.fa` and this becomes `dir/*.consensus.fa`, even when
 * this run only has one sample — the sample id must not be stored or the next
 * run will miss. A unique report such as `multiqc_report.html` stays exact.
 * A folder path becomes `dir/*` so it matches the files in that location.
 */
type FilenameIndex = {
  filePaths: string[];
  fileSet: Set<string>;
  namesByDirectory: Map<string, string[]>;
};

function filenameIndex(allRelativePaths: string[]): FilenameIndex {
  const filePaths = allRelativePaths.filter((path) => path && !path.endsWith('/'));
  const namesByDirectory = new Map<string, string[]>();
  for (const path of filePaths) {
    const name = basenameRelative(path);
    if (!name) continue;
    const directory = dirnameRelative(path);
    const names = namesByDirectory.get(directory);
    if (names) names.push(name);
    else namesByDirectory.set(directory, [name]);
  }
  return { filePaths, fileSet: new Set(filePaths), namesByDirectory };
}

function inferFromIndex(relativePath: string, index: FilenameIndex): string {
  const cleaned = relativePath.replace(/\/+$/, '');
  if (!cleaned) return relativePath;

  if (isDirectoryPrefix(cleaned, index.fileSet, index.filePaths)) {
    return `${cleaned}/*`;
  }

  const directory = dirnameRelative(cleaned);
  const filename = basenameRelative(cleaned);
  if (!filename) return cleaned;

  const globName = inferFilenameGlob(filename, index.namesByDirectory.get(directory) ?? []);
  return directory ? `${directory}/${globName}` : globName;
}

export function inferKeyOutputPattern(relativePath: string, allRelativePaths: string[]): string {
  return inferFromIndex(relativePath, filenameIndex(allRelativePaths));
}

/**
 * Score a saved pattern against this run. A glob is kept. An exact directory
 * becomes `dir/*`. An exact file is widened the same way as ticking it, so a
 * sample id is not stored. A unique report such as `results/summary.html` stays exact.
 */
export function normalizeKeyOutputPattern(pattern: string, allRelativePaths: string[]): string {
  if (!pattern || pattern.includes('*')) return pattern;
  return inferKeyOutputPattern(pattern, allRelativePaths);
}

function isDirectoryPrefix(path: string, fileSet: Set<string>, filePaths: string[]): boolean {
  if (fileSet.has(path)) return false;
  const prefix = `${path}/`;
  return filePaths.some((filePath) => filePath.startsWith(prefix));
}

function inferFilenameGlob(filename: string, siblingNames: string[]): string {
  const suffixes = filenameTypeSuffixes(filename);
  let singleSampleFallback: string | null = null;

  for (const suffix of suffixes) {
    const prefix = filename.slice(0, filename.length - suffix.length);
    const matches = siblingNames.filter((name) => name.endsWith(suffix) && name.length > suffix.length);
    if (matches.length >= 2) {
      return `*${suffix}`;
    }
    if (!singleSampleFallback && matches.length >= 1 && looksLikeSamplePrefix(prefix)) {
      singleSampleFallback = `*${suffix}`;
    }
  }

  return singleSampleFallback ?? filename;
}

/**
 * Type suffixes, longest first: `_fastqc.html`, `.consensus.fa`, `.html`.
 * Underscore tool suffixes are preferred over a bare extension so one FastQC
 * file becomes `*_fastqc.html` rather than `ZRXXLL_R1_fastqc.html`.
 */
function filenameTypeSuffixes(filename: string): string[] {
  const suffixes: string[] = [];
  const lastUnderscore = filename.lastIndexOf('_');
  if (lastUnderscore > 0 && filename.indexOf('.', lastUnderscore) !== -1) {
    suffixes.push(filename.slice(lastUnderscore));
  }

  const parts = filename.split('.');
  if (parts.length >= 2) {
    for (let index = 1; index < parts.length; index += 1) {
      suffixes.push(`.${parts.slice(index).join('.')}`);
    }
  }

  return [...new Set(suffixes)].sort((left, right) => right.length - left.length);
}

function looksLikeSamplePrefix(prefix: string): boolean {
  if (!prefix) return false;
  if (/\d/.test(prefix)) return true;
  const letters = prefix.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase();
}

export function inferKeyOutputLabel(pattern: string): string {
  const filename = basenameRelative(pattern);
  if (filename === '*' || filename === '') {
    const folder = basenameRelative(dirnameRelative(pattern));
    return titleCaseRole(folder || 'Key output');
  }

  let stem = filename.startsWith('*') ? filename.slice(1) : filename;
  if (stem.startsWith('.') || stem.startsWith('_')) stem = stem.slice(1);
  const role = stem.includes('.') ? stem.slice(0, stem.indexOf('.')) : stem;
  return titleCaseRole(role);
}

function titleCaseRole(role: string): string {
  const words = role.replace(/[_-]+/g, ' ').trim();
  if (!words) return 'Key output';
  const labelled = words.replace(/\b\w/g, (character) => character.toUpperCase());
  return labelled.slice(0, WORKFLOW_KEY_OUTPUT_LABEL_MAX_LENGTH);
}

export function countKeyOutputMatches(pattern: string, allRelativePaths: string[]): number {
  return allRelativePaths.filter((path) => !path.endsWith('/') && matchKeyOutputPattern(pattern, path)).length;
}

export interface KeyOutputListedFile {
  Key: string;
  RelativePath: string;
  Size: number;
}

export interface KeyOutputExampleGroup {
  Pattern: string;
  Label: string;
  ExamplePath: string;
  Directory: string;
  Size: number;
  MatchCount: number;
}

export const WORKFLOW_KEY_OUTPUT_GROUPS_LIMIT = 200;

/** Files on a run that match one declared pattern, in listing order. */
export function listKeyOutputMatches(pattern: string, files: KeyOutputListedFile[]): KeyOutputListedFile[] {
  return files.filter((file) => matchKeyOutputPattern(pattern, file.RelativePath));
}

/**
 * Collapse every file on a run into one example per inferred role so the
 * declaring screen can tick a type, not 48 sample files.
 */
export function groupKeyOutputExamples(files: KeyOutputListedFile[]): KeyOutputExampleGroup[] {
  const index = filenameIndex(files.map((file) => file.RelativePath));
  const byPattern = new Map<string, KeyOutputListedFile[]>();

  for (const file of files) {
    const pattern = inferFromIndex(file.RelativePath, index).slice(0, WORKFLOW_KEY_OUTPUT_PATTERN_MAX_LENGTH);
    const matches = byPattern.get(pattern) ?? [];
    matches.push(file);
    byPattern.set(pattern, matches);
  }

  return [...byPattern.entries()]
    .map(([pattern, matches]) => {
      const example = matches[0];
      return {
        Pattern: pattern,
        Label: inferKeyOutputLabel(pattern),
        ExamplePath: example.RelativePath,
        Directory: dirnameRelative(example.RelativePath),
        Size: example.Size,
        MatchCount: matches.length,
      };
    })
    .sort((left, right) => {
      const directoryOrder = left.Directory.localeCompare(right.Directory);
      return directoryOrder !== 0 ? directoryOrder : left.ExamplePath.localeCompare(right.ExamplePath);
    })
    .slice(0, WORKFLOW_KEY_OUTPUT_GROUPS_LIMIT);
}

/**
 * Collapse selected files into unique inferred roles, most-specific first.
 * Files that share a glob become one row so 48 samples do not produce 48 entries.
 */
export function inferKeyOutputsFromSelection(
  selectedRelativePaths: string[],
  allRelativePaths: string[],
): InferredKeyOutputPattern[] {
  const uniqueSelected = [...new Set(selectedRelativePaths.map((path) => path.replace(/\/+$/, '')).filter(Boolean))];
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
  return drafts.map((draft) => {
    const pattern = normalizeKeyOutputPattern(draft.Pattern, allRelativePaths);
    return {
      Label: draft.Label,
      Pattern: pattern,
      ExamplePath: draft.ExamplePath,
      MatchCount: countKeyOutputMatches(pattern, allRelativePaths),
    };
  });
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
    if (pattern.includes('**')) {
      return { ok: false, error: '* matches inside one path segment. ** is not supported.' };
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
