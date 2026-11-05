import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { MicroreactProject } from '@BE/utils/microreact-project';

export const MICROREACT_BASE_URL = 'https://microreact.org';
const REQUEST_TIMEOUT_MS = 60_000;

/** Client for the Microreact REST API. Projects belong to the account that owns the access token. */
export class MicroreactService {
  /** Creates a private project and returns its URL. */
  public createProject = async (project: MicroreactProject, accessToken: string): Promise<string> => {
    let response: Response;
    try {
      response = await fetch(`${MICROREACT_BASE_URL}/api/projects/create?access=private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Token': accessToken },
        body: JSON.stringify(project),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err: any) {
      throw new InvalidRequestError(`Could not reach Microreact: ${err?.message ?? err}`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new InvalidRequestError(
        'Microreact rejected the access token. Update it in the laboratory settings (Microreact > Account settings > API access token).',
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new InvalidRequestError(`Microreact returned HTTP ${response.status}: ${detail}`);
    }

    const body = (await response.json()) as { id?: string; url?: string };
    if (body.url) return body.url;
    if (body.id) return `${MICROREACT_BASE_URL}/project/${body.id}`;
    throw new InvalidRequestError('Microreact created the project but did not return its URL');
  };
}
