/**
 * OpenAPI 3.1 generator for the Easy Genomics API.
 *
 * Run from packages/shared-lib/:
 *   tsx src/app/openapi/generate-openapi.ts
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
// eslint-disable-next-line import/no-extraneous-dependencies
import * as TJS from 'typescript-json-schema';
// eslint-disable-next-line import/no-extraneous-dependencies
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ROUTE_SCHEMAS } from './route-schemas';
import {
  ALLOWED_LAMBDA_FUNCTION_OPERATIONS,
  ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID,
} from './verb-operations';

// ── Path constants ────────────────────────────────────────────────────────────

// When tsx executes "tsx src/app/openapi/generate-openapi.ts" from packages/shared-lib/,
// __dirname equals the cwd (packages/shared-lib/), so we use process.cwd() for robustness.
const SHARED_LIB_ROOT = process.cwd(); // packages/shared-lib/
const CONTROLLERS_DIR = path.resolve(SHARED_LIB_ROOT, '../back-end/src/app/controllers');
const TYPES_DIR = path.resolve(SHARED_LIB_ROOT, 'src/app/types');
const SCHEMA_DIR = path.resolve(SHARED_LIB_ROOT, 'src/app/schema');
const OUTPUT_PATH = path.resolve(SHARED_LIB_ROOT, 'src/app/openapi/easy-genomics-api.yaml');

if (!fs.existsSync(CONTROLLERS_DIR)) {
  throw new Error(
    `Controllers directory not found at ${CONTROLLERS_DIR}. ` +
      `Run this script from packages/shared-lib/ (current cwd: ${process.cwd()})`,
  );
}

// ── Step 1: Discover routes from the filesystem ───────────────────────────────

interface DiscoveredRoute {
  key: string; // "METHOD /path"
  fileStem: string; // e.g. "create-organization"
  hasId: boolean;
}

function discoverRoutes(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.endsWith('.lambda.ts')) continue;

      const fileStem = entry.replace(/\.lambda\.ts$/, '');
      const verb = fileStem.split('-')[0];

      if (verb === 'process') continue;
      if (!(verb in ALLOWED_LAMBDA_FUNCTION_OPERATIONS)) continue;

      const method = ALLOWED_LAMBDA_FUNCTION_OPERATIONS[verb];
      const hasId = verb in ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID;

      // Derive path relative to controllers dir
      const relDir = path.relative(CONTROLLERS_DIR, dir);
      const routePath = relDir ? `/${relDir}/${fileStem}` : `/${fileStem}`;
      const fullPath = hasId ? `${routePath}/{id}` : routePath;
      const key = `${method} ${fullPath}`;

      routes.push({ key, fileStem, hasId });
    }
  }

  walk(CONTROLLERS_DIR);
  return routes;
}

// ── Step 2: Assert manifest completeness ─────────────────────────────────────

function assertManifestCompleteness(discovered: DiscoveredRoute[]): void {
  const discoveredKeys = new Set(discovered.map((r) => r.key));
  const manifestKeys = new Set(Object.keys(ROUTE_SCHEMAS));

  const missingFromManifest = [...discoveredKeys].filter((k) => !manifestKeys.has(k));
  const missingFromFilesystem = [...manifestKeys].filter((k) => !discoveredKeys.has(k));

  if (missingFromManifest.length > 0 || missingFromFilesystem.length > 0) {
    const lines: string[] = ['Route manifest mismatch:'];
    if (missingFromManifest.length > 0) {
      lines.push('  In filesystem but not in ROUTE_SCHEMAS:');
      missingFromManifest.forEach((k) => lines.push(`    ${k}`));
    }
    if (missingFromFilesystem.length > 0) {
      lines.push('  In ROUTE_SCHEMAS but not in filesystem:');
      missingFromFilesystem.forEach((k) => lines.push(`    ${k}`));
    }
    throw new Error(lines.join('\n'));
  }
}

// ── TJS generator (lazy, cached) ─────────────────────────────────────────────

let _tjsGenerator: TJS.JsonSchemaGenerator | null = null;

function getTjsGenerator(): TJS.JsonSchemaGenerator {
  if (_tjsGenerator) return _tjsGenerator;

  // Collect all type source files (excluding very large generated files)
  const typeFiles = collectTsFiles(TYPES_DIR).filter(
    (f) => !f.includes('nextflow-tower-openapi-spec') && !f.includes('nextflow-tower-zod-schemas'),
  );
  const schemaFiles = collectTsFiles(SCHEMA_DIR);

  const allFiles = [...typeFiles, ...schemaFiles];

  const program = TJS.getProgramFromFiles(allFiles, {
    esModuleInterop: true,
    strictNullChecks: true,
    strict: true,
    target: 99, // ES2022
    module: 1, // CommonJS
    skipLibCheck: true,
    baseUrl: SHARED_LIB_ROOT,
    paths: {
      '@SharedLib/*': ['src/app/*'],
    },
  });

  const generator = TJS.buildGenerator(program, {
    required: true,
    ignoreErrors: true,
    noExtraProps: false,
  });

  if (!generator) throw new Error('Failed to build TJS generator');
  _tjsGenerator = generator;
  return _tjsGenerator;
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toTitleCase(kebab: string): string {
  return kebab
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function toPascalCase(kebab: string): string {
  const camel = toCamelCase(kebab);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Returns true if a name is valid for an OpenAPI component map key. */
