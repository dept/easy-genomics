import type { LaboratoryDataTag } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';
import { levenshtein } from '@FE/utils/levenshtein';

export interface SheetTagMatchInput {
  /** Parsed sheet INCLUDING the header row at index 0. */
  rows: string[][];
  nameColumnIndex: number;
  tagColumnIndex: number;
  /** Proposed sample names (ProposedSample.sampleId from the wizard). */
  sampleNames: string[];
  existingTags: LaboratoryDataTag[];
  /** Max edit distance for a "did you mean" typo warning. Default 2. */
  typoDistance?: number;
}

export interface TagAggregate {
  name: string;
  sampleCount: number;
}

export interface RejectedTag {
  name: string;
  reason: string;
}

export interface TypoWarning {
  name: string;
  nearest: string;
  distance: number;
}

export interface SheetTagMatchResult {
  /** sampleName -> ordered, unique tag names to apply (excludes rejected tags). */
  perSample: Record<string, string[]>;
  tagsToCreate: TagAggregate[];
  existingTagHits: TagAggregate[];
  rejected: RejectedTag[];
  typoWarnings: TypoWarning[];
  unmatchedRows: Array<{ rowNumber: number; name: string }>;
  unmatchedSampleNames: string[];
}

const normalize = (value: string): string => value.trim().toLowerCase();

/** Split a tag cell into trimmed, de-duplicated names (case-insensitive dedupe, first casing wins). */
export function parseTagCell(cell: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of cell.split(',')) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function matchSheetToSamples(input: SheetTagMatchInput): SheetTagMatchResult {
  const { rows, nameColumnIndex, tagColumnIndex, sampleNames, existingTags } = input;
  const typoDistance = input.typoDistance ?? 2;

  const sampleByKey = new Map<string, string>();
  for (const name of sampleNames) sampleByKey.set(normalize(name), name);

  const existingByKey = new Map<string, LaboratoryDataTag>();
  for (const t of existingTags) existingByKey.set(normalize(t.Name), t);
  const existingNames = existingTags.map((t) => t.Name);

  const perSample: Record<string, string[]> = {};
  const perSampleSeen: Record<string, Set<string>> = {};
  const matchedSampleKeys = new Set<string>();
  const unmatchedRows: Array<{ rowNumber: number; name: string }> = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2; // 1-based, +1 for the header row
    const rawName = row[nameColumnIndex] ?? '';
    const nameKey = normalize(rawName);
    const tagNames = parseTagCell(row[tagColumnIndex] ?? '');

    if (!nameKey || !sampleByKey.has(nameKey)) {
      unmatchedRows.push({ rowNumber, name: rawName.trim() });
      return;
    }
    matchedSampleKeys.add(nameKey);
    const sampleName = sampleByKey.get(nameKey)!;
    if (!perSample[sampleName]) {
      perSample[sampleName] = [];
      perSampleSeen[sampleName] = new Set<string>();
    }
    for (const tagName of tagNames) {
      const key = tagName.toLowerCase();
      if (perSampleSeen[sampleName].has(key)) continue;
      perSampleSeen[sampleName].add(key);
      perSample[sampleName].push(tagName);
    }
  });

  // Aggregate tag usage across matched samples (insertion order = first appearance).
  const usageByKey = new Map<string, { name: string; count: number }>();
  for (const tagNames of Object.values(perSample)) {
    for (const tagName of tagNames) {
      const key = tagName.toLowerCase();
      const entry = usageByKey.get(key);
      if (entry) entry.count += 1;
      else usageByKey.set(key, { name: tagName, count: 1 });
    }
  }

  const tagsToCreate: TagAggregate[] = [];
  const existingTagHits: TagAggregate[] = [];
  const rejected: RejectedTag[] = [];
  const typoWarnings: TypoWarning[] = [];
  const rejectedKeys = new Set<string>();

  for (const [key, { name, count }] of usageByKey) {
    const existing = existingByKey.get(key);
    if (existing) {
      if (existing.Kind === 'workflow') {
        rejected.push({ name, reason: 'Workflow tags are auto-managed and cannot be applied' });
        rejectedKeys.add(key);
      } else if (existing.Kind === 'batch') {
        rejected.push({ name, reason: 'Batch tags are not supported on samples' });
        rejectedKeys.add(key);
      } else if (existing.Kind === 'permanent') {
        rejected.push({ name, reason: 'Permanent tags are system-managed and cannot be applied' });
        rejectedKeys.add(key);
      } else {
        existingTagHits.push({ name: existing.Name, sampleCount: count });
      }
      continue;
    }
    tagsToCreate.push({ name, sampleCount: count });
    let nearest = '';
    let best = Infinity;
    for (const existingName of existingNames) {
      const distance = levenshtein(key, normalize(existingName));
      if (distance > 0 && distance < best) {
        best = distance;
        nearest = existingName;
      }
    }
    if (nearest && best <= typoDistance) {
      typoWarnings.push({ name, nearest, distance: best });
    }
  }

  if (rejectedKeys.size) {
    for (const sampleName of Object.keys(perSample)) {
      perSample[sampleName] = perSample[sampleName].filter((n) => !rejectedKeys.has(n.toLowerCase()));
      if (!perSample[sampleName].length) delete perSample[sampleName];
    }
  }

  const unmatchedSampleNames = sampleNames.filter((n) => !matchedSampleKeys.has(normalize(n)));

  return { perSample, tagsToCreate, existingTagHits, rejected, typoWarnings, unmatchedRows, unmatchedSampleNames };
}
