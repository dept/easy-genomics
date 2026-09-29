/**
 * Cognito writes callback/logout URLs into the generated .env as a
 * comma-separated string. Amplify v6 requires string[].
 */
export function toUrlList(urls: string | undefined): string[] {
  return (urls ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}