function isValidComponentName(name: string): boolean {
  return /^[a-zA-Z0-9.\-_]+$/.test(name);
}

/**
 * Resolve a JSON-pointer-style path like
 * "CreateFileUploadSampleSheetRequest/properties/UploadedFilePairs/items/properties/R1"
 * against a schema object.  Returns the nested value or undefined.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveJsonPath(root: any, pointer: string): any {
  const parts = pointer.split('/');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Post-process a JSON Schema object for OpenAPI 3.1.
 *
 * Applies the following transforms (recursively):
 *   1. Remove $schema key.
 *   2. Convert JSON Schema draft-7 `{ minimum: N, exclusiveMinimum: true }` →
 *      OpenAPI 3.1 `{ exclusiveMinimum: N }`.
 *   3. Extract `definitions` blocks: lift valid names to `components.schemas`
 *      and rewrite `$ref: "#/definitions/Name"` → `$ref: "#/components/schemas/Name"`.
 *      Invalid names (containing generic type chars) are inlined at every $ref site.
 *   4. Convert `{ nullable: true, type: X }` → `{ type: [X, 'null'] }`.
 *   5. Convert `{ nullable: true, allOf: [...] }` → `{ oneOf: [..., { type: 'null' }] }`.
 *
 * @param schema      The schema object to transform.
 * @param components  The top-level `components` object so we can add to `schemas`.
 * @param schemaRoot  The root of the current schema (used to resolve intra-schema $refs).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function postProcessSchema(schema: any, components: any, schemaRoot?: any): any {
  if (typeof schema !== 'object' || schema === null) return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => postProcessSchema(item, components, schemaRoot));
  }

  // Use `schema` itself as the root when called for the first time.
  const root = schemaRoot ?? schema;

  // ── Step 1: lift definitions to components.schemas ───────────────────────
  if (schema.definitions && typeof schema.definitions === 'object') {
    // Build a synthetic root so sibling $ref lookups can resolve against the full set.
    const defsRoot = { definitions: schema.definitions };
    for (const [defName, defSchema] of Object.entries(schema.definitions)) {
      if (isValidComponentName(defName) && !(defName in components.schemas)) {
        // Recursively post-process the definition before storing it.
        components.schemas[defName] = postProcessSchema(defSchema, components, defsRoot);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {};

  // Check whether a $ref in this schema node needs to be inlined.
  // If so, the entire node should be replaced by the inlined schema.
  if (typeof schema.$ref === 'string') {
    const rewritten = rewriteRef(schema.$ref, schema, root, components);
    if (typeof rewritten !== 'string') {
      // rewriteRef returned an inline schema object — return it directly,
      // preserving any non-$ref sibling properties (e.g. description).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siblings: any = {};
      for (const [k, v] of Object.entries(schema)) {
        if (k === '$ref' || k === '$schema' || k === 'definitions') continue;
        siblings[k] = postProcessSchema(v, components, root);
      }
      return { ...rewritten, ...siblings };
    }
    // Valid string ref — fall through and let the loop below handle it normally.
  }

  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema') continue;
    if (k === 'definitions') continue; // handled above; remove from output

    if (k === '$ref' && typeof v === 'string') {
      const rewritten = rewriteRef(v, schema, root, components);
      // rewritten is always a string here (inline case handled above)
      result[k] = rewritten;
    } else {
      result[k] = postProcessSchema(v, components, root);
    }
  }

  // ── Step 2: exclusiveMinimum boolean → number ─────────────────────────────
  if (result.exclusiveMinimum === true && result.minimum !== undefined) {
    result.exclusiveMinimum = result.minimum;
    delete result.minimum;
  }

  // ── Step 3: nullable with allOf → oneOf + null ───────────────────────────
  if (result.nullable === true && result.allOf !== undefined) {
    const allOf = result.allOf;
    delete result.nullable;
    delete result.allOf;
    result.oneOf = [...allOf, { type: 'null' }];
  }

  // ── Step 4: nullable with type → type array ───────────────────────────────
  if (result.nullable === true && result.type !== undefined) {
    const baseType = result.type;
    delete result.nullable;
    result.type = Array.isArray(baseType) ? [...baseType, 'null'] : [baseType, 'null'];
  }

  // ── Step 5: nullable with $ref (no type, no allOf) → oneOf + null ─────────
  if (result.nullable === true && result.$ref !== undefined) {
    const ref = result.$ref;
    delete result.nullable;
    delete result.$ref;
    result.oneOf = [{ $ref: ref }, { type: 'null' }];
  }

  return result;
}

/**
 * Rewrite a single $ref value.
 *   "#/definitions/Name"  → "#/components/schemas/Name" (valid name)
 *                         → inline schema content         (invalid name)
 *   Other refs are returned unchanged.
 */
