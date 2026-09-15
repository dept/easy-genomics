/** HealthOmics workflow tag storing an optional GitHub blob/raw URL to the schema JSON file. */
export const GITHUB_SCHEMA_URL_TAG = 'github-schema-url';

/**
 * Parses a GitHub URL that points at a single file (JSON schema), for use with the
 * GitHub Contents API (owner/repo/path + ref).
 *
 * Supported:
 * - Blob: https://github.com/{owner}/{repo}/blob/{ref}/path/to/schema.json
 * - Raw:  https://raw.githubusercontent.com/{owner}/{repo}/{ref}/path/to/schema.json
 *
 * The ref segment must be a single path segment (e.g. main, master, v1.0.0).
 */
export type ParsedGitHubSchemaFileLocation = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
};

export function parseGitHubSchemaFileUrl(url: string): ParsedGitHubSchemaFileLocation | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.hostname === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const blobIndex = parts.indexOf('blob');
      if (blobIndex >= 2 && blobIndex + 2 < parts.length) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/, '');
        const ref = parts[blobIndex + 1];
        const path = parts.slice(blobIndex + 2).join('/');
        return { owner, repo, ref, path };
      }
    }
    if (u.hostname === 'raw.githubusercontent.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 4) {
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/, '');
        const ref = parts[2];
        const path = parts.slice(3).join('/');
        return { owner, repo, ref, path };
      }
    }
  } catch {
    return null;
  }
  return null;
}
