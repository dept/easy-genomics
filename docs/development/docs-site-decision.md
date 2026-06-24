# Docs Site Tooling Decision — DOCS-06

**Date:** 2026-06-24 **Status:** Complete — GO (open DOCS-07) **Recommendation:** Docusaurus

---

## Summary

Adopt **Docusaurus** as the Easy Genomics documentation site. The repo is public, which qualifies it for Algolia
DocSearch's free tier once a live URL is available. Docusaurus's native `docs:version` CLI is the strongest versioning
story of the four candidates and maps cleanly to the project's existing `v*` git tag release cadence. CDC/WSLH operators
need version-locked docs URLs (e.g. `/v1.3/deployment/upgrading`); Docusaurus delivers that with a single command and no
third-party plugins. The React framework is a context-switch for the Vue 3 frontend team, but most doc authoring is
Markdown — React components are only needed for custom UI, which is rare.

---

## Investigation Findings

### 1. Algolia DocSearch Eligibility

| Factor                | Finding                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Repo visibility       | `PUBLIC` — verified via `gh repo view dept/easy-genomics --json visibility`                                                   |
| Free tier requirement | Publicly accessible site, technical content, "Search by Algolia" logo displayed                                               |
| Pre-launch blocker    | A live URL with domain ownership verification (within 7 days) is required to apply. Cannot apply before the site is deployed. |
| Paid fallback         | Algolia Grow plan: $0.80 per 1,000 crawls above 10,000/month                                                                  |

**Plan:** Launch with Docusaurus's built-in local search (Lunr-based). Apply for DocSearch once the site has a live URL.
No Algolia dependency at launch.

**Free search alternative if DocSearch is rejected:** Pagefind — Rust-based, post-build static index, <300 KB total
payload on a 10,000-page site, ~38 ms query latency, MIT license.

---

### 2. Versioning Workflow Fit

The repo has 8 semver releases: `v1.0.1 → v1.4`. CDC/WSLH installations are pinned to specific releases and need
version-locked documentation URLs.

**Docusaurus native versioning:**

```
npx docusaurus docs:version v1.4
```

This command creates:

- `versioned_docs/version-v1.4/` — complete snapshot of current `docs/`
- `versioned_sidebars/version-v1.4-sidebars.json` — sidebar config snapshot
- Appends `"v1.4"` to `versions.json`

The `docs/` folder is then free to evolve toward the next release. Versions are served at `/v1.4/deployment/upgrading`.
A version-picker dropdown is part of the default theme.

**Cut-a-version runbook (for future owners):**

1. Merge all docs updates for the release to `main`.
2. Run `npx docusaurus docs:version vX.Y` from `packages/docs/`.
3. Commit the three generated files alongside the code release tag.

**Other candidates for comparison:**

| Tool         | Versioning mechanism                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| VitePress    | No native CLI. Requires `@viteplus/versions` plugin (v2.0.6, third-party) or `multiversion-vitepress-build` (git-tag driven, also third-party). |
| Starlight    | `starlight-versions` community plugin — early development, not production-stable.                                                               |
| Plain GitHub | None. No versioned URLs.                                                                                                                        |

---

### 3. nx Monorepo Integration Cost

The project uses **projen** to manage generated files. Direct edits to `pnpm-workspace.yaml`, `nx.json`, and
`.github/workflows/*.yml` are overwritten on the next `pnpm exec projen` run.

**What needs to change in `projenrc.ts`:**

1. Add `packages/docs` to `pnpm-workspace.yaml` — requires modifying the custom `PnpmWorkspace` component at
   `projenrc/pnpm.ts`.
2. Add a `docs:build` / `docs:dev` script to the root — via `root.addScripts({})`.
3. Add a new GitHub Actions workflow for docs deploy — either via a new custom projen component or as an explicitly
   unmanaged file (comment header removed, excluded from `.projenrc.ts` synthesis).

**What does NOT need projen:**

- `packages/docs/project.json` (nx project config) — nx reads this directly; no projen synthesis required.
- `packages/docs/package.json`, `packages/docs/.vitepress/config.ts` — standard files, unmanaged.

**Estimated integration effort:** ~1 day for projenrc wiring and nx targets; ~0.5 day for the GitHub Pages CI workflow.

---

### 4. Candidate Comparison

