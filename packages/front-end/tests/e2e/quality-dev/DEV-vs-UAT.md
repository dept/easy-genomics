# Quality environments: dev vs UAT — differences and test fixes

This document records what we observed when building the scripted Playwright flow in `omics-run-creation.spec.ts` against **quality.dev** and **quality.uat**, and why the test was changed. It is meant for anyone maintaining or extending `tests/e2e/quality-dev/`.

**Current default target:** `https://quality.uat.easygenomics.org` (UAT).

---

## 1. Environment configuration

| Item | Quality **dev** (earlier runs) | Quality **UAT** (current default) |
|------|-------------------------------|-----------------------------------|
| Base URL | `https://quality.dev.easygenomics.org` | `https://quality.uat.easygenomics.org` |
| Sign-in | `/signin` | `/signin` |
| Email | `admin@easygenomics.org` | `admin@easygenomics.org` |
| Password | `123456!Qa` | `EasyGenomicsUAT2026!` |
| Lab context (observed) | Varied by session | e.g. **Test Laboratory** dashboard after login |
| S3 sample-sheet paths | Dev bucket/prefix | UAT pre-prod bucket (e.g. `s3://pre-prod-quality-easy-gen-...`) |

Override any value with env vars: `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, etc. (see spec header).

**Why defaults moved to UAT:** Recording and final validation were done on UAT; credentials and URL were updated in the spec defaults accordingly.

---

## 2. Lab navigation — HealthOmics Workflows

### What we saw

| Aspect | Dev (older layout) | UAT (current layout) |
|--------|--------------------|----------------------|
| Control type | Top/tab control with stable id `#tab-omicsWorkflows` | Left **sidebar** item: `button` labeled **HealthOmics Workflows** |
| Playwright locator that worked on dev only | `page.locator('#tab-omicsWorkflows')` | **Not present** — 45s timeout waiting to scroll into view |
| Playwright locator that works on UAT | Same tab role may exist on some builds | `getByRole('button', { name: 'HealthOmics Workflows' })` |

### Test fix

```ts
const healthOmicsNav = page
  .getByRole('button', { name: 'HealthOmics Workflows' })
  .or(page.getByRole('tab', { name: 'HealthOmics Workflows' }))
  .or(page.locator('#tab-omicsWorkflows'));
```

**Why:** One locator chain supports **sidebar (UAT)**, **tab role (lab-manager style tests)**, and **legacy id (dev)** without forking the spec.

### Extra timing (both environments)

- **1.5s `UI_LOAD_PAUSE_MS`** before clicking HealthOmics Workflows, after the control is visible — lets the lab shell finish rendering lists/nav.
- **1.5s pause** before clicking the **viralrecon-workflow** row, after the row is visible — same reason on the workflows table.

These are separate from **1.5s `VIS_PAUSE_MS`** around **button** clicks (Sign in, Upload Files, Launch, etc.).

---

## 3. Opening the workflow

| Aspect | Dev | UAT |
|--------|-----|-----|
| Action | Click table row matching `viralrecon-workflow` | Same |
| Locator | `getByRole('row', { name: /viralrecon-workflow/i })` | Same |

No structural difference found for this step; UAT only needed the pre-click UI load pause above.

---

## 4. Run wizard — DOM and locators

The run wizard (`run-workflow/[workflowId].vue`) uses the same steps on both environments, but **how much of the DOM is mounted at once** differs in practice.

### 4.1 Single active step vs multiple steps in DOM

| Behavior | Dev (typical) | UAT (observed) |
|----------|---------------|----------------|
| Wizard panels | Often one step’s content mounted (`v-if` on `selectedStepIndex`) | **Several steps’ markup present at once** (e.g. 4× `#dropzoneFiles`, 4× `input` fields) |
| Symptom | `toHaveCount(1)` on `#dropzoneFiles` passes | **Strict mode violation** — count 4 |
| Symptom | `getByLabel('input')` unique | **4 elements** — Run Details, Upload, Edit Parameters, Review |

**Why it matters:** Playwright strict mode requires unambiguous locators. Duplicate ids/labels across hidden or off-screen panels break naive selectors.

### 4.2 Fixes applied in the spec

| Problem | Fix | Why |
|---------|-----|-----|
| Multiple `#dropzoneFiles` | `page.locator('#dropzoneFiles').first()` + `toBeAttached()` (not `visible`) | File input is **hidden**; must not use `filter({ visible: true })` |
| Multiple buttons (Upload Files, Next step, Save & Continue, Launch) | `visible(locator).first()` or `.last()` where needed | Target the **visible** step’s control |
| Multiple Save & Continue | `.first()` on run-details step, `.last()` on parameters step | First = step 01, last = step 03 when several exist in DOM |
| Multiple `input` / `outdir` labels | `getByRole('textbox', { name: 'input*' })` and `'outdir*'` | Required-field labels are unique among parameter fields |
| Review step heading in DOM but hidden | Wait for `Launch Workflow Run` **visible**, not `getByText('Selected Workflow Parameters')` | Heading existed in DOM but was **hidden** while still on parameters |

### 4.3 `input` and `outdir` parameters

| Topic | Dev (during test development) | UAT / app fix |
|-------|------------------------------|---------------|
| After upload + Next step | `input` and `outdir` sometimes **empty** on Edit Parameters — blocked Save & Continue | Auto-populated from sample sheet (S3 URLs visible) |
| Test workaround (removed) | Manual fill from **Copy URL** button | **Removed** — user confirmed app bug fixed |
| Current test behavior | N/A | **Assert only:** `toHaveValue(/s3:\/\//)` on `input*` and `outdir*`; fill only `genome`, `protocol`, `primer_set_version`, `primer_set`, `platform` |

