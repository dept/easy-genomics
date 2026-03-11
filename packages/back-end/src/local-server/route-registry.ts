/**
 * Route registry for the local API server.
 * Discovers REST Lambda handlers the same way the CDK Lambda construct does
 * and builds a (method, path) → handler map for Express.
 */

import * as fs from 'fs';
import path from 'path';

const CONTROLLERS_ROOT = path.resolve(__dirname, '../app/controllers');

/** HTTP methods used by API Gateway / front-end */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Single route entry for the local server */
export interface RouteEntry {
  method: HttpMethod;
  /** Express path pattern, e.g. /easy-genomics/organization/list-organizations or .../read-organization/:id */
  pathPattern: string;
  /** Absolute path to the .lambda.ts handler file for dynamic import */
  handlerPath: string;
  /** Command parsed from filename, e.g. list, read, create */
  command: string;
  /** True if this route expects path param :id */
  hasIdParam: boolean;
}

// Must match lambda-construct.ts ALLOWED_LAMBDA_FUNCTION_OPERATIONS
const COMMAND_TO_HTTP_METHOD: Record<string, HttpMethod> = {
  create: 'POST',
  confirm: 'POST',
  list: 'GET',
  read: 'GET',
  update: 'PUT',
  cancel: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  add: 'POST',
  edit: 'POST',
  request: 'POST',
  remove: 'POST',
};

// Commands that use path parameter {id} (must match lambda-construct.ts)
const COMMANDS_WITH_RESOURCE_ID = new Set<string>(['read', 'update', 'cancel', 'patch', 'delete']);

/** Controller subdirs that expose REST endpoints (excludes auth, which uses process-* and Cognito triggers) */
const REST_CONTROLLER_DIRS = ['easy-genomics', 'aws-healthomics', 'nf-tower'];

interface DiscoveredLambda {
  path: string;
  command: string;
  apiEndpoint: string; // e.g. easy-genomics/organization/list-organizations
}

/**
 * Recursively find all *.lambda.ts files under dir and return path, command, and API endpoint.
 * Skips process-* (no REST route). Endpoint = path relative to controllers root with forward slashes.
 */
function discoverLambdasInDir(directory: string, lambdaFunctions: DiscoveredLambda[] = []): DiscoveredLambda[] {
  const files = fs.readdirSync(directory);
  for (const file of files) {
    const absolutePath = path.join(directory, file);
    if (fs.statSync(absolutePath).isDirectory()) {
      discoverLambdasInDir(absolutePath, lambdaFunctions);
    } else if (file.endsWith('.lambda.ts')) {
      const command = file.split('-', 1)[0];
      if (command === 'process') {
        continue; // Skip process-*; no REST endpoint
      }
      if (!(command in COMMAND_TO_HTTP_METHOD)) {
        continue;
      }
      const relativePath = path.relative(CONTROLLERS_ROOT, absolutePath);
      const lambdaName = path.basename(file, '.lambda.ts');
      const apiDir = path.dirname(relativePath);
      const apiEndpoint = path.join(apiDir, lambdaName).split(path.sep).join('/');
      lambdaFunctions.push({ path: absolutePath, command, apiEndpoint });
    }
  }
  return lambdaFunctions;
}

/**
 * Build the full route registry for the local server.
 * Scans easy-genomics, aws-healthomics, nf-tower and returns one RouteEntry per REST endpoint.
 */
export function getRouteRegistry(): RouteEntry[] {
  const entries: RouteEntry[] = [];

  for (const subdir of REST_CONTROLLER_DIRS) {
    const dir = path.join(CONTROLLERS_ROOT, subdir);
    if (!fs.existsSync(dir)) {
      continue;
    }
    const lambdas = discoverLambdasInDir(dir);
    for (const lambda of lambdas) {
      const method = COMMAND_TO_HTTP_METHOD[lambda.command];
      const hasIdParam = COMMANDS_WITH_RESOURCE_ID.has(lambda.command);
      const pathPrefix = `/${lambda.apiEndpoint}`;
      const pathPattern = hasIdParam ? `${pathPrefix}/:id` : pathPrefix;
      entries.push({
        method,
        pathPattern,
        handlerPath: lambda.path,
        command: lambda.command,
        hasIdParam,
      });
    }
  }

  return entries;
}

/**
 * Run directly to print the route registry (for verification).
 * Example: npx tsx src/local-server/route-registry.ts
 */
if (require.main === module) {
  const routes = getRouteRegistry();
  console.log(`Discovered ${routes.length} REST route(s):\n`);
  for (const r of routes) {
    console.log(`  ${r.method.padEnd(6)} ${r.pathPattern}`);
  }
}
