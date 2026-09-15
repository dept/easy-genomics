# OpenAPI Specification

## Overview

`easy-genomics-api.yaml` is the **generated** OpenAPI 3.1 specification for the Easy Genomics REST API. Do not edit it
by hand. The spec documents all HTTP Lambda handlers in the codebase; event-driven handlers (`process-*` verbs) are
excluded.

## File Inventory

- **`easy-genomics-api.yaml`** — Generated OpenAPI 3.1 spec artifact. Discarded and regenerated on each build.
- **`generate-openapi.ts`** — Generator script. Discovers routes from the filesystem, validates against the manifest,
  resolves request/response schemas, and emits the YAML spec.
- **`route-schemas.ts`** — Route manifest mapping each handler to its request schema (Zod), response type (TypeScript),
  query parameters, and public flag.
- **`verb-operations.ts`** — Copy of verb→HTTP method tables from
  `packages/back-end/src/infra/constructs/lambda-construct.ts`. Keep in sync.

## How to Regenerate the Spec

```bash
# From monorepo root or packages/shared-lib/
pnpm --filter @easy-genomics/shared-lib run generate:openapi

# To validate the generated spec (e.g., with Swagger/Spectacle):
pnpm --filter @easy-genomics/shared-lib run lint:openapi
```

If the spec fails to generate, the error message will indicate which routes are missing from `route-schemas.ts` or exist
on the filesystem but not in the manifest.

## How to Add a New Handler

1. Create the Lambda handler file in `packages/back-end/src/app/controllers/` with a verb prefix (`create-`, `update-`,
   etc.)
2. (Optional) If the handler has a request body, add a Zod schema in `packages/shared-lib/src/app/schema/`
3. Add an entry to `ROUTE_SCHEMAS` in `route-schemas.ts` with:
   - `request`: Zod schema (if the handler accepts a request body)
   - `response`: TypeScript type name (if the handler returns data)
   - `query`: Array of query parameters (if any)
   - `public`: Set to `true` for unauthenticated routes
4. Run `generate:openapi` to regenerate the spec

If step 3 is skipped, the generator will fail with a manifest mismatch error listing the missing route.

## Verb → HTTP Method Reference

| Verb                                                    | HTTP Method | Path                            | Example                                                   |
| ------------------------------------------------------- | ----------- | ------------------------------- | --------------------------------------------------------- |
| `create`, `confirm`, `add`, `edit`, `request`, `remove` | POST        | `/resource`                     | `POST /easy-genomics/laboratory/create-laboratory`        |
| `list`, `read`                                          | GET         | `/resource` or `/resource/{id}` | `GET /easy-genomics/organization/list-organizations`      |
| `update`, `cancel`                                      | PUT         | `/resource/{id}`                | `PUT /easy-genomics/laboratory/update-laboratory/{id}`    |
| `delete`                                                | DELETE      | `/resource/{id}`                | `DELETE /easy-genomics/laboratory/delete-laboratory/{id}` |

Verbs in the right column automatically append `/{id}` to the path.

## Known Limitations

### 1. Routes with No Response Schema

The following routes have no `response` type in `route-schemas.ts`. The spec emits an empty schema (`{}`) for them,
which provides no type safety for clients:

- All `DELETE` operations: `delete-laboratory`, `delete-organization`, `delete-tag`, `delete-user-request`
- AWS HealthOmics reads: `list-runs`, `read-run/{id}`, `list-private-workflows`, `list-shared-workflows`,
  `list-workflow-versions`, `read-private-workflow/{id}`, `read-workflow-schema/{id}`
- File/upload requests: `add-tags-to-files`, `edit-batch`, `request-laboratory-bucket-objects`,
  `request-file-download-url`, `request-folder-download-job`, `request-folder-download-job-status`,
  `request-list-bucket-objects`, `request-search-bucket-objects`, `request-top-level-bucket-objects`
- Other handlers: `list-buckets`, `request-apply-run-retention-policy`, `request-laboratory-run-status-check`,
  `edit-workflow-access-batch`, `confirm-*`, `create-user-*`

**Improvement:** Add TypeScript types for these handlers' responses and reference them in `route-schemas.ts`.

### 2. POST/PUT Routes with No Request Schema

The following routes are POST or PUT but have no `request` schema in `route-schemas.ts`. The spec omits the request
body; validation is performed in the handler code instead of declaratively:

- `POST /aws-healthomics/workflow/create-private-workflow`
- `POST /aws-healthomics/workflow/create-workflow-upload-request`
- `POST /easy-genomics/laboratory/run/request-apply-run-retention-policy`
- `POST /easy-genomics/laboratory/run/request-laboratory-run-status-check`
- `POST /nf-tower/workflow/create-workflow-execution`
- `PUT /aws-healthomics/run/cancel-run-execution/{id}`
- `PUT /nf-tower/workflow/cancel-workflow-execution/{id}`

**Improvement:** Create Zod schemas for these request bodies and add them to `route-schemas.ts`.

### 3. Response Types as Approximations

Some response types in `route-schemas.ts` are the closest existing type rather than the exact response shape (e.g., a
handler may return a subset or transformed version of the type). Check handler implementations to see the actual
response structure.

## TypeScript Types (API-02)

`easy-genomics-api.yaml` is also the source of truth for TypeScript types via `openapi-typescript`.

### Generated file

`packages/shared-lib/src/app/types/easy-genomics/generated.d.ts` is **committed to git** (following the same convention
as `nextflow-tower-openapi-spec.d.ts`). This means `tsc` can compile all packages without running a generation step
first, and spec-to-type drift shows up in PR diffs.

### How to regenerate types

```bash
# From packages/shared-lib/
pnpm run generate:api-types

# Or regenerate spec + types together:
pnpm run generate:openapi && pnpm run generate:api-types
```

The `generate:api-types` task also runs automatically as part of `nx run shared-lib:build` (wired into `pre-compile`).

### Type alias wrapper

`packages/shared-lib/src/app/types/easy-genomics/easy-genomics-api.ts` re-exports types from `generated.d.ts` under
their original names. Import from this wrapper — not from `generated.d.ts` directly.

```typescript
import { ConfirmUserInvitationRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';
```

Response types and nested utility types that are not cleanly representable in the spec (S3 SDK passthroughs, SNS event
payloads, complex self-referential shapes) are hand-written directly in the wrapper with a comment explaining why.

### How to add types for a new handler

1. Create the handler and add it to `route-schemas.ts` (see above).
2. Run `generate:openapi` then `generate:api-types`.
3. If the new types need friendly re-exports, add aliases to `easy-genomics-api.ts`.

## Out of Scope (Follow-On Tickets)

- **API-03**: Swagger UI / API documentation hosting
- **API-04**: CDK API Gateway integration (automatic routing based on the spec)
- **API-05**: CI breaking-change detection (warn on spec changes during review)
