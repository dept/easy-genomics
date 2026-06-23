import { getApiSpec, renderSwaggerHtml, SWAGGER_UI_DIST_VERSION } from './swagger-ui';

const SAMPLE_YAML = `
openapi: 3.1.0
info:
  title: Easy Genomics API
  version: 1.0.0
servers:
  - url: https://api.example.com
    description: placeholder
paths:
  /easy-genomics/list-buckets:
    get:
      responses:
        '200':
          description: OK
`;

const BASE_URL = 'https://abc123.execute-api.us-east-1.amazonaws.com/quality';

test('getApiSpec overrides servers with the live base URL', () => {
  const spec = getApiSpec(SAMPLE_YAML, BASE_URL);
  expect(spec.servers).toEqual([{ url: BASE_URL, description: 'Live API Gateway' }]);
});

test('getApiSpec preserves the parsed paths', () => {
  const spec = getApiSpec(SAMPLE_YAML, BASE_URL) as { paths: Record<string, unknown> };
  expect(Object.keys(spec.paths)).toContain('/easy-genomics/list-buckets');
});

test('renderSwaggerHtml embeds the spec and loads pinned CDN assets', () => {
  const html = renderSwaggerHtml(SAMPLE_YAML, BASE_URL);
  expect(html).toContain(`swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui.css`);
  expect(html).toContain(`swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui-bundle.js`);
  expect(html).toContain('SwaggerUIBundle(');
  // Spec is embedded inline with the rewritten server URL.
  expect(html).toContain(BASE_URL);
  expect(html).not.toContain('https://api.example.com');
});