**Why assert instead of fill:** Ensures the fix is live without overwriting auto-filled values (which had caused review/launch failures when the form overwrote the store with empty strings).

---

## 5. Steps that behaved the same on dev and UAT

These did not need environment-specific locators (beyond `visible()` where UAT mounts multiple panels):

- Login (Email / Password, Sign in)
- Run name textbox + Save & Continue (step 01)
- Upload via `#dropzoneFiles` + `setInputFiles` (six FASTQ fixtures)
- Upload Files → wait for Next step → slow scroll → Next step
- Edit Parameters: five viralrecon fields
- Save & Continue (parameters) → Launch Workflow Run
- Success: **Back to Runs** → 2s delay → click → 5s hold for video

---

## 6. Review / launch step quirks (both environments)

| Issue | What happened | Test response |
|-------|---------------|---------------|
| Tab advances to Review but content blank | Stepper showed **Review Pipeline** with empty body; Launch not found | Longer waits for spinner cleared, `Step 04`, then **Launch Workflow Run** visible |
| `Selected Workflow Parameters` assert | Element in DOM but **hidden** | Stopped using it; use **Launch Workflow Run** visibility instead |

These may be timing or a front-end issue when all steps stay mounted; the test waits for visible launch UI rather than hidden copy.

---

## 7. Timing and recording conventions

Not dev-vs-UAT specific, but part of the final spec:

| Constant | Value | Use |
|----------|-------|-----|
| `VIS_PAUSE_MS` | 1500 | Before/after **button** clicks only |
| `UI_LOAD_PAUSE_MS` | 1500 | Before HealthOmics nav and workflow row click |
| `TYPE_DELAY_MS` | 80 | Slow typing on **inputs** (no extra click pauses) |
| `PARAMS_REVIEW_PAUSE_MS` | 5000 | Hold on parameters before Save & Continue |
| `BEFORE_BACK_TO_RUNS_MS` | 2000 | After launch success, before clicking Back to Runs |
| `END_SCREEN_PAUSE_MS` | 5000 | After Back to Runs, hold for recording |
| `UPLOAD_COMPLETE_TIMEOUT_MS` | 180000 | Wait for Next step after upload (6 files) |

### Playwright config (`playwright.config.ts`)

| Mode | Settings |
|------|----------|
| Headed (local) | `headless: false`, `video: 'off'` — use `--headed` |
| Headless HD recording | `headless: true`, `deviceScaleFactor: 2`, viewport **1920×1080**, `video: { mode: 'on', size: { width: 1920, height: 1080 } }` |

**Video note:** Headed recording sometimes showed gray padding; headless + forced video size avoided that on dev/UAT recordings.

---

## 8. Application UI reference (why UAT differs)

UAT lab page uses **`EGSidebarNav`** for lab sections (`EGLabView.vue`), not the older tab strip with `#tab-omicsWorkflows`. Newer builds use:

```vue
<EGSidebarNav :items="tabItems" ... />
```

Older or alternate layouts still expose **HealthOmics Workflows** as a **tab** or `#tab-omicsWorkflows`. The test’s `.or()` chain is intentional compatibility, not duplication.

---

## 9. Quick reference — run commands

```bash
cd packages/front-end

# UAT (defaults in spec)
npx playwright test tests/e2e/quality-dev/omics-run-creation.spec.ts \
  --config tests/e2e/quality-dev/playwright.config.ts

# Dev (override env)
E2E_BASE_URL=https://quality.dev.easygenomics.org \
E2E_PASSWORD='123456!Qa' \
npx playwright test tests/e2e/quality-dev/omics-run-creation.spec.ts \
  --config tests/e2e/quality-dev/playwright.config.ts --headed

# Headless HD video (config default)
npx playwright test tests/e2e/quality-dev/omics-run-creation.spec.ts \
  --config tests/e2e/quality-dev/playwright.config.ts
# → video under test-results/.../video.webm
```

---

## 10. Summary table

| # | Difference | Dev | UAT | Test change |
|---|------------|-----|-----|-------------|
| 1 | Base URL / password | dev host + `123456!Qa` | uat host + `EasyGenomicsUAT2026!` | Env defaults in spec |
| 2 | HealthOmics entry | `#tab-omicsWorkflows` | Sidebar `button` | Combined `.or()` locator |
| 3 | Wizard DOM | Usually single step | Multiple steps in DOM | `visible()`, `.first()` / `.last()` |
| 4 | File dropzone | One `#dropzoneFiles` | Four in DOM | `.first()`, attached not visible |
| 5 | input/outdir | Sometimes empty (bug) | Auto-filled S3 URLs | Assert only; removed manual fill |
| 6 | Parameter fields | Same labels | Same + duplicate hidden copies | `input*` / `outdir*` textbox roles |
| 7 | Review step | Launch sometimes missing / blank | Same risk | Wait Launch visible; spinner cleared |
| 8 | UI settle before nav | — | Heavier shell | 1.5s UI load pauses |
| 9 | End of test | — | — | 2s → Back to Runs → 5s hold |

---

*Last updated to match `omics-run-creation.spec.ts` and successful UAT headless HD run (launch + Back to Runs + final hold).*
