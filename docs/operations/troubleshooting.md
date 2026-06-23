# Troubleshooting

Diagnosing failures in a deployed Easy Genomics environment: failed deploys, sign-in and invite problems, failed
pipeline runs, and rejected file uploads.

> Running the back-end locally instead? Local-dev issues (module resolution, `401 Unauthorized` against the local
> server, expired AWS credentials) are covered in
> [development/local-backend-dev.md](../development/local-backend-dev.md#troubleshooting).

## How to diagnose any failure

1. **Note the `EG-xxx` code.** Every API error carries one (in the response body and the front-end toast). It tells you
   the HTTP status and the failing domain — see [Reading EG-xxx error codes](#reading-eg-xxx-error-codes).
2. **Read the logs.** The code points at the domain; the logs tell you why — see [Finding logs](#finding-logs).
3. **Match the symptom** to one of the sections below.

---

## Reading EG-xxx error codes

Easy Genomics returns a stable `EG-xxx` application code alongside the HTTP status on every error response. The full
catalogue is in `ERROR_HANDLING.md` (repo root) under **§ Error Code Reference**; HealthOmics run-failure reasons are
under **§ AWS HealthOmics Run Failure Codes**.

**Lookup workflow:**

1. Copy the `EG-xxx` value from the failed request (API response body, or the browser toast / Network tab).
2. Find it in `ERROR_HANDLING.md` → **Error Code Reference**. The row gives you the HTTP status and a one-line meaning.
3. The first digit after `EG-` identifies the domain: `1xx` cross-cutting, `2xx` organization, `3xx` laboratory, `4xx`
   user, `5xx` omics workflow, `6xx` Seqera. Use that to decide which Lambda log group to read (see below).

The codes you will see most often:

| Code   | HTTP | Meaning                                                                 |
| ------ | ---- | ----------------------------------------------------------------------- |
| EG-100 | 400  | Generic / unclassified error — should be rare; check Lambda logs        |
| EG-101 | 404  | Not found                                                               |
| EG-102 | 400  | Invalid request / missing required field                                |
| EG-103 | 403  | Unauthorized access                                                     |
| EG-110 | 409  | Expired organization access — front-end refreshes the token and retries |
| EG-308 | 400  | Laboratory Seqera credentials incorrect                                 |
| EG-315 | 403  | Missing AWS HealthOmics access                                          |
| EG-316 | 403  | Missing Seqera Cloud / Nextflow Tower access                            |
| EG-600 | 400  | Seqera Cloud API error                                                  |

> **EG-110 is expected, not a bug.** It signals the user's org-access token has expired; the front-end catches it,
> refreshes, and retries automatically. You only need to act if requests keep returning EG-110 in a loop (token refresh
> itself is failing — treat it as an auth issue below).

---

## Finding logs

| Source               | Where                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| API Gateway access   | CloudWatch log group for the API stage (JSON-formatted access logs — request path, status, latency)     |
| Lambda handlers      | CloudWatch log group `/aws/lambda/{NAME_PREFIX}-{handler-name}` (e.g. `dev-demo-create-laboratory-run`) |
| HealthOmics run/task | The log stream linked in the run's `statusMessage` (see [Run failures](#run-failures))                  |

> **⚠️ Lambda log retention is one day.** Capture the logs for a failure quickly — by tomorrow they are gone. Logs are
> currently unstructured `console.*` output, so search the relevant group by time window and request path rather than by
> `requestId`/`userId`.

Map the `EG-xxx` domain digit to the handler prefix to find the right group: a `3xx` laboratory error came from a
`*-laboratory-*` handler, a `4xx` user error from a `*-user-*` handler, and so on.

---

## Deploy failures

Setup steps for a production deploy are in [deployment/production.md](../deployment/production.md) and
[deployment/configuration.md](../deployment/configuration.md). This section covers the failures that most commonly
interrupt a deploy.

### 1. CDK bootstrap

| Symptom                                                                                                        | Cause                                                                                 | Fix                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `This stack uses assets, so the toolkit stack must be deployed` / `SSM parameter /cdk-bootstrap/... not found` | The target account/region was never bootstrapped, or the `CDKToolkit` stack is stale. | `pnpm run build-and-deploy` bootstraps automatically. From a CI/CD pipeline the pipeline role must be allowed to create/update the `CDKToolkit` stack — see [production.md § CDK bootstrap](../deployment/production.md#cdk-bootstrap). |

### 2. IAM permissions

| Symptom                                                                       | Cause                                                                                                                                                          | Fix                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AccessDenied` / `is not authorized to perform: <action>` during `cdk deploy` | The deploying principal lacks the broad permissions Easy Genomics needs (it provisions IAM, Lambda, DynamoDB, Cognito, API Gateway, CloudFront, S3, SNS, SQS). | Deploy with `AdministratorAccess` or an equivalent CDK-bootstrap-compatible policy. For pipelines, prefer GitHub Actions OIDC + an IAM role over long-lived keys — see [production.md § IAM permissions](../deployment/production.md#iam-permissions). |

### 3. ACM / Route 53 wiring

| Symptom                                                          | Cause                                                                                                                        | Fix                                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy fails resolving the certificate, or CloudFront rejects it | The ACM certificate is not in `us-east-1`. CloudFront **requires** the cert in `us-east-1` regardless of your deploy region. | Re-request the certificate in `us-east-1` and use that ARN — see [production.md § ACM certificate](../deployment/production.md#3-acm-certificate).                       |
| Certificate stuck in `PENDING_VALIDATION`                        | DNS validation CNAME records are missing or not yet propagated.                                                              | Add the ACM-provided CNAME records to the Route 53 hosted zone (or use ACM's "Create records in Route 53"); wait for `Status: ISSUED`.                                   |
| Custom domain does not resolve after deploy                      | The hosted zone is a subdomain whose NS records were never delegated from the parent zone.                                   | Copy the four NS records from the new hosted zone into the parent zone — see [production.md § Route 53 hosted zone](../deployment/production.md#2-route-53-hosted-zone). |

---

## Auth issues

For local-server `401 Unauthorized`, see
[development/local-backend-dev.md § 401 Unauthorized](../development/local-backend-dev.md#401-unauthorized). In a
deployed environment:

| Symptom                                              | Cause                                                                                                        | Fix                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Sign-in loops or rejects a valid password            | Cognito MFA challenge not completed, or the device/time is out of sync for TOTP.                             | Complete the MFA challenge; if using an authenticator app, confirm the device clock is accurate.                        |
| API calls start returning `401` / EG-103 mid-session | The Cognito access/ID token expired and the session was not refreshed.                                       | Sign out and back in. Persistent expiry points at a clock skew or a Cognito app-client token-validity misconfiguration. |
| EG-110 returned repeatedly                           | Org-access token refresh is failing (normally EG-110 self-heals — see [above](#reading-eg-xxx-error-codes)). | Treat as a token-refresh failure: re-authenticate; if it persists, inspect the auth Lambda logs.                        |
| Invite link returns an error or "expired"            | The invitation token is single-use and time-limited; the link was already used or has lapsed.                | Re-send the invitation from the organization/lab admin screen and use the new link promptly.                            |

---

## Run failures

A pipeline run can fail at **submission** (the wizard's API calls) or **during execution** (on the Seqera or HealthOmics
side).

**Submission failures** surface immediately in the run wizard with a specific message. `ERROR_HANDLING.md` **§ Run
Submission — Per-Step Error Handling** maps each wizard API call to its meaning. The one to watch for: _"Run launched
but failed to record"_ means the run is live on the provider but missing from Easy Genomics — capture the
`externalRunId` from the message before retrying, or you risk a duplicate run.

**Execution failures (AWS HealthOmics):** open the run and read its `failureReason` and `statusMessage`.
`ERROR_HANDLING.md` **§ AWS HealthOmics Run Failure Codes** classifies every `failureReason` and names the owner (Lab vs
Bioinformatician vs transient AWS). Quick triage:

- `IMPORT_FAILED`, `INPUT_URI_NOT_FOUND`, `INVALID_URI_INPUT` → **Lab**: an input S3 path is wrong or the run role can't
  read it.
- `ASSUME_ROLE_FAILED`, `ECR_PERMISSION_ERROR`, `OUT_OF_MEMORY_ERROR`, `WORKFLOW_VER_VALIDATION_FAILED` →
  **Bioinformatician**: run-role trust, container access, or workflow-definition fixes.
- `INSTANCE_RESERVATION_FAILED`, `SERVICE_ERROR` → **transient AWS**: wait and retry.
- `RUN_TASK_FAILED` / `WORKFLOW_RUN_FAILED` → **ambiguous**: the root cause is only in the CloudWatch engine/task log
  stream linked in `statusMessage`. A `statusMessage` naming `SAMPLESHEET_CHECK` points at a data/sample-sheet problem
  rather than a workflow bug.

**Execution failures (Seqera Cloud):** Seqera has no standardised error codes — failures arrive as free-text Nextflow
output in `workflow.errorMessage`. Read that message and the Seqera run logs directly.

**Stuck (not failing, not progressing) runs:** confirm the run's actual state on the provider (HealthOmics `GetRun` /
the Seqera console) rather than trusting the cached Easy Genomics status — a recording failure at submission can leave
the two out of sync.

---

## File upload failures

Easy Genomics validates uploads in the browser before they reach S3; the `create-file-upload-sample-sheet` Lambda
applies the same sample-sheet rules server-side.

**Sequencing data files** (`EGRunFormUploadData`):

| Message                                                                | Cause                                          | Fix                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `File <name> is not a .gz file`                                        | Only gzipped FASTQ (`.gz`) files are accepted. | Upload the gzipped files (e.g. `..._R1_001.fastq.gz`).    |
| `File <name> is too small` / `too large … Maximum allowed size is 5GB` | Files must be between 1 byte and 5 GB.         | Re-check the file; split or re-export anything over 5 GB. |

For paired-end reads, the two files of a pair must share the same sample-ID prefix (e.g.
`GOL2051A67473_S133_L002_R1_001.fastq.gz` and `…_R2_001.fastq.gz`) so they are grouped correctly.

**Sample sheets** (CSV):

| Message                                                       | Cause                                                        | Fix                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `Only CSV files are accepted as sample sheets.`               | The file is not a `.csv`.                                    | Export the sample sheet as CSV.                                    |
| `The sample sheet file is empty` / `missing a header row`     | The CSV has no content or no header line.                    | Ensure the first non-empty line is a header row with column names. |
| `Sample sheet validation failed — check the required format.` | The CSV failed validation (empty, unreadable, or no header). | Open the CSV, confirm it has a header row and data, and re-upload. |

> The uploaded sample-sheet S3 object name must not contain spaces. Easy Genomics derives a safe
> `samplesheet[-<run>].csv` key automatically, so a run name with spaces is fine — but a manually supplied filename with
> spaces or unusual characters is normalised or rejected.

---

## Still stuck?

If the `EG-xxx` code, the run `failureReason`, and the CloudWatch logs don't explain it, capture all three (plus the
`externalRunId` for run failures) before they age out of the one-day log retention, and escalate with that evidence.
