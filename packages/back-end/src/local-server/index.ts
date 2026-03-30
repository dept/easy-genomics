/**
 * Local API server: runs Lambda handlers behind Express, using real AWS (DynamoDB, Cognito, etc.)
 * via .env.local. Start with: pnpm run local-server (from packages/back-end).
 */

import path from 'path';
import { ACCESS_CONTROL_ALLOW_HEADERS } from '@easy-genomics/shared-lib/lib/app/utils/common';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { runAuth, attachClaimsToEvent, sendUnauthorizedIfNeeded } from './auth-middleware';
import { buildApiGatewayEvent } from './event-builder';
import { invokeHandler } from './lambda-invoker';
import { getRouteRegistry } from './route-registry';

const ENV_LOCAL_PATH = path.resolve(__dirname, '../../.env.local');

const REQUIRED_ENV = [
  'NAME_PREFIX',
  'ACCOUNT_ID',
  'REGION',
  'COGNITO_USER_POOL_ID',
  'COGNITO_USER_POOL_CLIENT_ID',
] as const;

function loadEnv(): void {
  dotenv.config({ path: ENV_LOCAL_PATH });
  // AWS SDK (DynamoDB, S3, etc.) uses AWS_REGION; .env.local uses REGION
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required env vars (set in packages/back-end/.env.local): ${missing.join(', ')}.\n` +
        'See packages/back-end/.env.local.example for the full list.',
    );
    process.exit(1);
  }
}

function corsMiddleware(_req: Request, res: Response, next: () => void): void {
  res.setHeader('Access-Control-Allow-Origin', _req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ACCESS_CONTROL_ALLOW_HEADERS.join(','));
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

function sendLambdaResponse(
  res: Response,
  result: { statusCode: number; headers?: Record<string, string>; body: string },
): void {
  res.status(result.statusCode);
  // So the frontend can show "running locally" (only set by the local server, not API Gateway)
  res.setHeader('X-Easy-Genomics-Backend', 'local');
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  res.send(result.body);
}

function main(): void {
  loadEnv();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(corsMiddleware);

  const routes = getRouteRegistry();

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    app[method](route.pathPattern, async (req: Request, res: Response) => {
      try {
        const authResult = await runAuth(req.method, req.path, route.hasIdParam, req.headers.authorization);
        if (sendUnauthorizedIfNeeded(res, authResult)) return;

        const pathParams = { id: req.params?.id };
        const rawBody =
          typeof req.body === 'string'
            ? req.body
            : req.body && Object.keys(req.body).length > 0
              ? JSON.stringify(req.body)
              : undefined;
        const event = buildApiGatewayEvent(req, pathParams, { rawBody });

        if (authResult.authorized && authResult.claims && Object.keys(authResult.claims).length > 0) {
          attachClaimsToEvent(event, authResult.claims);
        }

        const result = await invokeHandler(route.handlerPath, event);
        sendLambdaResponse(res, result);
      } catch (err) {
        console.error(`[local-server] ${route.method} ${route.pathPattern}`, err);
        res.status(500).json({
          Error: err instanceof Error ? err.message : 'Internal server error',
          ErrorCode: 'EG-100',
        });
      }
    });
  }

  app.use((err: Error, _req: Request, res: Response) => {
    console.error('[local-server] Unhandled error', err);
    res.status(500).json({
      Error: err.message || 'Internal server error',
      ErrorCode: 'EG-100',
    });
  });

  const port = Number(process.env.LOCAL_SERVER_PORT) || 3001;
  app.listen(port, () => {
    console.log(`Local server listening on http://localhost:${port}`);
  });
}

main();
