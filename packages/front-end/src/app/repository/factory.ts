import { ErrorCodeKeys } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/errors';
import { useRuntimeConfig } from 'nuxt/app';
const { getToken, getRefreshedToken } = useAuth();

class HttpFactory {
  private baseApiUrl = useRuntimeConfig().public.BASE_API_URL;
  private defaultApiUrl = `${this.baseApiUrl}/easy-genomics`;
  private nfTowerApiUrl = `${this.baseApiUrl}/nf-tower`;
  private omicsApiUrl = `${this.baseApiUrl}/aws-healthomics`;

  private isRefreshingToken = false;
  private tokenRefreshPromise: Promise<string> | null = null;

  /**
   * Default API request handler
   */
  call<T>(method = 'GET', url: string, data: unknown = '', shouldRefresh: boolean = false): Promise<T | undefined> {
    return this.performRequest<T>(method, this.defaultApiUrl + url, data, shouldRefresh);
  }

  /**
   * NF Tower API request handler
   */
  callSeqera<T>(
    method = 'GET',
    url: string,
    data: unknown = '',
    shouldRefresh: boolean = false,
  ): Promise<T | undefined> {
    return this.performRequest<T>(method, this.nfTowerApiUrl + url, data, shouldRefresh);
  }

  /**
   * AWS HealthOmics API request handler
   */
  callOmics<T>(
    method = 'GET',
    url: string,
    data: unknown = '',
    shouldRefresh: boolean = false,
  ): Promise<T | undefined> {
    return this.performRequest<T>(method, this.omicsApiUrl + url, data, shouldRefresh);
  }

  /**
   * Call API with token and handle response errors
   * @param method
   * @param url
   * @param data
   * @param shouldRefresh
   * @returns Promise<T | undefined>
   */
  private async performRequest<T>(
    method: string,
    url: string,
    data: unknown = '',
    shouldRefresh: boolean,
  ): Promise<T | undefined> {
    try {
      const headers: HeadersInit = new Headers();
      headers.append('Content-Type', 'application/json');

      // TODO: Consider adding a custom JWT Authorizer to the Public API Gateway for Public APIs
      // The invite/reset password token will be passed as the Bearer token
      // A dedicated custom Lambda authorizer will be run by the API Gateway to validate the token
      // enabling single responsibility and separation of concerns.
      // Possibly further upsides as API Gateway may execute the authorizer for free or cheaply,
      // either way the Lambda resource allocation can be much lower than those that require more complex logic
      // and access to various services and large response payloads.
      let token: string | undefined;
      try {
        token = shouldRefresh ? await this.refreshToken() : await getToken();
      } catch (tokenError) {
        console.warn(`Failed to get token; reason: ${tokenError}; continuing without Bearer or X-API header`);
      }
      if (token) {
        headers.append('Authorization', `Bearer ${token}`);
      }

      const settings: RequestInit = { method, headers };
      if (data) {
        settings.body = JSON.stringify(data);
      }

      const response = await fetch(url, settings);
      if (!response.ok) {
        await this.handleResponseError(response);
      }

      if (shouldRefresh && token) {
        // Ensure permissions are reloaded before remounting the app
        await useUser().setCurrentUserDataFromToken();
        useUiStore().incrementRemountAppKey();
      }

      if (response.status === 204) {
        return undefined;
      }

      const jsonResponse = await response.json();
      return jsonResponse as T;
    } catch (error: any) {
      if (error.message === 'EG-110') {
        return this.performRequest(method, url, data, true);
      }
      throw new Error(`Request error: ${error.message}`);
    }
  }

  /**
   * Handle API response errors and refresh token if necessary
   * @param response
   */
  private async handleResponseError(response: Response): Promise<void> {
    let errorMessage = `HTTP error! status: ${response.status}`;
    let errorCode: ErrorCodeKeys | undefined;

    try {
      const errorBody: { Error: string; ErrorCode: ErrorCodeKeys } = await response.json();
      errorMessage = errorBody.Error || errorMessage;
      errorCode = errorBody.ErrorCode;
    } catch (error) {
      console.error('Error parsing response body', error);
    }

    if (errorCode === 'EG-110') {
      throw new Error('EG-110');
    } else {
      throw new Error(errorMessage);
    }
  }

  /**
   * Refresh the token if necessary
   * @returns Promise<string>
   */
  private refreshToken(): Promise<string> {
    if (this.isRefreshingToken) {
      return this.tokenRefreshPromise!;
    }

    this.isRefreshingToken = true;
    this.tokenRefreshPromise = getRefreshedToken().finally(() => {
      this.isRefreshingToken = false;
      this.tokenRefreshPromise = null;
    });

    return this.tokenRefreshPromise;
  }
}

export default HttpFactory;
