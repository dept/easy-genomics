import {
  CORS_ALLOW_METHODS,
  downgradeToOpenApi30,
  endpointKeyForPath,
  enrichSpecForApiGateway,
  EnrichSpecOptions,
  lambdaInvokeUri,
} from '../../../src/infra/constructs/openapi-spec-enrichment';

/** Minimal OpenAPI doc mirroring the relevant shape of easy-genomics-api.yaml. */
const baseSpec = () => ({
  openapi: '3.1.0',
  components: {
    securitySchemes: {
      cognitoJwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ cognitoJwt: [] }],
  paths: {
    '/easy-genomics/organization/create-organization': {
      post: { operationId: 'createOrganization', responses: { 200: { description: 'ok' } } },
    },
    '/easy-genomics/organization/read-organization/{id}': {
      get: { operationId: 'readOrganization', responses: { 200: { description: 'ok' } } },
    },
    '/easy-genomics/list-api-docs': {
      get: { operationId: 'listApiDocs', security: [], responses: { 200: { description: 'ok' } } },
    },
    // Belongs to the other API — must be filtered out when scope is easy-genomics.
    '/aws-healthomics/run/list-runs': {
      get: { operationId: 'listRuns', responses: { 200: { description: 'ok' } } },
    },
  },
});

const arnFor = (endpointKey: string) => `arn:aws:lambda:us-west-2:123:function:fn${endpointKey.replace(/\W/g, '')}`;

const baseOptions = (overrides: Partial<EnrichSpecOptions> = {}): EnrichSpecOptions => ({
  includePathPrefixes: ['/easy-genomics'],
  resolveLambdaArn: (endpointKey) => arnFor(endpointKey),
  cognitoProviderArns: ['arn:aws:cognito-idp:us-west-2:123:userpool/pool-1'],
  region: 'us-west-2',
  partition: 'aws',
  corsAllowHeaders: ['Authorization', 'Content-Type'],
  ...overrides,
});

describe('endpointKeyForPath', () => {
  it('strips a trailing /{id}', () => {
    expect(endpointKeyForPath('/easy-genomics/organization/read-organization/{id}')).toBe(
      '/easy-genomics/organization/read-organization',
    );
  });
  it('leaves a path without /{id} unchanged', () => {
    expect(endpointKeyForPath('/easy-genomics/organization/create-organization')).toBe(
      '/easy-genomics/organization/create-organization',
    );
  });
});

describe('lambdaInvokeUri', () => {
  it('builds a proxy invoke uri using partition/region tokens', () => {
    expect(lambdaInvokeUri('aws', 'us-west-2', 'ARN')).toBe(
      'arn:aws:apigateway:us-west-2:lambda:path/2015-03-31/functions/ARN/invocations',
    );
  });
});

describe('downgradeToOpenApi30', () => {
  it('sets the document version to 3.0.1', () => {
    const doc: Record<string, any> = { openapi: '3.1.0', paths: {} };
    downgradeToOpenApi30(doc);
    expect(doc.openapi).toBe('3.0.1');
  });

  it('converts a [T, null] union into type: T + nullable: true', () => {
    const doc: Record<string, any> = {
      openapi: '3.1.0',
      components: { schemas: { Foo: { type: ['object', 'null'], properties: {} } } },
    };
    downgradeToOpenApi30(doc);
    expect(doc.components.schemas.Foo).toMatchObject({ type: 'object', nullable: true });
    expect(Array.isArray(doc.components.schemas.Foo.type)).toBe(false);
  });

  it('converts a multi-type union into anyOf', () => {
    const doc: Record<string, any> = { schema: { type: ['string', 'number', 'null'] } };
    downgradeToOpenApi30(doc);
    expect(doc.schema.type).toBeUndefined();
    expect(doc.schema.nullable).toBe(true);
    expect(doc.schema.anyOf).toEqual([{ type: 'string' }, { type: 'number' }]);
  });

  it('recurses through nested schemas', () => {
    const doc: Record<string, any> = {
      paths: { '/x': { get: { responses: { 200: { schema: { type: ['string', 'null'] } } } } } },
    };
    downgradeToOpenApi30(doc);
    expect(doc.paths['/x'].get.responses['200'].schema).toEqual({ type: 'string', nullable: true });
  });
});

