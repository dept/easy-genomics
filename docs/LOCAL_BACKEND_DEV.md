# Local Back-End Development Setup

#### 1. Deploy the back-end stack (if not already deployed)

You need a deployed dev stack so you can obtain AWS resource identifiers.

```bash
# From repo root
pnpm run build-and-deploy
```

Or deploy only the back-end:

```bash
pnpm run build-back-end
cd packages/back-end && pnpm run deploy
```

#### 2. Create and populate `packages/back-end/.env.local`

```bash
cp packages/back-end/.env.local.example packages/back-end/.env.local
```

Fill in the values. Use this reference:

| Variable                      | How to obtain                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `NAME_PREFIX`                 | `{env-type}-{env-name}` from easy-genomics.yaml (e.g. `dev-demo`)                                  |
| `ACCOUNT_ID`                  | AWS account ID (12 digits)                                                                         |
| `REGION`                      | From easy-genomics.yaml `aws-region`                                                               |
| `DOMAIN_NAME`                 | From easy-genomics.yaml `app-domain-name`                                                          |
| `ENV_TYPE`                    | From easy-genomics.yaml `env-type`                                                                 |
| `ENV_NAME`                    | Config key from easy-genomics.yaml (e.g. `demo`)                                                   |
| `COGNITO_USER_POOL_ID`        | AWS Console → Cognito → User Pools → _{name-prefix}-easy-genomics-auth-user-pool_ → User pool ID   |
| `COGNITO_USER_POOL_CLIENT_ID` | Same pool → App integration → App client ID                                                        |
| `JWT_SECRET_KEY`              | From easy-genomics.yaml `back-end.jwt-secret-key` (must match deployed value)                      |
| `SNS_*_TOPIC`                 | AWS Console → SNS → Topics. Look for `{name-prefix}-easy-genomics-auth-*-topic`                    |
| `COGNITO_KMS_KEY_ID`          | AWS Console → KMS → Customer managed keys → `{name-prefix}-easy-genomics-auth-cognito-idp-kms-key` |
| `COGNITO_KMS_KEY_ARN`         | Same key → ARN                                                                                     |
| `SEQERA_API_BASE_URL`         | Optional. Default: `https://api.cloud.seqera.io`                                                   |

**SNS topic names:**

- `{name-prefix}-organization-deletion-topic`
- `{name-prefix}-laboratory-deletion-topic`
- `{name-prefix}-user-deletion-topic`
- `{name-prefix}-laboratory-run-update-topic`
- `{name-prefix}-user-invite-topic`

#### 3. Generate front-end config (if not already done)

**Prerequisite: AWS credentials.** The script calls AWS (API Gateway and Cognito) to fetch your stack’s API URL and
Cognito IDs. Configure credentials first:

- **Long‑lived credentials:** run `aws configure` and set Access Key ID, Secret Access Key, and Default region (match
  `aws-region` in `easy-genomics.yaml`).
- **AWS SSO:** run `aws sso login` (and set `AWS_PROFILE` if needed).
- **Env vars:** set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` (and `AWS_SESSION_TOKEN` if using
  temporary credentials).

Then from `packages/front-end`, run (optional) `nuxt prepare`, then the settings script:

```bash
cd packages/front-end
pnpm run nuxt-prepare    # optional but fixes ".nuxt/tsconfig.json" warning if you see it
pnpm run nuxt-load-settings
```

This compiles `@easy-genomics/shared-lib` (if needed) and creates `config/.env.nuxt` by querying AWS for API Gateway
URL, Cognito IDs, etc.

#### 4. Point the front-end at the local back-end (when using the local server)

**Option A – Env var (recommended, no file toggling):** Run the dev server with:

```bash
cd packages/front-end
USE_LOCAL_BACKEND=1 pnpm run nuxt-dev
```

Use the deployed API by running `pnpm run nuxt-dev` without the env var. Optional: `LOCAL_API_URL=http://localhost:3002`
if your local server uses a different port.

**Option B – File override:** Copy and edit the local env file so the front-end always uses the local API while the file
exists:

```bash
cp config/.env.nuxt.local.example config/.env.nuxt.local
```

Set `AWS_API_GATEWAY_URL=http://localhost:3001` (no trailing slash). To use the deployed API again, rename or delete
`config/.env.nuxt.local`.

#### 5. (Optional) Add localhost to Cognito callback URLs

For local development, Cognito must allow `http://localhost:3000` (or your dev port) in callback and logout URLs. Update
`easy-genomics.yaml`:

```yaml
callback-urls: 'http://localhost:3000/auth/callback'
logout-urls: 'http://localhost:3000/signin'
```

Then redeploy the back-end so Cognito picks up the new URLs. Alternatively, if you have multiple URLs configured, ensure
localhost is included.

---

## Quick Reference: Switching Between Local and Deployed Back-End

You can switch without renaming or editing files by using an environment variable.

| Mode             | How to run                                                                                                                    | Result                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Deployed API** | `pnpm run nuxt-dev` (from `packages/front-end`)                                                                               | Front-end uses API Gateway URL from `config/.env.nuxt`             |
| **Local API**    | `USE_LOCAL_BACKEND=1 pnpm run nuxt-dev` (macOS/Linux) or set `USE_LOCAL_BACKEND=1` in your shell then run `pnpm run nuxt-dev` | Front-end uses `http://localhost:3001` (or `LOCAL_API_URL` if set) |

