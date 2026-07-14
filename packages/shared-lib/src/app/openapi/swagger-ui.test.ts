import { getApiSpec, renderSwaggerHtml } from './swagger-ui';

const SAMPLE_SPEC = {
  openapi: '3.1.0',
  info: { title: 'Easy Genomics API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com', description: 'placeholder' }],
  paths: {
    '/easy-genomics/list-buckets': {
      get: { responses: { 200: { description: 'OK' } } },
    },
  },
};

const ASSETS = { css: '.swagger-ui { color: red; }', js: 'window.SwaggerUIBundle = function () {};' };
const BASE_URL = 'https://abc123.execute-api.us-east-1.amazonaws.com/quality';

test('getApiSpec overrides servers with the live base URL', () => {
  const spec = getApiSpec(SAMPLE_SPEC, BASE_URL);
  expect(spec.servers).toEqual([{ url: BASE_URL, description: 'Live API Gateway' }]);
});

test('getApiSpec does not mutate the source spec (imported JSON is cached)', () => {
  getApiSpec(SAMPLE_SPEC, BASE_URL);
  expect(SAMPLE_SPEC.servers).toEqual([{ url: 'https://api.example.com', description: 'placeholder' }]);
});

test('renderSwaggerHtml inlines the assets and never references an external origin', () => {
  const html = renderSwaggerHtml(SAMPLE_SPEC, BASE_URL, ASSETS);
  expect(html).toContain(ASSETS.css);
  expect(html).toContain(ASSETS.js);
  expect(html).toContain('SwaggerUIBundle(');
  // No external CDN / URL references — everything is self-hosted.
  expect(html).not.toContain('cdn.jsdelivr.net');
  expect(html).not.toMatch(/src="https?:\/\//);
  expect(html).not.toMatch(/href="https?:\/\//);
});

test('renderSwaggerHtml embeds the spec with the rewritten server URL', () => {
  const html = renderSwaggerHtml(SAMPLE_SPEC, BASE_URL, ASSETS);
  expect(html).toContain(BASE_URL);
  expect(html).not.toContain('https://api.example.com');
});

test('renderSwaggerHtml restricts "Try it out" to read-only methods', () => {
  const html = renderSwaggerHtml(SAMPLE_SPEC, BASE_URL, ASSETS);
  expect(html).toContain("supportedSubmitMethods: ['get', 'head']");
});

test('renderSwaggerHtml escapes closing tags in embedded assets to prevent breakout', () => {
  const html = renderSwaggerHtml(SAMPLE_SPEC, BASE_URL, {
    css: 'a{}</style><script>alert(1)</script>',
    js: 'console.log(1);</script><script>alert(2)</script>',
  });
  // The injected closing tags must be neutralised, not emitted verbatim.
  expect(html).not.toContain('</style><script>alert(1)');
  expect(html).not.toContain('</script><script>alert(2)');
});
