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
