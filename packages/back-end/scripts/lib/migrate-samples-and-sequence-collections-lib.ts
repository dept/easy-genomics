export const SK_REPLACEMENTS: Array<[string, string]> = [
  ['SEQUENCE_SET#', 'SAMPLE#'],
  ['SEQSETFILE#', 'SAMPLEFILE#'],
  ['DATA_COLLECTION#', 'SEQUENCE_COLLECTION#'],
  ['DCSET#', 'SCSET#'],
  ['SEQSET#', 'SAMPLE#'],
  ['#SEQSET#', '#SAMPLE#'],
  ['#DC#', '#SC#'],
];

export const ATTR_RENAMES: Record<string, string> = {
  SequenceSetId: 'SampleId',
  SequenceSetIds: 'SampleIds',
  DataCollectionId: 'SequenceCollectionId',
  SequenceSetCount: 'SampleCount',
};

export function migrateSk(sk: string): string {
  let out = sk;
  for (const [from, to] of SK_REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

export function migrateGsi1Pk(pk: string | undefined): string | undefined {
  if (!pk) return pk;
  return migrateSk(pk);
}

export function migrateItem(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  if (typeof out.Sk === 'string') out.Sk = migrateSk(out.Sk);
  if (typeof out.Gsi1Pk === 'string') out.Gsi1Pk = migrateGsi1Pk(out.Gsi1Pk);
  if (typeof out.Gsi1Sk === 'string') out.Gsi1Sk = migrateSk(out.Gsi1Sk as string);
  for (const [from, to] of Object.entries(ATTR_RENAMES)) {
    if (from in out) {
      out[to] = out[from];
      delete out[from];
    }
  }
  return out;
}

export function needsMigration(item: Record<string, unknown>): boolean {
  const sk = String(item.Sk ?? '');
  if (SK_REPLACEMENTS.some(([from]) => sk.includes(from))) return true;
  const gsi1Sk = item.Gsi1Sk;
  if (typeof gsi1Sk === 'string' && SK_REPLACEMENTS.some(([from]) => gsi1Sk.includes(from))) return true;
  return Object.keys(ATTR_RENAMES).some((k) => k in item);
}
