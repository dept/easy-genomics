import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { MicroreactService } from '../../../src/app/services/microreact-service';
import { MicroreactProject } from '../../../src/app/utils/microreact-project';

const project = { schema: 'https://microreact.org/schema/v1.json', meta: { name: 'run' } } as MicroreactProject;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MicroreactService.createProject', () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('creates a private project with the access token and returns its URL', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { id: 'abc123', url: 'https://microreact.org/project/abc123' }));

    const url = await new MicroreactService().createProject(project, 'token-1');

    expect(url).toBe('https://microreact.org/project/abc123');
    const [requestUrl, init] = mockFetch.mock.calls[0];
    expect(requestUrl).toBe('https://microreact.org/api/projects/create?access=private');
    expect(init.method).toBe('POST');
    expect(init.headers['Access-Token']).toBe('token-1');
    expect(JSON.parse(init.body)).toEqual(project);
  });

  it('builds the project URL from the id when the response has no url', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { id: 'abc123' }));

    await expect(new MicroreactService().createProject(project, 'token-1')).resolves.toBe(
      'https://microreact.org/project/abc123',
    );
  });

  it('explains a rejected access token', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await expect(new MicroreactService().createProject(project, 'bad')).rejects.toThrow(
      'Microreact rejected the access token',
    );
  });

  it('includes the status and body of any other failure', async () => {
    mockFetch.mockImplementation(async () => new Response('schema validation failed', { status: 400 }));

    await expect(new MicroreactService().createProject(project, 'token-1')).rejects.toThrow(InvalidRequestError);
    await expect(new MicroreactService().createProject(project, 'token-1')).rejects.toThrow(
      'Microreact returned HTTP 400: schema validation failed',
    );
  });

  it('reports a network failure', async () => {
    mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND microreact.org'));

    await expect(new MicroreactService().createProject(project, 'token-1')).rejects.toThrow(
      'Could not reach Microreact: getaddrinfo ENOTFOUND microreact.org',
    );
  });
});
