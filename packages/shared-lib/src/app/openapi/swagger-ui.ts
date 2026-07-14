/**
 * Renders a self-contained Swagger UI page for the Easy Genomics OpenAPI spec.
 *
 * The handler imports the generated spec as a JSON module and passes it here. We
 * rewrite the placeholder `servers` entry to the live API base URL (so "Try it out"
 * targets the real backend) and embed the spec directly in the page. Swagger UI's
 * CSS/JS are loaded from a pinned jsDelivr CDN copy of `swagger-ui-dist` rather than
 * bundled into the Lambda.
 */

/** Pinned so the served UI is reproducible; bump deliberately. */
export const SWAGGER_UI_DIST_VERSION = '5.17.14';

const SWAGGER_UI_CSS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui.css`;
const SWAGGER_UI_BUNDLE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui-bundle.js`;

/**
 * Returns a copy of the spec with `servers` overridden so requests issued from the
 * UI hit the live API instead of the checked-in placeholder URL. Copies rather than
 * mutates because the imported JSON module is a shared, cached object.
 */
export function getApiSpec(spec: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  return { ...spec, servers: [{ url: baseUrl, description: 'Live API Gateway' }] };
}

/** Builds the full Swagger UI HTML document with the spec embedded inline. */
export function renderSwaggerHtml(spec: Record<string, unknown>, baseUrl: string): string {
  const embeddedSpec = JSON.stringify(getApiSpec(spec, baseUrl));
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
          spec: ${embeddedSpec},
          dom_id: '#swagger-ui',
        });
      };
    </script>
  </body>
</html>`;
}