|                            | Docusaurus                     | VitePress                 | Starlight               | Plain GitHub |
| -------------------------- | ------------------------------ | ------------------------- | ----------------------- | ------------ |
| Framework                  | React                          | Vue 3                     | Astro                   | —            |
| JS bundle (gzip)           | ~174 KB                        | ~807 KB†                  | <50 KB total‡           | —            |
| Build speed (~30–50 pages) | ~15–30 s (v3.6 with Rspack)    | ~8 s                      | Fastest                 | —            |
| Versioning                 | **Native CLI**                 | Third-party plugin        | Early community plugin  | None         |
| Algolia DocSearch          | Native (`preset-classic`)      | Native (theme config)     | Native (plugin)         | —            |
| Local search (no Algolia)  | Built-in (Lunr)                | **Built-in (MiniSearch)** | Built-in                | —            |
| Stack fit (Vue 3 team)     | ✗ React                        | ✓ Vue 3                   | ✗ Astro (3rd framework) | ✓            |
| Community size             | Largest                        | Large                     | Growing                 | —            |
| Handoff risk               | **Lowest** (most widely known) | Medium                    | Medium-high             | n/a          |

† The 807 KB VitePress figure is from a third-party benchmark (pkgpulse.com) and may measure total page transfer rather
than JS-only. Treat as directional. ‡ Starlight's Astro Islands architecture ships zero JS for static content; the <50
KB is total first-visit compressed payload.

**Why Docusaurus wins despite the React/Vue mismatch:** Both audiences (operators and end users) benefit most from
reliable versioned URLs. Docusaurus is the only candidate with production-stable native versioning. React being "the
wrong framework" is a one-time setup cost; most contributors write Markdown, not JSX. Docusaurus also has the largest
community — lowest risk for an unknown handoff.

**Why VitePress was the runner-up:** Vue 3 alignment reduces authoring friction for the current team, and MiniSearch
ships zero-config. Rejected because the versioning story relies on third-party plugins rather than a native CLI, which
adds maintenance surface for future owners who may not be Vue 3 developers.

**Why Starlight was ruled out:** Astro is a third framework alongside Vue 3 (frontend) and Node/CDK (backend). The
versioning plugin is early-stage. Bundle size advantage does not outweigh the ecosystem immaturity and stack
fragmentation.

**Why "plain GitHub" was ruled out:** Confirmed both audiences need features plain GitHub cannot deliver — versioned
URLs for operators, full-text search for end users.

---

### 5. GitHub Pages Deploy Mechanics

No `gh-pages` branch exists. The following would be net-new work.

**Approach:** `peaceiris/actions-gh-pages` action — pushes the Docusaurus build output to the `gh-pages` branch on merge
to `main`.

**Estimated new workflow:**

```yaml
name: deploy-docs
on:
  push:
    branches: [main]
    paths: ['packages/docs/**']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20.15.0, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @easy-genomics/docs build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: packages/docs/build
```

**CI cost:** ~2–3 minutes per docs build (Docusaurus v3.6 with Rspack). Triggered only on changes to `packages/docs/**`
— does not add time to the existing backend/frontend CICD pipeline. This file would be added as an unmanaged workflow
(not synthesized by projen).

---

## Implementation Effort Estimate

| Day | Work                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | `projenrc.ts` changes — add `packages/docs` to pnpm workspace, root scripts, projen re-synthesis                       |
| 2   | Scaffold Docusaurus at `packages/docs/` — `preset-classic`, configure nav/sidebar to mirror existing `docs/` structure |
| 3   | Wire versioning — create initial version snapshot for `v1.4`, test `docs:version` command, write cut-a-version runbook |
| 4   | GitHub Pages CI workflow — test deploy to `gh-pages` branch, confirm live URL                                          |
| 5   | Configure local search (Lunr), submit Algolia DocSearch application, smoke test all doc links                          |

**Total: ~5 days.** Content migration (porting existing markdown into Docusaurus format) is a follow-up ticket.

---

## Risks and Blockers

| Risk                                                                         | Likelihood                                       | Mitigation                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Algolia DocSearch review takes 1–2 weeks                                     | Certain (by design)                              | Launch with Docusaurus built-in Lunr search; swap to Algolia post-approval                                               |
| projen file-ownership trap — direct edits to generated files get overwritten | High if not addressed                            | All changes go through `projenrc.ts`; docs workflow added as unmanaged file with the generated-by header removed         |
| Docusaurus custom components require React knowledge                         | Low — most authoring is Markdown                 | Document in `contributing.md` that custom Docusaurus components use React, not Vue                                       |
| Historical versions (v1.0.1–v1.3.1) have no matching docs content            | Certain — docs were written after those releases | Start versioned docs from `v1.4` (current); document in the cut-a-version runbook that pre-v1.4 versions are not covered |

---

## Go / No-Go

**GO.** Open implementation ticket **DOCS-07** to scaffold the Docusaurus site.

Conditions:

- Scope is scaffold + versioning + CI deploy only. Content migration is a separate ticket.
- Initial search uses Docusaurus built-in Lunr. Algolia DocSearch application submitted once the site is live.
- Versioned docs start at `v1.4`. No retroactive versioning of earlier releases.
