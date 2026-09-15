/**
 * Pure (CDK-free) transforms that turn the committed, AWS-neutral OpenAPI spec
 * into an API-Gateway-ready definition for `SpecRestApiConstruct`.
 *
 * Keeping these functions free of CDK constructs makes them unit-testable
 * without synthesizing a stack, and keeps the committed `easy-genomics-api.yaml`
 * clean: every AWS-specific extension (Lambda integration, Cognito authorizer,
 * CORS preflight) is injected here at synth time, never written to the file.
 */

// Cors.ALL_METHODS — replicated so the generated CORS preflight matches the
// behaviour of the previous `defaultCorsPreflightOptions` on the imperative API.
export const CORS_ALLOW_METHODS = 'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD';

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'];
const RESOURCE_ID_SUFFIX = '/{id}';

export interface EnrichSpecOptions {
  /** Only paths starting with one of these prefixes are served by this API (e.g. ['/easy-genomics']). */
  includePathPrefixes: string[];
  /**
   * Resolves a Lambda invoke ARN (a CDK token) for a route endpoint key (the
   * spec path with any trailing `/{id}` removed). Returns undefined when no
   * Lambda backs the route — which is treated as a fatal spec/runtime mismatch.
   */
  resolveLambdaArn: (endpointKey: string) => string | undefined;
  /** Cognito user pool ARN(s) (CDK tokens) wired into the authorizer. */
  cognitoProviderArns: string[];
  /** AWS region token (e.g. `Stack.of(this).region`). Never hardcode. */
  region: string;
  /** AWS partition token (e.g. `Stack.of(this).partition`). Never hardcode. */
  partition: string;
  /** CORS allowed headers, joined into the mock OPTIONS response. */
  corsAllowHeaders: string[];
  /** Security scheme to convert into a Cognito authorizer (default 'cognitoJwt'). */
  authorizerSchemeName?: string;
}

export interface EnrichSpecResult {
  /** The enriched OpenAPI document, ready for `ApiDefinition.fromInline`. */
  document: Record<string, any>;
  /** Endpoint keys (path minus `/{id}`) that were wired to a Lambda integration. */
  usedEndpoints: string[];
}

