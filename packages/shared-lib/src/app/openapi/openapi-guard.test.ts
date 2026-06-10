/**
 * Guard tests for the OpenAPI generator tooling.
 *
 * These tests verify that:
 *   1. The verb-operations tables match the CDK lambda-construct source of truth.
 *   2. Every non-process-* controller handler has an entry in ROUTE_SCHEMAS.
 *   3. Every entry in ROUTE_SCHEMAS has a matching controller file.
 *   4. The public routes are exactly the expected set.
 */

import fs from 'fs';
import path from 'path';
import { ROUTE_SCHEMAS } from './route-schemas';
import {
  ALLOWED_LAMBDA_FUNCTION_OPERATIONS,
  ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID,
} from './verb-operations';

const CONTROLLERS_DIR = path.resolve(__dirname, '../../../../back-end/src/app/controllers');

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkLambdaFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      results.push(...walkLambdaFiles(full));
    } else if (entry.endsWith('.lambda.ts')) {
      results.push(full);
    }
  }
  return results;
}

function deriveRouteKey(filePath: string): string | null {
  const entry = path.basename(filePath);
  const dir = path.dirname(filePath);
  const fileStem = entry.replace(/\.lambda\.ts$/, '');
  const verb = fileStem.split('-')[0];

  if (verb === 'process') return null;
  if (!(verb in ALLOWED_LAMBDA_FUNCTION_OPERATIONS)) return null;

  const method = ALLOWED_LAMBDA_FUNCTION_OPERATIONS[verb];
  const hasId = verb in ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID;

  const relDir = path.relative(CONTROLLERS_DIR, dir);
  const routePath = relDir ? `/${relDir}/${fileStem}` : `/${fileStem}`;
  const fullPath = hasId ? `${routePath}/{id}` : routePath;

  return `${method} ${fullPath}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('verb-operations tables match CDK lambda-construct', () => {
  expect(ALLOWED_LAMBDA_FUNCTION_OPERATIONS).toEqual({
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
  });
  expect(ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID).toEqual({
    read: 'GET',
    update: 'PUT',
    cancel: 'PUT',
    patch: 'PATCH',
    delete: 'DELETE',
  });
});

test('every controller handler is in ROUTE_SCHEMAS', () => {
  const lambdaFiles = walkLambdaFiles(CONTROLLERS_DIR);
  const manifestKeys = new Set(Object.keys(ROUTE_SCHEMAS));
  const missing: string[] = [];

  for (const filePath of lambdaFiles) {
    const key = deriveRouteKey(filePath);
    if (key === null) continue; // process-* or unrecognised verb — intentionally excluded
    if (!manifestKeys.has(key)) {
      missing.push(`${key}  (file: ${path.relative(CONTROLLERS_DIR, filePath)})`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Handlers present in filesystem but missing from ROUTE_SCHEMAS:\n  ${missing.join('\n  ')}`);
  }
});

test('ROUTE_SCHEMAS has no orphaned entries', () => {
  const lambdaFiles = walkLambdaFiles(CONTROLLERS_DIR);
  const discoveredKeys = new Set(lambdaFiles.map(deriveRouteKey).filter((k): k is string => k !== null));
  const orphaned = Object.keys(ROUTE_SCHEMAS).filter((k) => !discoveredKeys.has(k));

  if (orphaned.length > 0) {
    throw new Error(`ROUTE_SCHEMAS entries with no matching controller file:\n  ${orphaned.join('\n  ')}`);
  }
});

test('public routes are exactly the expected set', () => {
  const publicRoutes = Object.entries(ROUTE_SCHEMAS)
    .filter(([, v]) => v.public)
    .map(([k]) => k);

  expect(publicRoutes.sort()).toEqual(
    [
      'POST /easy-genomics/user/confirm-user-forgot-password-request',
      'POST /easy-genomics/user/confirm-user-invitation-request',
      'POST /easy-genomics/user/create-user-forgot-password-request',
    ].sort(),
  );
});
