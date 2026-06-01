/** Merge new S3 keys into an existing list without duplicates. */
export function mergeInputFileKeys(existing: string[], toAdd: string[]): string[] {
  const set = new Set(existing);
  for (const key of toAdd) {
    set.add(key);
  }
  return [...set];
}

export function removeInputFileKeys(existing: string[], toRemove: string[]): string[] {
  const remove = new Set(toRemove);
  return existing.filter((k) => !remove.has(k));
}