function rewriteRef(
  ref: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _parentSchema: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaRoot: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any,
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
string | any {
  // Decode URL-encoded characters (e.g. %3C → <, %3E → >, %2C → ,)
  const decoded = decodeURIComponent(ref);

  const defsPrefix = '#/definitions/';
  if (!decoded.startsWith(defsPrefix)) {
    // Could be an intra-schema path reference like
    // "#/definitions/SomeName/properties/UploadedFilePairs/..."
    // that doesn't start cleanly — pass through unchanged.
    return ref;
  }

  const defPath = decoded.slice(defsPrefix.length); // e.g. "Status" or "Record<string,any>"

  // If it's a simple name (no slashes), look it up in definitions.
  const slashIndex = defPath.indexOf('/');
  const defName = slashIndex === -1 ? defPath : defPath.slice(0, slashIndex);
  const subPath = slashIndex === -1 ? '' : defPath.slice(slashIndex + 1);

  if (isValidComponentName(defName)) {
    // Rewrite to components/schemas reference.
    const base = `#/components/schemas/${defName}`;
    return subPath ? `${base}/${subPath}` : base;
  }

  // Invalid name — inline the definition if we can find it in the schema root.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inlined: any = schemaRoot?.definitions?.[defName];
  if (inlined === undefined) {
    // Try resolving the full path directly from the schema root.
    inlined = resolveJsonPath(schemaRoot, defPath);
  }

  if (inlined !== undefined) {
    return postProcessSchema(inlined, components, schemaRoot);
  }

  // Cannot resolve — return a plain empty schema so it doesn't hard-fail.
  process.stderr.write(`Warning: Could not inline $ref "${ref}" — schema will be empty ({})\n`);
  return {};
}

// ── Step 3–6: Build OpenAPI document ─────────────────────────────────────────

function buildOpenApiDoc(discovered: DiscoveredRoute[]): object {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: any = {
    securitySchemes: {
      cognitoJwt: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Cognito User Pool JWT token',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          Error: { type: 'string' },
          ErrorCode: {
            type: 'string',
            description:
              'EG-1xx: generic, EG-2xx: organization, EG-3xx: laboratory, EG-4xx: user, EG-5xx: AWS HealthOmics, EG-6xx: Seqera Cloud',
          },
        },
        required: ['Error', 'ErrorCode'],
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad request',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Unauthorized: {
        description: 'Unauthorized',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      Forbidden: {
        description: 'Forbidden',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      NotFound: {
        description: 'Not found',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
      InternalError: {
        description: 'Internal server error',
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        },
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paths: any = {};

  for (const route of discovered) {
    const { key, fileStem, hasId } = route;
    const routeSchema = ROUTE_SCHEMAS[key];
    const [method, fullPath] = key.split(' ');
    const httpMethod = method.toLowerCase();

    // ── Request body schema ──────────────────────────────────────────────────
    let requestBodySpec: object | undefined;
    if (routeSchema.request) {
      const schemaName = `${toPascalCase(fileStem)}Request`;
      if (!(schemaName in components.schemas)) {
        const raw = zodToJsonSchema(routeSchema.request, {
          name: schemaName,
          target: 'openApi3',
        });
        // zodToJsonSchema wraps in { definitions: { [name]: ... }, $ref: ... }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawAny = raw as any;
        const def = rawAny.definitions?.[schemaName] ?? rawAny.$defs?.[schemaName] ?? rawAny;
        components.schemas[schemaName] = postProcessSchema(def, components);
      }
      requestBodySpec = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${schemaName}` },
          },
        },
      };
    }

    // ── Response schema ──────────────────────────────────────────────────────
    let responseSchema: object = {};
    if (routeSchema.response) {
      const typeName = routeSchema.response;
      if (!(typeName in components.schemas)) {
        try {
          const generator = getTjsGenerator();
          const tjsSchema = generator.getSchemaForSymbol(typeName);
          if (tjsSchema) {
            components.schemas[typeName] = postProcessSchema(tjsSchema, components);
          } else {
            process.stderr.write(`Warning: TJS returned null for type '${typeName}'\n`);
            components.schemas[typeName] = {};
          }
        } catch (err) {
          process.stderr.write(`Warning: Could not resolve type '${typeName}': ${(err as Error).message}\n`);
          components.schemas[typeName] = {};
        }
      }
      responseSchema = { $ref: `#/components/schemas/${typeName}` };
    }

    // ── Parameters ───────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parameters: any[] = [];
    if (hasId) {
      parameters.push({
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }
    if (routeSchema.query) {
      for (const qp of routeSchema.query) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const param: any = {
          name: qp.name,
          in: 'query',
          required: qp.required,
          schema: { type: 'string' },
        };
        if (qp.description) param.description = qp.description;
        parameters.push(param);
      }
    }

    // ── Build operation ──────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const operation: any = {
      operationId: toCamelCase(fileStem),
      summary: toTitleCase(fileStem),
    };

    if (routeSchema.public) {
      operation.security = [];
    }

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    if (requestBodySpec) {
      operation.requestBody = requestBodySpec;
    }

    operation.responses = {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: Object.keys(responseSchema).length > 0 ? responseSchema : {},
          },
        },
      },
      400: { $ref: '#/components/responses/BadRequest' },
      401: { $ref: '#/components/responses/Unauthorized' },
      403: { $ref: '#/components/responses/Forbidden' },
      404: { $ref: '#/components/responses/NotFound' },
      500: { $ref: '#/components/responses/InternalError' },
    };

    if (!(fullPath in paths)) {
      paths[fullPath] = {};
    }
    paths[fullPath][httpMethod] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Easy Genomics API',
      version: '1.0.0',
      description:
        'Internal REST API for the Easy Genomics platform.\n' +
        'All routes require a Cognito JWT bearer token unless marked with security: [].',
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      {
        url: 'https://api.example.com',
        description: 'Easy Genomics API (placeholder — replaced by CDK integration)',
      },
    ],
    components,
    security: [{ cognitoJwt: [] }],
    paths,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const discovered = discoverRoutes();
  console.log(`Discovered ${discovered.length} routes`);

  assertManifestCompleteness(discovered);
  console.log('Manifest check passed');

  const doc = buildOpenApiDoc(discovered);

  const output = yaml.dump(doc, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');
  console.log(`Written: ${OUTPUT_PATH}`);
}

main();
