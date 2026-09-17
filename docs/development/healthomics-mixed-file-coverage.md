# HealthOmics coverage prerequisite (mixed-logic files)

Evidence that HealthOmics-only behavior in interleaved HealthOmics/Seqera files is covered before hard Seqera removal.
**No Seqera removal or branch extraction** was done in this work.

| File                                                                      | Existing coverage found                                                                                           | Gap                                                                                                       | Action                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/back-end/.../process-update-laboratory-run.lambda.ts`           | Strong: `getAWSHealthOmicsStatus`, duration, failure fields, status-check pipeline, RUNNING progress, cost attach | Progress failure swallow; terminal skip of `listAllRunTasks`; invalid duration; `UserId` passthrough      | **Tests added** in `process-update-laboratory-run.lambda.test.ts`                                   |
| `packages/back-end/.../process-classify-laboratory-run-failure.lambda.ts` | Strong: lookup, Bedrock, OpenAI + healthomics SSM key, log enrichment on/off                                      | Anthropic + healthomics SSM; missing/throwing SSM keeps lookup; lab not found → lookup                    | **Tests added** in `process-classify-laboratory-run-failure.lambda.test.ts`                         |
| `packages/back-end/.../unified-workflow-catalog-service.ts`               | Thin: one private/shared de-dupe case                                                                             | Skip Omics when disabled; pagination; missing id; name fallback; shared without owner; sort               | **Tests added** in `unified-workflow-catalog-service.test.ts`                                       |
| `packages/back-end/.../run-cost-capture-service.ts`                       | One HealthOmics happy path                                                                                        | Missing `ExternalRunId`; default `cost-capture` user; omit storage; HO early return; unsupported platform | **Tests added** in `run-cost-capture-service.test.ts`                                               |
| `packages/front-end/.../useMultiplatform.ts`                              | None                                                                                                              | HealthOmics → Workflow / Omics WIP routing                                                                | **Tests added** in `test/app/composables/useMultiplatform.test.ts`                                  |
| `packages/front-end/.../stores/run.ts`                                    | None on store (sample-sheet util mocks WIP methods)                                                               | Omics WIP mutate/unset; `omicsRunsForLab`                                                                 | **Tests added** in `test/app/stores/run.test.ts` (loads left as residual — need Nuxt `$api`)        |
| `packages/front-end/.../pages/labs/[labId]/run/[labRunId].vue`            | Playwright e2e 12–13; `run-progress-card-visibility` util                                                         | —                                                                                                         | **Confirmed adequate** for primary detail/file path. Residual: progress poll, retry, failed-task UI |
| `packages/front-end/.../components/EGLabView.vue`                         | e2e enable Omics → tab; launch (08, 11, 14)                                                                       | —                                                                                                         | **Confirmed adequate** for tab gating + launch. Residual: cancel, favourites                        |
| `packages/front-end/.../components/EGFormLabDetails.vue`                  | e2e test 08 Enable HealthOmics                                                                                    | —                                                                                                         | **Confirmed adequate** for enable flag. Residual: VPC / LLM enrichment fields                       |
| `packages/front-end/.../components/EGRunFromDataCollectionModal.vue`      | `run-upload-sample-sheet` util (Omics WIP + `omicsRunTempId` URL)                                                 | —                                                                                                         | **Confirmed adequate** via util helpers the modal uses                                              |
| `packages/front-end/.../components/EGRunFromCollectionsModal.vue`         | None direct                                                                                                       | Inline Omics/Seqera WIP + URL                                                                             | **Gap documented** — residual until removal/refactor or e2e follow-up                               |
| `packages/front-end/.../components/EGDashboard.vue`                       | None                                                                                                              | Omics favourites merge/nav                                                                                | **Gap documented**                                                                                  |
| `packages/front-end/.../components/EGWorkflowLabAccessPage.vue`           | BE/shared access-key tests only                                                                                   | FE `toApiPlatform` / grant-revoke UI                                                                      | **Gap documented**                                                                                  |

## Residual risk (accepted for this ticket)

Vue SFCs were not unit-mounted (no Vue Test Utils in stack; branch extraction out of scope). Hard-removal should not
assume full unit safety for Collections modal, Dashboard, or Workflow Lab Access UI without additional e2e or
post-extraction tests.

## Note on process-update

`process-update-laboratory-run.lambda.ts` required no production code changes in this work — only new HealthOmics
status-check coverage was added in its test file. An earlier merge already restored the type-correct
`buildProgressUpdate` / `updateWithAttributeRemoval` call site.

## Verification

- `pnpm test` in `packages/back-end`
- `pnpm test` in `packages/front-end`
