# Graphify evaluation log (pilot)

Shared record of **A/B comparisons** while we trial Graphify in Easy Genomics. Add a row per test via pull request.

**How to contribute:** Copy the [test protocol](./graphify.md#evaluating-graphify-pilot-test) in `graphify.md`, run both
arms, append your row below, and open a PR.

| Date      | Tester             | Query                                                 | Arm (with / without Graphify) | Time (s) | Tokens (if visible) | Tool calls | Correct files found? | Answer quality (1–5) | Notes                                    |
| --------- | ------------------ | ----------------------------------------------------- | ----------------------------- | -------- | ------------------- | ---------- | -------------------- | -------------------- | ---------------------------------------- |
| _example_ | _jane@example.com_ | _Trace create-laboratory-run to LaboratoryRunService_ | _with_                        | _45_     | _12k_               | _4_        | _yes_                | _4_                  | _MCP query_graph first, then 2 reads_    |
| _example_ | _jane@example.com_ | _Trace create-laboratory-run to LaboratoryRunService_ | _without_                     | _90_     | _28k_               | _11_       | _yes_                | _3_                  | _3 greps + 6 reads before right service_ |

## CLI benchmark snapshots

Paste output of `graphify benchmark graphify-out/graph.json` when the graph is refreshed on `main`:

```text
(paste here)
```

## Summary (maintainers)

_Update when enough entries exist._

| Metric          | With Graphify (avg) | Without (avg) | Verdict |
| --------------- | ------------------- | ------------- | ------- |
| Wall-clock time | —                   | —             | TBD     |
| Reported tokens | —                   | —             | TBD     |
| Tool calls      | —                   | —             | TBD     |
| Answer quality  | —                   | —             | TBD     |

**Decision:** _Keep / adjust / remove integration — TBD after pilot._