/** Builds the API Gateway Lambda-proxy invoke URI. Region/partition stay tokens. */
export function lambdaInvokeUri(partition: string, region: string, functionArn: string): string {
  return `arn:${partition}:apigateway:${region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
}

/** Strips a trailing `/{id}` so a spec path maps to its LambdaConstruct endpoint key. */
export function endpointKeyForPath(routePath: string): string {
  return routePath.endsWith(RESOURCE_ID_SUFFIX) ? routePath.slice(0, -RESOURCE_ID_SUFFIX.length) : routePath;
}

/**
 * Injects API Gateway extensions into a copy of the spec:
 *  - converts the bearer security scheme into a Cognito User Pools authorizer,
 *  - adds an `aws_proxy` Lambda integration to every operation in scope,
 *  - adds a mock CORS preflight `OPTIONS` to every in-scope path,
 *  - drops paths owned by the other API (by prefix).
 *
 * Throws when any in-scope operation has no backing Lambda — this is what turns
 * a typo in the spec (or a renamed/removed controller) into a synth-time failure
 * instead of a runtime 500.
 */
export function enrichSpecForApiGateway(spec: Record<string, any>, opts: EnrichSpecOptions): EnrichSpecResult {
  const schemeName = opts.authorizerSchemeName ?? 'cognitoJwt';
  // Deep clone — the spec contains only strings/objects (CDK tokens are strings),
  // so structured cloning via JSON is safe and keeps the source file untouched.
  const document: Record<string, any> = JSON.parse(JSON.stringify(spec));

  // API Gateway's OpenAPI importer supports 3.0.x, but the committed spec is
  // 3.1.0 and uses 3.1 union-type syntax (`type: [T, 'null']`). These schemas are
  // inert for AWS_PROXY integrations without request validators, but the importer
  // still parses the document, so downgrade it to valid 3.0 to avoid a deploy-time
  // rejection. Runtime behaviour is unchanged.
  downgradeToOpenApi30(document);

  const schemes = document.components?.securitySchemes;
  if (!schemes || !schemes[schemeName]) {
    throw new Error(
      `enrichSpecForApiGateway: security scheme "${schemeName}" not found in spec.components.securitySchemes. ` +
        'The committed spec must declare it for the Cognito authorizer injection to attach.',
    );
  }
  schemes[schemeName] = {
    'type': 'apiKey',
    'name': 'Authorization',
    'in': 'header',
    'x-amazon-apigateway-authtype': 'cognito_user_pools',
    'x-amazon-apigateway-authorizer': {
      type: 'cognito_user_pools',
      providerARNs: opts.cognitoProviderArns,
    },
  };

  // API Gateway's REST OpenAPI importer is not guaranteed to apply a root-level
  // `security` as a per-operation default. Resolve it onto each in-scope
  // operation so the Cognito authorizer attaches per method. Operations that
  // declare their own `security` (e.g. `security: []` for public routes) win.
  const defaultSecurity = document.security ?? [{ [schemeName]: [] }];

  const allPaths: Record<string, any> = document.paths ?? {};
  const keptPaths: Record<string, any> = {};
  const usedEndpoints: string[] = [];
  const missing: string[] = [];

  for (const routePath of Object.keys(allPaths)) {
    if (!opts.includePathPrefixes.some((prefix) => routePath.startsWith(prefix))) {
      continue; // Owned by the other API Gateway.
    }
    const pathItem = allPaths[routePath];
    const endpointKey = endpointKeyForPath(routePath);

    for (const method of Object.keys(pathItem)) {
      const lower = method.toLowerCase();
      if (!HTTP_METHODS.includes(lower) || lower === 'options') {
        continue; // OPTIONS is generated below; skip non-operation keys.
      }
      const functionArn = opts.resolveLambdaArn(endpointKey);
      if (!functionArn) {
        missing.push(`${method.toUpperCase()} ${routePath}`);
        continue;
      }
      pathItem[method]['x-amazon-apigateway-integration'] = {
        type: 'aws_proxy',
        httpMethod: 'POST', // Lambda proxy integrations always invoke via POST.
        uri: lambdaInvokeUri(opts.partition, opts.region, functionArn),
        passthroughBehavior: 'when_no_match',
      };
      if (pathItem[method].security === undefined) {
        pathItem[method].security = defaultSecurity;
      }
      if (!usedEndpoints.includes(endpointKey)) {
        usedEndpoints.push(endpointKey);
      }
    }

    pathItem.options = buildCorsPreflightOperation(opts.corsAllowHeaders);
    keptPaths[routePath] = pathItem;
  }

  if (missing.length > 0) {
    throw new Error(
      `OpenAPI spec references ${missing.length} route(s) with no matching Lambda function:\n` +
        missing.map((route) => `  - ${route}`).join('\n') +
        '\nThis usually means a typo in easy-genomics-api.yaml, or a controller renamed/removed ' +
        'without regenerating the spec. Run `pnpm generate:openapi` and verify the controller exists.',
    );
  }

  document.paths = keptPaths;
  return { document, usedEndpoints };
}

/**
 * Rewrites an OpenAPI 3.1 document in place to be accepted by API Gateway's 3.0
 * importer: sets the version to 3.0.1 and converts every 3.1 union `type` array
 * into the 3.0 `type` + `nullable` form (or an `anyOf` when more than one
 * non-null type is present).
 */
export function downgradeToOpenApi30(document: Record<string, any>): void {
  document.openapi = '3.0.1';
  normalizeSchemaTypes(document);
}

function normalizeSchemaTypes(node: any): void {
  if (Array.isArray(node)) {
    node.forEach(normalizeSchemaTypes);
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node.type)) {
    const nonNull = node.type.filter((t: unknown) => t !== 'null');
    if (node.type.includes('null')) {
      node.nullable = true;
    }
    if (nonNull.length === 1) {
      node.type = nonNull[0];
    } else {
      delete node.type;
      node.anyOf = [...(node.anyOf ?? []), ...nonNull.map((t: string) => ({ type: t }))];
    }
  }
  for (const value of Object.values(node)) {
    normalizeSchemaTypes(value);
  }
}

/** Mock-integration OPTIONS operation replicating the old `defaultCorsPreflightOptions`. */
function buildCorsPreflightOperation(allowHeaders: string[]): Record<string, any> {
  const quote = (value: string) => `'${value}'`;
  return {
    'summary': 'CORS preflight',
    'security': [], // Preflight requests are never authenticated.
    'responses': {
      204: {
        description: 'CORS preflight response',
        headers: {
          'Access-Control-Allow-Origin': { schema: { type: 'string' } },
          'Access-Control-Allow-Methods': { schema: { type: 'string' } },
          'Access-Control-Allow-Headers': { schema: { type: 'string' } },
          'Access-Control-Allow-Credentials': { schema: { type: 'string' } },
        },
      },
    },
    'x-amazon-apigateway-integration': {
      type: 'mock',
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
      responses: {
        default: {
          statusCode: '204',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': quote(allowHeaders.join(',')),
            'method.response.header.Access-Control-Allow-Methods': quote(CORS_ALLOW_METHODS),
            'method.response.header.Access-Control-Allow-Origin': quote('*'),
            'method.response.header.Access-Control-Allow-Credentials': quote('true'),
          },
          responseTemplates: { 'application/json': '' },
        },
      },
    },
  };
}
