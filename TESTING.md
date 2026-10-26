# Manual test log

Running log of manual testing for changes whose error paths are not covered by the E2E suite. See
[Testing expectations](docs/development/contributing.md#testing-expectations). Happy paths belong in the Playwright E2E
suite; this file records the manual verification that sits outside it.

Each entry lists the change, the steps, and the outcome. Leave steps unchecked until they have actually been run, and
record the environment and date alongside the result.

---

## Migrate front-end auth from Amplify JS v5 to v6

Amplify JS v5 reaches end of support on 1 March 2027. The front-end used Amplify only for Cognito auth, across 6 files
and 11 `Auth.*` call sites. This change moves to `aws-amplify` v6 and drops `amazon-cognito-identity-js` and the unused
`@aws-amplify/ui-vue`.

Auth call sites now have unit coverage in `test/app/composables/useAuth.test.ts`, `test/app/repository/factory.test.ts`,
`test/app/stores/labs.test.ts`, `test/app/plugins/amplify.test.ts`, and the auth utils under `test/app/utils/`
(`auth-guard`, `amplify-auth-config`, `amplify-oauth-storage`, `string-utils`). End-to-end sign-in and Google SSO still
need a deployed Cognito pool.

Code constraints from the migration spike (full Q&A lives in the feature spec, not this repository):

- `getRefreshedToken` throws when Amplify returns no tokens after refresh, otherwise the Bearer header is dropped.
- Concurrent EG-110 retries share one module-scoped refresh in `factory.ts` so the token-store write is not raced.
- The OAuth listener is imported in `plugins/amplify.ts` before `Amplify.configure`.
- Sign-in distinguishes `NotAuthorizedException` on `error.name`, not `error.code`.

### Automated checks

| Check                                                                               | Result                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm lint` (front-end)                                                             | Passes                                                                            |
| `pnpm test` (front-end)                                                             | Passes                                                                            |
| `npx nuxt build` (production)                                                       | Succeeds                                                                          |
| `grep -rn "amazon-cognito-identity-js\|@aws-amplify/ui-vue" packages/front-end/src` | No matches                                                                        |
| `npx tsc --noEmit`                                                                  | 43 pre-existing `TS6059` rootDir warnings about test files; none from this change |

### Manual steps

Run against a deployed environment with a real Cognito pool. Not yet executed. Google SSO, password sign-in, token
refresh, route guards, session carry-over, and `pnpm run test-e2e` on quality are merge-blocking. The boxes below cover
runtime verification only; Jest/lint/build are recorded in Automated checks.

- [ ] **Password sign-in, correct credentials** — sign in at `/signin`; lands on `/labs` with orgs loaded.
- [ ] **Password sign-in, wrong credentials** — shows "Incorrect email or password. Please try again.", _not_ the
      generic network toast. Covered by unit tests; still confirm in the browser.
- [ ] **Google SSO** — "Sign in with Google" completes through `auth/callback.vue` and lands on `/`. Confirm in the
      network tab that a request to `/oauth2/token` is actually made. **Test a production build, not `nuxt dev`.** The
      listener lives in `plugins/amplify.ts` (eager entry, before `Amplify.configure`); `/auth/callback` is exempt from
      the route guard. Failed exchange toasts and redirects to `/signin` (`handleOAuthCallback`, unit-tested).
- [ ] **Abandoned Google SSO** — click "Sign in with Google", then Back from the hosted UI. Password sign-in and
      navigation must not hang. Amplify's 5-minute `inflightOAuthDeadline` is the backstop; the app does not clear
      Amplify's inflight flag from other tabs. Do not start a second-tab sign-in while consent is still open.
- [ ] **Transparent token refresh** — with a session open, wait for the ID token to expire (or shorten pool token
      validity), then navigate. The user stays signed in, is not bounced to `/signin`, and sees no error toast.
- [ ] **Concurrent refresh** — trigger parallel requests that hit an `EG-110` retry (e.g. switch organisation, then
      immediately navigate). Amplify de-dupes the Cognito call; `factory.ts` serialises the token-store write across
      HttpFactory subclasses (unit-tested).
- [ ] **Sign out** — `signOut` → `/signin` clears the user store, resets analytics, and shows no spurious error toasts
      (the EGV-231 regression).
- [ ] **Route guarding** — signed-in on `/signin` → `/labs`; signed-out on an authed page → `/signin`;
      `/accept-invitation` and `/reset-password` token handling; superuser `/admin` redirects; `/auth/callback` is not
      bounced to `/signin` mid-exchange. Covered by `test/app/utils/auth-guard.test.ts`; still confirm in the browser.
- [ ] **Session after deploy** — confirm an existing v5 session either continues or asks for a single sign-in, then
      persists. Do not treat a forced re-login as guaranteed until this has been checked against a real pool.
- [ ] **Full E2E suite** on `quality` across all four user types (`pnpm run test-e2e`). Google SSO happy path stays
      manual-only (hosted UI); no Playwright case in this change.

### Operator comms (paste at v1.6 deploy)

Draft release-note text is in `CHANGELOG.md` under `[Unreleased]`. Paste the following into the operator Slack channel
when this front-end ships:

> _Easy Genomics — Amplify v6 auth upgrade (v1.6)_
>
> The next front-end deploy upgrades the Cognito client library (Amplify JS v5 → v6). After deploy, **you may be asked
> to sign in once**. Existing sessions are expected to carry over; if you are signed out, sign in again and the session
> should persist as before.
>
> No accounts, passwords, or data are affected.
>
> If someone is bounced to `/signin` on every subsequent page load, that is _not_ this migration — escalate it as a
> token-storage regression. Google SSO should still complete through `/auth/callback` onto `/`.
>
> No Cognito / CDK / user-pool change. Support line if asked: “authentication library upgrade — sign in if prompted, no
> other action needed.”

---

## Run result export APIs (backend)

Preview, enqueue, and poll endpoints copy or zip outputs from completed laboratory runs. There is no UI on this branch,
so Playwright E2E is deferred to the front-end follow-up. Unit tests cover auth 403, source/destination lab-prefix
confinement, ZIP size, empty output, expiry, SQS worker failure paths, lab manager/technician grants, IAM, and multipart
copy ranges. The worker uses a per-job FIFO group and a DLQ (`maxReceiveCount: 3`) so one large copy cannot block the
lab for a day. Expired `.exports/` jobs/archives are swept on the next enqueue.

### Manual steps

Run against a deployed environment with at least two completed runs in one lab. Not yet executed.

- [ ] **Preview** — POST `/laboratory/run/request-run-export-preview` for completed runs; `CanDownloadAsZip` is true
      under 5 GB and false above it; `work/` and `.exports/` objects are omitted.
- [ ] **Unauthorized caller** — a user without org/lab access gets 403 on preview, enqueue, and status; no SQS message.
- [ ] **Cross-lab source** — a completed run whose `OutputS3Url` sits under another org/lab prefix is rejected (403);
      listing/copy does not run.
- [ ] **ZIP download** — enqueue `Destination: Download`, poll status until COMPLETED, download the presigned ZIP.
      Single-run filename includes the run name; files sit under one `{runName}-{runId}/` folder.
- [ ] **S3 copy** — enqueue without `DestinationPrefix`; objects land at `{org}/{lab}/exports/{runName}-{runId}/...`
      (not a double-nested run folder). Custom prefixes stay under the lab root and still get a per-run subfolder.
- [ ] **ZIP over 5 GB** — enqueue Download for oversized output returns 400; S3/LIMS still works.
- [ ] **Expired job** — after one hour, status poll returns 400 and the archive/status objects are deleted.
- [ ] **Cleanup sweep** — request a second export after the first ZIP expires; the previous archive under
      `.exports/archives/` is gone.
- [ ] **Large S3 copy timeout** — a huge multi-run S3 export fails with a timeout message rather than leaving PROCESSING
      forever; other labs/jobs can still enqueue.
- [ ] **E2E** — add a Playwright happy path (preview → enqueue → status) with the UI PR.

---

## Workflow key outputs (declare, download, deliver)

Lab managers declare glob patterns per HealthOmics workflow, pin matching files on a completed run, and optionally copy
them to an external `s3://` prefix when a run succeeds. Unit tests cover pattern matching, delivery enqueue/copy,
destination URI validation, technician-vs-manager delivery auth, and protected lab-data prefixes. Playwright E2E for the
happy path is still outstanding (declare → download on a completed run → save delivery destination).

### Manual steps

Run against a deployed environment with a completed HealthOmics run that has output files. Not yet executed.

- [ ] **Declare** — on a completed HealthOmics run Files tab, define key outputs from suggested groups and save; they
      appear for later runs of the same workflow.
- [ ] **Technician declare** — a technician can save key outputs while delivery is off.
- [ ] **Technician blocked when delivery is on** — with delivery enabled, a technician save of key outputs returns 403.
- [ ] **Invalid delivery URI** — `https://…` or `s3:///incoming` on the deliver page is rejected and not saved.
- [ ] **Lab-data prefix blocked** — a destination under `{orgId}/{labId}/` is rejected (400) and the worker will not
      copy there.
- [ ] **Foreign output prefix** — a run whose OutputS3Url sits outside `{OrganizationId}/{LaboratoryId}/` cannot list or
      deliver key outputs.
- [ ] **Download** — Download all / per-role zip works under the 1000-file-per-role cap and the 2000-key zip-all cap;
      above either cap the UI toasts instead of silently omitting files.
- [ ] **Empty matches** — a pattern that matches nothing on this run shows zero files; zip is not offered.
- [ ] **Unauthorized delivery page** — a technician cannot save the S3 destination.
- [ ] **Failed enqueue** — if SQS delivery enqueue fails after the run is already COMPLETED, a status-check retry still
      delivers (notification is not stamped until enqueue succeeds).
- [ ] **E2E** — add a lab-manager Playwright spec: declare key outputs from a completed HealthOmics run, download from
      the panel, save a delivery destination.

---

## Create HealthOmics workflow — preselected parameter file

The parameter selector defaults to "Upload JSON file" (`FILE`). The ZIP and JSON inputs are native file inputs, so
choosing a file does not emit a `UForm` change event. Create Workflow stayed disabled until the user opened that
dropdown and chose FILE again. `onWorkflowZipChange` and `onParameterTemplateFileChange` in
`EGCreateOmicsWorkflowForm.vue` now call `validate(path, { silent: true })` on the form ref, which reruns the existing
validator and updates `canSubmit`.

Front-end Jest cannot mount this component. There is no Playwright spec for create-workflow. The steps below are the
manual check.

### Manual steps

Sign in as a lab manager or above, against a lab that can create HealthOmics workflows. Not yet executed (15 Oct 2026) —
this environment has no local Nuxt config and no signed-in session.

- [ ] **Valid files, FILE left selected** — open Create Workflow, enter a name, leave "Upload JSON file" selected,
      upload a `.zip` then a `.json`. Create Workflow enables without opening the parameter dropdown.
- [ ] **Wrong parameter extension** — upload a non-`.json` parameter file. Create Workflow stays disabled, and the
      parameter file field shows an error.
- [ ] **Wrong ZIP extension** — upload a non-`.zip` definition. Create Workflow stays disabled, and the ZIP field shows
      an error.

---

## Data Collections — samples made only of FASTA files (EGV-331)

A sample holding only FASTA files was saved as `single_end`, so launching it failed with "Single-end sample requires at
least one FASTQ file." The Assembled preset's `assembly_fasta` column was never filled. This change adds an `assembled`
layout and a "One sample per FASTA file" grouping preset. The sheet maps `assembled` samples, and `single_end` samples
holding only FASTA, to `assembly_fasta`. A FASTA-only sample in a collection with a required read column gets an error
that names the mismatch. Unit tests in shared-lib cover grouping, layout and role mapping for `.fa`, `.fasta`, `.fna`
and `.fa.gz`. There is no Playwright spec for the import wizard or launch.

### Automated checks

| Check                    | Result                                            |
| ------------------------ | ------------------------------------------------- |
| `pnpm lint` (all three)  | Passes                                            |
| `pnpm test` (shared-lib) | 381 tests pass, including `openapi-guard.test.ts` |
| `pnpm test` (back-end)   | 1370 tests pass                                   |
| `pnpm test` (front-end)  | 350 tests pass                                    |

### Manual steps

Run on 16 Oct 2026 with Playwright, against the branch's front-end and local back-end (`dev-demo` stack). Signed in as
the lab-manager test user, in Test Laboratory. Test files: `WI-01.fasta`, `WI-02.fa`, `WI-03.fna`, `WI-04.fa.gz`,
`WI-05.fasta`.

- [x] **Group with the FASTA preset** — Import data, Upload from computer, all 5 files, then **One sample per FASTA
      file**. The regex fills with no typing, and 5 files give 5 samples.
- [x] **Review counts** — with WI-05 excluded, Review shows "0 paired · 0 single-end · 4 assembled" and no "needs
      review". Each row's status is `assembled`.
- [x] **Stored layout** — the 4 created samples list as `Layout: assembled`, `ContentsSummary: 1 file`.
- [x] **Assembled launch** — an Assembled collection of the 4 samples, then Launch Workflow, then Continue. No error,
      and the run wizard opens with the sheet as `input`. The sheet is `sample,fasta` with one row per sample, and the
      URIs end in `.fasta`, `.fa`, `.fna` and `.fa.gz`.
- [x] **Mismatch** — the same 4 samples in a Paired collection. Continue returns 400 EG-102, and the toast reads "WI-02:
      this sample holds an assembled genome (FASTA) and no FASTQ reads, but column "fastq_1" needs reads. Use a sequence
      collection with the Assembled preset." The run wizard does not open.
- [x] **Manual build pre-selects assembled** — Files tab, WI-05.fasta, Build sample manually. The layout is pre-selected
      as "Assembled genome (FASTA)".
- [x] **Fallback for a FASTA-only `single_end` sample** — WI-05 saved as Single-end, then put in an Assembled collection
      and launched. The request returns 200 and the sheet row is `WI-05,s3://…/WI-05.fasta`.
- [x] **FASTQ unchanged** — paired fixtures `NA1287820K_R1_001.fastq.gz` and `_R2_` with the default preset. Review
      shows "1 paired · 0 single-end" and no assembled count. A Paired collection launches with `sample,fastq_1,fastq_2`
      and R1 and R2 in place.
- [x] **Upload picker accepts `.fna`** — found during this run: the upload input's `accept` list omitted `.fna`, so the
      file dialog could not pick one (drag and drop worked). The list now includes `.fna`, and the running wizard reads
      `.fastq,.fq,.gz,.fasta,.fa,.fna,.fa.gz`.

---

## Data Collections — import wizard "Folder" field, blank in an allowed folder (EGV-329, EGV-334)

The S3 source step's "Prefix" field is now labelled "Folder", and the listing notices say "folder". When Search in is an
allowed folder, Folder may be left blank to list the allowed folder itself, and the import label defaults to that
folder's name. In this lab's own folder, a Folder that is blank, spaces only or slashes only still disables Continue.
Front-end unit tests cover the Continue rule, the label default and the notice copy. There is no Playwright spec for the
import wizard.

### Automated checks

| Check                   | Result         |
| ----------------------- | -------------- |
| `pnpm lint` (front-end) | Passes         |
| `pnpm test` (front-end) | 365 tests pass |

### Manual steps

Run on 19 Oct 2026 with Playwright, against the branch's front-end and local back-end (`dev-demo` stack). Signed in as
the lab-manager test user in Test Laboratory, and as the system-admin test user for S3 access. Test files:
`NA1287820K_R1_001.fastq.gz` and `_R2_` in `egv-329-qa/` at the root of the dev-demo lab bucket, set as the lab's
allowed folder for the run.

- [x] **Copy** — the field reads **Folder**, with hint "inside this lab's folder" and placeholder `sequencing/run-1/`.
      `does-not-exist` → Continue shows "No files found in s3://…/does-not-exist/ — check the bucket and folder." No
      wizard step from Source to Confirm contains the word "prefix".
- [x] **Lab folder, blank** — with Search in = This lab's folder, a Folder that is empty, spaces only, `/`, or a slash
      with spaces around it shows the `*` and "Enter a folder to continue.", and Continue is disabled.
- [x] **Lab folder, typed** — `aws-healthomics/` lists 128 files. The listing request's `S3Prefix` is
      `{org}/{lab}/aws-healthomics/`, the same as on `development`, and the back-end is unchanged.
- [x] **Allowed folder, blank** — with Search in = `egv-329-qa/`: no `*`, no help line, hint "optional, inside
      egv-329-qa/", and Searches `s3://851725267090-dev-demo-lab-bucket/egv-329-qa/`. The same holds for spaces only,
      `/`, and a slash with spaces around it.
- [x] **Allowed folder import** — Continue lists the 2 top-level files as 1 paired sample. Confirm shows Source
      `s3://…/egv-329-qa/` and batch `egv-329-qa`. The import succeeds; `CopyJobs[].DestKey` is
      `{org}/{lab}/imports/egv-329-qa/NA1287820K_R1_001.fastq.gz` (and `_R2_`), and both copies exist in S3.
- [x] **Switching back** — with Folder blank, Search in → This lab's folder brings back the `*` and the help line, and
      Continue disables. Back to the allowed folder enables it. Changing the bucket and back resets Search in to This
      lab's folder, with Continue disabled.
- [x] **Clean up** — the allowed folder is cleared (the lab's grants read `allowedPrefixes: {}` again) and `egv-329-qa/`
      at the bucket root is deleted. The imported sample (batch `egv-329-qa`) and its `imports/egv-329-qa/` copies stay:
      samples can't be deleted, and the sample points at the copies.

---

## Data Collections — import wizard skips grouping for FASTA-only listings (EGV-332)

When a listing has FASTA files and no FASTQ, the import wizard applies the "One sample per FASTA file" preset and goes
from Source straight to Tags. Back still reaches Group files with that preset selected. Review hides the paired and
single-end counts and lists the files that matched nothing. A truncated listing never skips. FASTQ, mixed FASTA + FASTQ
and other-file listings keep the grouping step as before. Unit tests in shared-lib and front-end cover the detection and
the skip rule. There is no Playwright spec for the import wizard.

### Automated checks

| Check                               | Result         |
| ----------------------------------- | -------------- |
| `pnpm lint` (shared-lib, front-end) | Passes         |
| `pnpm test` (shared-lib)            | 402 tests pass |
| `pnpm test` (front-end)             | 365 tests pass |

### Manual steps

Run on 19 Oct 2026 with Playwright, against the branch's front-end and local back-end (`dev-demo` stack), stacked on
#985. Signed in as the lab-manager test user, in Test Laboratory. S3 test folders under the lab's `egv-332-qa/`:
`fasta/` (`WI-01.fasta`, `WI-02.fa`, `WI-03.fna`, `WI-04.fa.gz`, `WI-01.fasta.fai`, `WI-02.fa.gz.md5`), `fastq/`
(`NA1287820K_R1_001.fastq.gz` and `_R2_`), `mixed/` (the same R1 and R2 plus `ref.fa`) and `bam/` (`QA-01.bam`). Upload
files: `E332-01.fasta`, `E332-02.fa`, `E332-03.fna` and `E332-04.fa.gz`.

- [x] **S3, FASTA with sidecars** — `fasta/` → Continue lands on Tags. Review shows "4 assembled" with no paired or
      single-end chip, and the unmatched notice lists `WI-01.fasta.fai` and `WI-02.fa.gz.md5`.
- [x] **Step stays reachable** — Back from Tags opens Group files with "One sample per FASTA file" selected ("From 6
      files → 4 samples"). Editing the regex to `(?<sample>WI-0[12])\.(?:fasta|fa)$` changes Review to "2 assembled".
- [x] **Re-list FASTQ** — back to Source, then `fastq/`. Group files opens on "R1 and R2 (any separator)", and Review
      shows "1 paired · 0 single-end".
- [x] **Mixed, unchanged** — `mixed/` opens Group files on the default preset with `ref.fa` unmatched. Review shows "1
      paired · 0 single-end".
- [x] **BAM only, unchanged** — `bam/` opens Group files on the default preset with 0 samples and `QA-01.bam` unmatched.
- [x] **Upload, FASTA only** — the 4 E332 files → Upload & continue lands on Tags, and Review shows "4 assembled".
      Create 4 samples sends `Layout: "assembled"` for each, and batch `egv-332-qa-upload` lists E332-01 to E332-04.
- [x] **Launch** — an Assembled collection of the 4 samples, then Launch Workflow, then Continue. The run wizard opens,
      and the sheet is `sample,fasta` with one row per sample, ending in `.fasta`, `.fa`, `.fna` and `.fa.gz`. No run
      was submitted.
- [ ] **Truncated listing** — covered by its unit test only; a 5000-key folder isn't worth building for QA.
- [x] **Clean up** — the collection and the `egv-332-qa/` S3 folder are deleted. The 4 samples stay, since samples can't
      be deleted.

## Data Collections — FASTA files imported together with FASTQ reads (EGV-340)

In a listing with FASTQ, a FASTA whose name without its extension is a sample ID, in the same folder, joins that sample
when it has both an R1 and an R2. The sample is saved as `paired_end_with_extras`. Any other FASTA joins no sample: a
notice on Group files and Review lists its S3 URI with a copy button, for use as a workflow parameter. Review counts
paired samples that gained a FASTA. Gzipped FASTA files reach a Reference FASTA sheet column. The Playwright spec
`lab-manager/Data_Collections_Import_Fasta_With_Fastq.spec.e2e.ts` covers the upload path up to Review.

### Automated checks

| Check                                                                  | Result                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `pnpm lint` (shared-lib, front-end)                                    | Passes                                         |
| `pnpm test` (shared-lib)                                               | 439 tests pass                                 |
| `pnpm test` (front-end)                                                | 384 tests pass                                 |
| `pnpm test` (back-end, pre-commit hook)                                | 1377 tests pass                                |
| `Data_Collections_Import_Fasta_With_Fastq.spec.e2e.ts` (local, branch) | Passes, with the lab name set to the local lab |

### Manual steps

Run on 26 Oct 2026 with Playwright, against the branch's front-end and local back-end (`dev-demo` stack). Signed in as
the lab-manager test user, in Test Laboratory. S3 test folder under the lab's `egv-340-qa/`: `A_R1.fastq.gz`,
`A_R2.fastq.gz`, `A.fasta`, `B_R1.fastq.gz`, `B_R2.fastq.gz`, `B.fa.gz` and `ref.fa`. Upload files: the same four FASTQ
files plus `ref.fa`; `C_R1.fastq.gz` and `C_R2.fastq.gz`; `D1.fasta` and `D2.fasta`.

- [x] **S3, same-name and shared FASTA** — `egv-340-qa/` → Group files shows "From 7 files → 2 samples" and a notice
      listing only `s3://<lab bucket>/<org>/<lab>/egv-340-qa/ref.fa`, with a copy button. Review shows "2 paired · 2
      with FASTA": A holds `A_R1`, `A_R2` and `A.fasta`; B holds `B_R1`, `B_R2` and `B.fa.gz`.
- [x] **Saved samples** — Copy & create 2 samples (batch `egv-340-qa-s3`) saves A and B as `paired_end_with_extras`, "3
      files · R1 + R2 + ref". The six read and FASTA files are copied to `{org}/{lab}/imports/egv-340-qa/`; `ref.fa` is
      not copied.
- [x] **Launch** — a collection of A and B with the Paired preset plus a custom `fasta` column (role Reference FASTA),
      then Launch Workflow, then Continue. The sheet is `sample,fastq_1,fastq_2,fasta`, with `A.fasta` and `B.fa.gz` in
      the `fasta` column. No run was submitted.
- [x] **Upload, shared FASTA** — the four FASTQ files plus `ref.fa` → "From 5 files → 2 samples". The notice lists
      `ref.fa` at its lab-bucket key under `aws-healthomics/<transaction>/`. Review shows "2 paired" with no FASTA
      count.
- [x] **Upload, FASTQ only, unchanged** — `C_R1` and `C_R2` → "From 2 files → 1 samples", no notice, Review "1 paired".
- [x] **Upload, FASTA only, unchanged** — `D1.fasta` and `D2.fasta` → the wizard lands on Tags, and Review shows "2
      assembled" with no notice.
- [ ] **Illumina-style names** — not handled: the sample ID keeps the `_S1_L001` suffix, so `A.fasta` stays shared.
      Covered by a unit test; follow-up ticket pending the client's file names.
- [x] **Clean up** — the collection and the `egv-340-qa/` S3 folder are deleted. Samples A and B stay, since samples
      can't be deleted, and the files from the three uploads stay in the lab bucket as unlinked files.
