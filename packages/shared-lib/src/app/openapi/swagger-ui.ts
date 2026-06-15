/**
 * Renders a self-contained Swagger UI page for the Easy Genomics OpenAPI spec.
 *
 * The handler bundles `easy-genomics-api.yaml` as text and passes it here. We parse
 * it, rewrite the placeholder `servers` entry to the live API Gateway URL (so
 * "Try it out" targets the real backend), and embed the spec directly in the page.
 * Swagger UI's CSS/JS are loaded from a pinned jsDelivr CDN copy of `swagger-ui-dist`
 * rather than bundled into the Lambda.
 */
import yaml from 'js-yaml';

/** Pinned so the served UI is reproducible; bump deliberately. */
export const SWAGGER_UI_DIST_VERSION = '5.17.14';

const SWAGGER_UI_CSS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui.css`;
const SWAGGER_UI_BUNDLE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui-bundle.js`;

/**
 * Parses the OpenAPI YAML and overrides `servers` so requests issued from the UI
 * hit the live API Gateway instead of the checked-in placeholder URL.
 */
export function getApiSpec(yamlText: string, baseUrl: string): Record<string, unknown> {
  const spec = yaml.load(yamlText) as Record<string, unknown>;
  spec.servers = [{ url: baseUrl, description: 'Live API Gateway' }];
  return spec;
}

/** Builds the full Swagger UI HTML document with the spec embedded inline. */
export function renderSwaggerHtml(yamlText: string, baseUrl: string): string {
  const spec = JSON.stringify(getApiSpec(yamlText, baseUrl));
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Easy Genomics API</title>
    <link rel="stylesheet" href="${SWAGGER_UI_CSS}" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI_BUNDLE}" crossorigin></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          spec: ${spec},
          dom_id: '#swagger-ui',
        });
      };
    </script>
  </body>
</html>`;
}
