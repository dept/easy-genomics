# Front-End

The Easy Genomics web application, built with Nuxt 3 and Vue 3. It is the user-facing UI for managing organisations,
labs, data uploads, and workflow runs.

## Key directories

| Directory              | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `src/app/pages/`       | File-based routes (Nuxt pages)                        |
| `src/app/components/`  | Reusable Vue components (`EG`-prefixed)               |
| `src/app/stores/`      | Pinia stores — application state and actions          |
| `src/app/composables/` | Shared business logic (`useAuth`, `useMultiplatform`) |
| `src/app/repository/`  | API client modules; all HTTP calls go through here    |

## Layered architecture

Data flows **Pages → Stores → Composables → Repository**. Components never call the repository layer directly — they go
through Pinia stores or composables, and only the repository modules talk to the API. Token refresh is handled centrally
by the repository's `HttpFactory`.

## Running locally

```bash
pnpm dev
```

## Where to look next

- [Documentation index](../../docs/README.md)
- [Contributing guide](../../docs/development/contributing.md)