describe('enrichSpecForApiGateway', () => {
  it('downgrades the enriched document to OpenAPI 3.0.1', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(document.openapi).toBe('3.0.1');
  });

  it('injects an aws_proxy Lambda integration into each in-scope operation', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    const integration =
      document.paths['/easy-genomics/organization/create-organization'].post['x-amazon-apigateway-integration'];
    expect(integration).toEqual({
      type: 'aws_proxy',
      httpMethod: 'POST',
      uri: lambdaInvokeUri('aws', 'us-west-2', arnFor('/easy-genomics/organization/create-organization')),
      passthroughBehavior: 'when_no_match',
    });
  });

  it('resolves the Lambda using the /{id}-stripped endpoint key', () => {
    const seen: string[] = [];
    enrichSpecForApiGateway(
      baseSpec(),
      baseOptions({
        resolveLambdaArn: (endpointKey) => {
          seen.push(endpointKey);
          return arnFor(endpointKey);
        },
      }),
    );
    expect(seen).toContain('/easy-genomics/organization/read-organization');
    expect(seen).not.toContain('/easy-genomics/organization/read-organization/{id}');
  });

  it('converts the bearer scheme into a Cognito User Pools authorizer', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(document.components.securitySchemes.cognitoJwt).toEqual({
      'type': 'apiKey',
      'name': 'Authorization',
      'in': 'header',
      'x-amazon-apigateway-authtype': 'cognito_user_pools',
      'x-amazon-apigateway-authorizer': {
        type: 'cognito_user_pools',
        providerARNs: ['arn:aws:cognito-idp:us-west-2:123:userpool/pool-1'],
      },
    });
  });

  it('preserves security: [] on public operations', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(document.paths['/easy-genomics/list-api-docs'].get.security).toEqual([]);
  });

  it('flattens the root security requirement onto protected operations', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(document.paths['/easy-genomics/organization/create-organization'].post.security).toEqual([
      { cognitoJwt: [] },
    ]);
    expect(document.paths['/easy-genomics/organization/read-organization/{id}'].get.security).toEqual([
      { cognitoJwt: [] },
    ]);
  });

  it('does not overwrite an operation that is explicitly public', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(document.paths['/easy-genomics/list-api-docs'].get.security).toEqual([]);
  });

  it('adds a mock CORS preflight OPTIONS to every in-scope path', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    const options = document.paths['/easy-genomics/organization/create-organization'].options;
    expect(options.security).toEqual([]);
    const integration = options['x-amazon-apigateway-integration'];
    expect(integration.type).toBe('mock');
    expect(
      integration.responses.default.responseParameters['method.response.header.Access-Control-Allow-Methods'],
    ).toBe(`'${CORS_ALLOW_METHODS}'`);
    expect(
      integration.responses.default.responseParameters['method.response.header.Access-Control-Allow-Headers'],
    ).toBe("'Authorization,Content-Type'");
  });

  it('drops paths owned by another API (by prefix)', () => {
    const { document } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(Object.keys(document.paths)).not.toContain('/aws-healthomics/run/list-runs');
    expect(Object.keys(document.paths)).toContain('/easy-genomics/organization/create-organization');
  });

  it('returns the endpoints that were wired, for invoke-permission granting', () => {
    const { usedEndpoints } = enrichSpecForApiGateway(baseSpec(), baseOptions());
    expect(usedEndpoints.sort()).toEqual(
      [
        '/easy-genomics/list-api-docs',
        '/easy-genomics/organization/create-organization',
        '/easy-genomics/organization/read-organization',
      ].sort(),
    );
  });

  it('throws when an in-scope route has no backing Lambda (typo guard → synth failure)', () => {
    expect(() =>
      enrichSpecForApiGateway(
        baseSpec(),
        baseOptions({
          // Simulate a spec typo: the create-organization route resolves to nothing.
          resolveLambdaArn: (endpointKey) =>
            endpointKey === '/easy-genomics/organization/create-organization' ? undefined : arnFor(endpointKey),
        }),
      ),
    ).toThrow(/no matching Lambda function[\s\S]*POST \/easy-genomics\/organization\/create-organization/);
  });

  it('throws when the configured security scheme is missing', () => {
    const spec = baseSpec();
    delete (spec.components.securitySchemes as any).cognitoJwt;
    expect(() => enrichSpecForApiGateway(spec, baseOptions())).toThrow(/security scheme "cognitoJwt" not found/);
  });

  it('does not mutate the input spec', () => {
    const spec = baseSpec();
    enrichSpecForApiGateway(spec, baseOptions());
    expect(spec.components.securitySchemes.cognitoJwt).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(
      (spec.paths['/easy-genomics/organization/create-organization'].post as Record<string, any>)[
        'x-amazon-apigateway-integration'
      ],
    ).toBeUndefined();
  });
});
