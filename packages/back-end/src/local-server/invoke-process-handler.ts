/**
 * Optional: Manually invoke a process-* (or any) Lambda handler locally with a JSON event.
 * Useful for testing SQS/Cognito-triggered handlers without deploying.
 *
 * Usage:
 *   pnpm run invoke-process-handler -- <path-to-handler> <path-to-event.json>
 * Example:
 *   pnpm run invoke-process-handler -- src/app/controllers/easy-genomics/user/process-create-user-invites.lambda.ts ./sample-sqs-event.json
 *
 * The event file should be valid JSON (e.g. an SQSEvent or Cognito trigger event).
 * .env.local is loaded so the handler can access AWS resources.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
const ENV_LOCAL_PATH = path.resolve(__dirname, '../../.env.local');

function main(): void {
  dotenv.config({ path: ENV_LOCAL_PATH });
  if (process.env.REGION && !process.env.AWS_REGION) {
    process.env.AWS_REGION = process.env.REGION;
  }

  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      'Usage: pnpm run invoke-process-handler -- <handler-path> <event-json-path>\n' +
        'Example: pnpm run invoke-process-handler -- src/app/controllers/easy-genomics/user/process-create-user-invites.lambda.ts ./sample-sqs-event.json',
    );
    process.exit(1);
  }

  const [handlerPathArg, eventPathArg] = args;
  const handlerPath = path.resolve(process.cwd(), handlerPathArg);
  const eventPath = path.resolve(process.cwd(), eventPathArg);

  if (!fs.existsSync(handlerPath)) {
    console.error(`Handler file not found: ${handlerPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(eventPath)) {
    console.error(`Event file not found: ${eventPath}`);
    process.exit(1);
  }

  const eventJson = fs.readFileSync(eventPath, 'utf8');
  const event = JSON.parse(eventJson);

  void (async () => {
    try {
      // process-* handlers take SQS or Cognito events, not APIGatewayProxy*. We still use
      // the same dynamic import; the handler signature is (event: SQSEvent | ...) => Promise<...>.
      const moduleURL = pathToFileURL(handlerPath).href;
      const mod = await import(moduleURL);
      if (typeof mod.handler !== 'function') {
        console.error(`Module did not export "handler": ${handlerPath}`);
        process.exit(1);
      }
      const result = await mod.handler(event);
      console.log('Result:', JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('Invocation failed:', err);
      process.exit(1);
    }
  })();
}

main();
