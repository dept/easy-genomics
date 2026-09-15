# Error handling

Typed HTTP errors for Lambda handlers. Full project context: [CLAUDE.md](./CLAUDE.md).

## Rules

1. **Throw typed errors** from `packages/shared-lib/src/app/utils/HttpError.ts` (e.g. `InvalidRequestError`,
   `UnauthorizedAccessError`, `LaboratoryNotFoundError`). Do not throw bare `Error` for API failures.
2. **Catch at handler boundary** and return `buildErrorResponse(err, event)` from
   `@easy-genomics/shared-lib/lib/app/utils/common`.
3. **Do not swallow failures** — log with `console.error` then return `buildErrorResponse`.
4. **Validate input** with Zod schemas from `packages/shared-lib/src/app/schema/`; failed `safeParse` →
   `InvalidRequestError`.

## Handler template

```typescript
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';

export const handler: Handler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // validate → authorize → service call → buildResponse
    return buildResponse(200, JSON.stringify(result), event);
  } catch (err: unknown) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
```

## Adding a new error

Add a class in `HttpError.ts` extending `HttpError` with a unique `errorCode` (`EG-xxx`). Reuse an existing class when
the HTTP status and meaning match.
