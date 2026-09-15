const MAX_RETRIES = 3;

function contentsApiPath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Fetches a JSON file via the GitHub Contents API (same path resolution as process-fetch-workflow-schema).
 */
export async function fetchGitHubSchemaJsonFile(
  owner: string,
  repo: string,
  filePath: string,
  token: string,
  gitRef: string | undefined,
  attempt = 0,
): Promise<object | null> {
  let apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${contentsApiPath(filePath)}`;
  if (gitRef) {
    apiUrl += `?ref=${encodeURIComponent(gitRef)}`;
  }
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'easy-genomics-schema-fetcher',
  };

  let response: Response;
  try {
    response = await fetch(apiUrl, { headers });
  } catch (networkError) {
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      return fetchGitHubSchemaJsonFile(owner, repo, filePath, token, gitRef, attempt + 1);
    }
    throw networkError;
  }

  if (response.status === 404) {
    return null;
  }

  if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    return fetchGitHubSchemaJsonFile(owner, repo, filePath, token, gitRef, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { content: string; encoding: string };
  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding from GitHub Contents API: ${data.encoding}`);
  }
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
}
