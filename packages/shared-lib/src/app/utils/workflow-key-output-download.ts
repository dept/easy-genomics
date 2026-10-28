export function uniqueKeyOutputObjectKeys(roles: Array<{ Matches: Array<{ Key: string }> }>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const role of roles) {
    for (const file of role.Matches) {
      if (seen.has(file.Key)) continue;
      seen.add(file.Key);
      keys.push(file.Key);
    }
  }
  return keys;
}

export function isKeyOutputRoleTruncated(role: { MatchCount: number; Matches: readonly unknown[] }): boolean {
  return role.MatchCount > role.Matches.length;
}

export function canZipAllKeyOutputs(
  roles: Array<{ MatchCount: number; Matches: Array<{ Key: string }> }>,
  limit: number,
): boolean {
  if (roles.some((role) => isKeyOutputRoleTruncated(role))) return false;
  return uniqueKeyOutputObjectKeys(roles).length <= limit;
}
