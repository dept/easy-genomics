# Easy Genomics — AI contributor guide

Authoritative context for humans and AI assistants working in this repo. Pair this with the Graphify knowledge graph
(`graphify-out/`) and `.cursor/rules/`.

## What this is

Open-source web app for genomic analysis workflows on **AWS HealthOmics** and **Seqera (Nextflow Tower)**. Initiative of
WSLH, AWS HealthOmics, and CDC. Deployed on AWS (CDK/CloudFormation). Monorepo: **pnpm**, **Nx**, **Projen**.

## Repository layout

| Path                                | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `packages/back-end/`                | Lambda handlers, domain services, CDK infra                                 |
| `packages/front-end/`               | Nuxt 3 SPA (`ssr: false`), Pinia stores, Vue components                     |
| `packages/shared-lib/`              | Shared types, Zod schemas, OpenAPI generator, CDK constructs                |
| `docs/`                             | Human docs: getting-started, deployment, development, operations            |
| `config/easy-genomics.example.yaml` | Deployment config template (real `config/easy-genomics.yaml` is gitignored) |
| `graphify-out/`                     | Committed knowledge graph for codebase navigation                           |

## Back-end domain boundaries

Handlers and services are split under `packages/back-end/src/app/`:

| Domain              | Folder                                                      | Owns                                                                                       |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **easy-genomics**   | `controllers/easy-genomics/`, `services/easy-genomics/`     | Labs, orgs, users, runs (app-level), files, uploads, data collections, sequence sets, tags |
| **aws-healthomics** | `controllers/aws-healthomics/`, `services/aws-healthomics/` | HealthOmics workflows, runs, private workflows                                             |
| **nf-tower**        | `controllers/nf-tower/`, `services/nf-tower/`               | Seqera Cloud / Nextflow Tower pipelines and workflow launches                              |

**Rule:** App-specific lab/run UX → `easy-genomics`. AWS Omics API integration → `aws-healthomics`. Seqera/Tower API →
`nf-tower`. Cross-cutting AWS helpers (S3, SNS, SSM, STS) → `packages/back-end/src/app/services/` root.

Infrastructure: `packages/back-end/src/infra/` (stacks, constructs, Lambda wiring).

## Front-end layout

- `src/app/pages/` — Nuxt routes (e.g. lab run workflow under `labs/[labId]/`)
- `src/app/components/` — Vue SFCs (`EG*` prefix for shared UI)
- `src/app/stores/` — Pinia state
- `src/app/repository/modules/` — API client modules (`labs.ts`, `omics-runs.ts`, `seqera-runs.ts`,
  `data-collections.ts`, …)
- `src/app/composables/` — shared Vue composables

API calls go through repository modules, not raw `fetch` in components.

## shared-lib

- **Zod schemas:** `packages/shared-lib/src/app/schema/`
- **Types:** `packages/shared-lib/src/app/types/`
- **HTTP errors:** `packages/shared-lib/src/app/utils/HttpError.ts`
- **Response helpers:** `packages/shared-lib/lib/app/utils/common.ts` (`buildResponse`, `buildErrorResponse`)
- **OpenAPI:** Generated from handlers — see `packages/shared-lib/src/app/openapi/README.md`. Do **not** hand-edit
  `easy-genomics-api.yaml`.

Import aliases: `@BE/*`, `@FE/*`, `@SharedLib/*` (see root `tsconfig.json`).

## Lambda handler pattern

1. Thin handler in `controllers/**/\*.lambda.ts` (target ≤ ~50 lines of logic).
2. Parse body with Zod schema from `shared-lib`; `safeParse` failure → `InvalidRequestError`.
3. Authorize with `packages/back-end/src/app/utils/auth-utils.ts`.
4. Delegate to a `*Service` class in `services/`.
5. `return buildResponse(200, JSON.stringify(data), event)` or `buildErrorResponse(err, event)` in `catch`.

Event-driven handlers (`process-*`, `confirm-*` without REST verb) are **not** in the public OpenAPI spec.

## Authorization

JWT Cognito claims include `OrganizationAccess` (JSON). Use helpers in `auth-utils.ts`:

- `validateSystemAdminAccess`
- `validateOrganizationAdminAccess`
- `validateOrganizationAccess` — any active lab member in org
- `validateLaboratoryManagerAccess` / `validateLaboratoryTechnicianAccess`

Fail closed → `UnauthorizedAccessError` (403). Laboratory feature flags (e.g. `NextFlowTowerEnabled`) are on the
`Laboratory` record. Integration tokens (Seqera, GitHub) live in SSM under
`/easy-genomics/organization/{orgId}/laboratory/{labId}/`.

## Error handling

See [ERROR_HANDLING.md](./ERROR_HANDLING.md). Summary:

- Throw typed subclasses of `HttpError` from `HttpError.ts` — never bare `new Error()`.
- Lambdas: `catch (err) { return buildErrorResponse(err, event); }`
- Do not swallow errors silently.

## Key user flows (starting points)

| Flow                             | Back-end entry                                          | Front-end entry                                        |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Create lab run                   | `create-laboratory-run.lambda.ts`                       | `pages/labs/[labId]/run-workflow/`                     |
| HealthOmics run                  | `aws-healthomics/run/create-run-execution.lambda.ts`    | `repository/modules/omics-runs.ts`                     |
| Seqera launch                    | `nf-tower/workflow/create-workflow-execution.lambda.ts` | `repository/modules/seqera-runs.ts`                    |
| Data collections / sequence sets | `controllers/easy-genomics/data-collections/`           | `EGDataCollectionsExplorer.vue`, `data-collections.ts` |
| File upload                      | `controllers/easy-genomics/upload/`                     | `EGRunFormUploadData.vue`                              |

Use `graphify query "<flow>"` before reading dozens of files.

## Navigation for AI assistants

1. **Graphify first** (structure): `graphify query "…"` or MCP `graphify` server — see `.cursor/rules/graphify.mdc`.
2. **This file** (semantics, conventions, domain ownership).
3. **Targeted Read/Grep** only after oriented.
4. **Docs** for deploy/upgrade: `docs/deployment/upgrading.md` (data-loss hazard), `docs/getting-started/`.

After code edits: `graphify update .` (AST-only, no API key).

## Coding principles

- Match existing patterns; reuse `shared-lib` schemas/services before adding new ones.
- **DRY, KISS, SOLID** — business logic in services, not handlers.
- **Minimize noise** — small diffs, read only what you need.
- Projen generates config — edit `.projenrc.ts` / `projenrc/`, then `pnpm exec projen`.
- Branch names: `feat/`, `fix/`, etc. (see `docs/development/contributing.md`).
- JIRA tickets use `EG-XXX` in branch/commits when applicable.

## Testing

- Unit tests: Jest next to handlers/services (`packages/back-end/test/`, etc.)
- E2E: Playwright in `packages/front-end/test/e2e/` (`pnpm test-e2e` from root)
- Pre-commit runs back-end unit tests via Husky.

## Do not

- Edit generated OpenAPI YAML or `generated.d.ts` by hand.
- Put AWS SDK calls directly in handlers (use services).
- Commit `config/easy-genomics.yaml` or secrets.
- Assume meetings or informal docs in the graph — graph is **code** (+ optional `docs/` after `pnpm graphify:docs`).