Optional: set `LOCAL_API_URL` when using a different port (e.g. `LOCAL_API_URL=http://localhost:3002`). No need to
create or edit `config/.env.nuxt.local` when using the env var.

**Alternative (file-based):** If `config/.env.nuxt.local` exists with `AWS_API_GATEWAY_URL=http://localhost:3001`, the
front-end uses the local server. Delete or rename that file to use the deployed API again.

---

## Phase 2: Local API Server

Phase 2 is implemented in `packages/back-end/src/local-server/`. The server runs Lambda handlers locally and talks to
real AWS (DynamoDB, Cognito, S3, etc.) using `packages/back-end/.env.local`.

### Running the local server

1. Ensure Phase 1 is complete (`.env.local` exists and is populated).
2. From **packages/back-end** (or repo root with `--filter`):

   ```bash
   cd packages/back-end
   pnpm run local-server
   ```

   The server listens on **http://localhost:3001** (or `LOCAL_SERVER_PORT` if set).

3. Run the front-end against it:

   ```bash
   cd packages/front-end
   USE_LOCAL_BACKEND=1 pnpm run nuxt-dev
   ```

**Optional:** `pnpm run local-server:watch` restarts the server when files under `src/local-server` or Lambda handlers
change.

### Troubleshooting

| Symptom                                            | What to check                                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module not found `@BE/*` or `@SharedLib/*`**     | Run the server with `pnpm run local-server` (uses `tsx`). Do not run with plain `node`; path aliases require the TypeScript runner.                                                                                                       |
| **401 Unauthorized**                               | See [401 Unauthorized](#401-unauthorized) below.                                                                                                                                                                                          |
| **DynamoDB or table errors**                       | Verify `NAME_PREFIX` in `.env.local` matches your deployed stack (e.g. `dev-demo`). Table names are `{NAME_PREFIX}-organization-table`, etc.                                                                                              |
| **Region is missing**                              | The local server sets `AWS_REGION` from `REGION` in `.env.local` so the AWS SDK (DynamoDB, S3, etc.) can resolve the region. Ensure `REGION` is set in `packages/back-end/.env.local` (e.g. `us-east-1`).                                 |
| **ExpiredTokenException / security token expired** | This refers to **AWS credentials** (used by the server to call DynamoDB, S3, etc.), not your Cognito login. If you use AWS SSO, run `aws sso login` again; if you use temporary credentials, refresh them. Then restart the local server. |
| **CORS errors in browser**                         | The server allows all origins and credentials. If you use a different front-end origin, ensure it is correct.                                                                                                                             |
| **Missing required env vars**                      | The server exits on startup if `NAME_PREFIX`, `ACCOUNT_ID`, `REGION`, `COGNITO_USER_POOL_ID`, or `COGNITO_USER_POOL_CLIENT_ID` are missing. See `.env.local.example`.                                                                     |

#### 401 Unauthorized

If the front-end is signed in but API calls to the local server return 401:

1. **Cognito IDs must match the front-end**  
   The local server verifies the JWT using `COGNITO_USER_POOL_ID` and `COGNITO_USER_POOL_CLIENT_ID` from
   `packages/back-end/.env.local`. These must be the **same** pool and client the front-end uses to sign in (from
   `config/.env.nuxt`).

   - In `config/.env.nuxt`: `AWS_COGNITO_USER_POOL_ID`, `AWS_COGNITO_USER_POOL_CLIENT_ID`
   - In `packages/back-end/.env.local`: `COGNITO_USER_POOL_ID`, `COGNITO_USER_POOL_CLIENT_ID`  
     Copy the values from `.env.nuxt` into `.env.local` (same pool ID and client ID).

2. **Ensure you are signed in**  
   The front-end only sends a token when the user has a Cognito session. Open the app, sign in, then retry the API call.

3. **Check that the token is sent**  
   In DevTools → Network, select a failing request and confirm the **Request Headers** include
   `Authorization: Bearer <token>`. If it’s missing, the front-end may not have a session (sign in again) or the request
   path may not be going through the repository that adds the token.

4. **See why verification failed**  
   In `packages/back-end/.env.local` set `DEBUG_AUTH=true`, restart the local server, and trigger the request again. The
   server console will log whether the token was missing or JWT verification failed (e.g. wrong issuer, expired, wrong
   client).

5. **Quick local-only bypass (no verification)**  
   For local development only, you can skip JWT verification: in `packages/back-end/.env.local` set
   `SKIP_JWT_VERIFY=true`. The server will decode the JWT and accept it without verifying the signature. Use only in a
   safe local environment.

### process-\* (async) Lambdas

The following Lambdas are **not** exposed as HTTP routes; they run in AWS when SQS or Cognito triggers fire:

- **SQS-triggered:** `process-create-user-invites`, `process-delete-organization`, `process-delete-laboratory`,
  `process-delete-user`, `process-update-laboratory-run`
- **Cognito-triggered:** `process-pre-signup`, `process-post-authentication`, `process-custom-email-sender`,
  `process-pre-token-generation`

When using the local server, these still run in the deployed stack (e.g. user invite emails, org/lab/user deletion
workflows). To test one locally, you can invoke its handler manually with a script; see
[Phase 2 task list (2.9)](./LOCAL_BACKEND_DEV_PHASE2_TASKS.md#task-29--optional-process-async-lambdas) for an optional
approach.

---

**Task list:** [Phase 2 task list (LOCAL_BACKEND_DEV_PHASE2_TASKS.md)](./LOCAL_BACKEND_DEV_PHASE2_TASKS.md) — full
checklist and reference.
