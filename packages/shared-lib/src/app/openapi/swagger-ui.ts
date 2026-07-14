/**
 * Renders a self-contained Swagger UI page for the Easy Genomics OpenAPI spec.
 *
 * The handler passes in the parsed spec plus the Swagger UI CSS/JS read from the
 * bundled `swagger-ui-dist` package. Everything is inlined into a single HTML
 * document — no external CDN — so the page works on locked-down networks and
 * carries no third-party runtime/supply-chain dependency. The paired
 * Content-Security-Policy (set by the handler) forbids any external source.
 */

/** Swagger UI assets read from the bundled `swagger-ui-dist` package. */
export interface SwaggerUiAssets {
  css: string;
  js: string;
}

/**
 * Returns a copy of the spec with `servers` overridden so requests issued from the
 * UI hit the live API instead of the checked-in placeholder URL. Copies rather than
 * mutates because the imported JSON module is a shared, cached object.
 */
export function getApiSpec(spec: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  return { ...spec, servers: [{ url: baseUrl, description: 'Live API Gateway' }] };
}

/** Escapes a string so it can't break out of the <script>/<style> element it is embedded in. */
function forInlineElement(value: string): string {
  return value.replace(/<\/(script|style)/gi, '<\\/$1');
}

/** Escapes JSON for safe embedding inside a <script> element. */
function forInlineJson(value: string): string {
  return value.replace(/</g, '\\u003c');
}

/**
 * Builds the full Swagger UI HTML document with the spec and assets embedded inline.
 * "Try it out" is restricted to read-only methods so the docs page cannot trigger
 * mutating calls against the live backend.
 */
export function renderSwaggerHtml(spec: Record<string, unknown>, baseUrl: string, assets: SwaggerUiAssets): string {
  const embeddedSpec = forInlineJson(JSON.stringify(getApiSpec(spec, baseUrl)));
  const css = forInlineElement(assets.css);
  const js = forInlineElement(assets.js);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Easy Genomics API</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script>${js}</script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          spec: ${embeddedSpec},
          dom_id: '#swagger-ui',
          supportedSubmitMethods: ['get', 'head'],
          validatorUrl: null,
        });
      };
    </script>
  </body>
</html>`;
}
