import { APIGatewayProxyEvent } from 'aws-lambda/trigger/api-gateway-proxy';

export const enum REST_API_METHOD {
  // CRUD operations
  POST = 'POST',
  GET = 'GET',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export type AwsHealthOmicsQueryParameters = {
  name?: string;
  status?: string;
  startingToken?: string;
  maxResults?: number;
};

/**
 * Helper utility function to perform HTTP REST API requests and return the
 * expected JSON response object type.
 * @param url
 * @param method
 * @param headers
 * @param body
 */
export async function httpRequest<T>(
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: object | {},
): Promise<T> {
  try {
    const requestHeaders: Record<string, string> = {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...headers,
    };

    const request: RequestInit = {
      method: method,
      headers: requestHeaders,
      ...(method === REST_API_METHOD.POST || method === REST_API_METHOD.PUT || method === REST_API_METHOD.PATCH
        ? { body: JSON.stringify(body) }
        : {}),
      ...(requestHeaders['Content-Type'] === 'application/octet-stream' ? { responseType: 'arraybuffer' } : {}),
    };

    const response = await fetch(url, request);
    switch (response.status) {
      case 200:
        if (requestHeaders['Content-Type'] === 'application/octet-stream') {
          const data: ArrayBuffer = await response.arrayBuffer();
          return <T>data;
        } else {
          return await response.json().then((data) => <T>data);
        }
      case 204: // No Content
        return <T>{};
      default:
        throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }
  } catch (error: any) {
    console.error(error.message);
    throw error;
  }
}

/**
 * Helper utility function to set the NextFlow Tower API query parameters.
 * @param event
 * @param workspaceId
 */
export function getNextFlowApiQueryParameters(event?: APIGatewayProxyEvent, workspaceId?: string): string {
  const apiQueryParameters: URLSearchParams = new URLSearchParams();

  const max: string | undefined = event?.queryStringParameters?.max;
  if (max && parseInt(max) > 0) {
    apiQueryParameters.set('max', max);
  }
  const offset: string | undefined = event?.queryStringParameters?.offset;
  if (offset && parseInt(offset) > 0) {
    apiQueryParameters.set('offset', offset);
  }
  const search: string | undefined = event?.queryStringParameters?.search;
  if (search) {
    apiQueryParameters.set('search', search);
  }

  if (workspaceId) {
    apiQueryParameters.set('workspaceId', workspaceId);
  }

  return apiQueryParameters.toString();
}

/**
 * Helper utility function to set the AWS HealthOmics query parameters.
 * @param event
 */
export function getAwsHealthOmicsApiQueryParameters(event: APIGatewayProxyEvent): AwsHealthOmicsQueryParameters {
  const apiQueryParameters: AwsHealthOmicsQueryParameters = {};

  const name: string | undefined = event.queryStringParameters?.name || undefined;
  const maxResults: string | undefined = event.queryStringParameters?.maxResults || undefined;
  const nextToken: string | undefined = event.queryStringParameters?.nextToken || undefined;
  const status: string | undefined = event.queryStringParameters?.status || undefined;

  if (name) {
    apiQueryParameters.name = name;
  }

  if (status) {
    apiQueryParameters.status = status;
  }

  if (maxResults && parseInt(maxResults) > 0) {
    apiQueryParameters.maxResults = parseInt(maxResults);

    if (nextToken) {
      apiQueryParameters.startingToken = nextToken;
    }
  }

  return apiQueryParameters;
}

/**
 * Helper function to return valid query parameters that exist in the object's properties.
 * @param objectProperties
 * @param queryParameters
 */
export function getFilters(objectProperties: string[], queryParameters: [string, string][]): [string, string][] {
  return queryParameters.filter((_: [string, string]) => objectProperties.includes(_[0]));
}

/**
 * Helper recursive function to apply filters object records by the supplied filters.
 * @param results
 * @param filters
 */
export function getFilterResults<T>(results: T[], filters: [string, string][]): T[] {
  if (filters.length === 0) {
    return results;
  }

  const [filterKey, filterVal] = filters.shift();
  const filterResults = results.filter((r: T) => {
    // https://stackoverflow.com/a/3561711 - this escape function is the same as this answer EXCEPT the * is removed
    const regexEscapedInput = filterVal.replaceAll(/[/\-\\^$+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp('^' + regexEscapedInput.replaceAll('*', '.*') + '$');

    return regex.test(r[filterKey]);
  });

  // Recursion
  return getFilterResults<T>(filterResults, filters);
}
