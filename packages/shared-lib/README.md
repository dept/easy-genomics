# Shared-Lib

Shared TypeScript types, Zod schemas, utilities, and constants consumed by both the back-end and front-end packages.
Keeping them in one place stops the two apps drifting out of sync on request/response shapes and validation rules.

## Key directories

| Directory            | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `src/app/types/`     | Shared TypeScript types and generated API types                 |
| `src/app/schema/`    | Zod schemas for request/response validation (reused everywhere) |
| `src/app/utils/`     | Shared helpers (`buildResponse`, `HttpError` subtypes, …)       |
| `src/app/constants/` | Shared constant values                                          |

## Generated types

Nextflow Tower / Seqera types and Zod schemas are generated from `src/app/types/nf-tower/seqera-api-latest.yml` via the
projen `nftower-spec-to-zod` script (using `typed-openapi` / `openapi-typescript`). Do not hand-edit the generated files
in `src/app/types/nf-tower/` — regenerate them instead.

> An `src/app/openapi/` layout for the Easy Genomics API spec is planned with API-01; it does not exist yet.

## Error classes

Shared `HttpError` subtypes — `InvalidRequestError`, `NotFoundError`, `UnauthorizedAccessError`, etc. — live in
[`src/app/utils/HttpError.ts`](src/app/utils/HttpError.ts). Throw these (never a bare `Error`) so handlers map them to
the correct EG-xxx code.

## Where to look next

- [Documentation index](../../docs/README.md)
