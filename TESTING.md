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

Auth has no unit-test coverage (deliberately out of scope for this change — writing tests against v5 immediately before
deleting v5 is wasted effort), so verification here is manual plus the E2E suite.

### Automated checks

| Check                                                                               | Result                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm lint` (front-end)                                                             | Passes                                                                            |
| `pnpm test` (front-end)                                                             | Passes — 26 suites, 220 tests                                                     |
| `npx nuxt build` (production)                                                       | Succeeds                                                                          |
| `grep -rn "amazon-cognito-identity-js\|@aws-amplify/ui-vue" packages/front-end/src` | No matches                                                                        |
| `npx tsc --noEmit`                                                                  | 43 pre-existing `TS6059` rootDir warnings about test files; none from this change |

### Manual steps

Run against a deployed environment with a real Cognito pool. Not yet executed.

- [ ] **Password sign-in, correct credentials** — sign in at `/signin`; lands on `/labs` with orgs loaded.
- [ ] **Password sign-in, wrong credentials** — shows "Incorrect email or password. Please try again.", _not_ the
      generic network toast. This is the v6 error-shape change (`error.name`, previously `error.code`); a regression
      here shows up as the wrong toast rather than an outright failure.
- [ ] **Google SSO** — "Sign in with Google" completes through `auth/callback.vue` and lands on `/`. Confirm in the
      network tab that a request to `/oauth2/token` is actually made. **Test a production build, not `nuxt dev`** — the
      OAuth-listener failure mode is a tree-shaking one and does not reproduce in dev.
- [ ] **Transparent token refresh** — with a session open, wait for the ID token to expire (or shorten pool token
      validity), then navigate. The user stays signed in, is not bounced to `/signin`, and sees no error toast.
- [ ] **Concurrent refresh** — trigger parallel requests that hit an `EG-110` retry (e.g. switch organisation, then
      immediately navigate). Confirm only one Cognito refresh call is issued. Amplify does _not_ de-duplicate these
      internally; `HttpFactory.refreshToken` is what prevents a double refresh.
- [ ] **Sign out** — `signOut` → `/signin` clears the user store, resets analytics, and shows no spurious error toasts
      (the EGV-231 regression).
- [ ] **Route guarding** — signed-in on `/signin` → `/labs`; signed-out on an authed page → `/signin`;
      `/accept-invitation` and `/reset-password` token handling; superuser `/admin` redirects.
- [ ] **Forced re-login on deploy** — confirm an existing v5 session is signed out once after deploy, and only once.
- [ ] **Full E2E suite** on `quality` across all four user types (`pnpm run test-e2e`).

### Operator comms (paste at v1.6 deploy)

The spike confirmed existing sessions are invalidated. Draft release-note text is in `CHANGELOG.md` under
`[Unreleased]`. Paste the following into the operator Slack channel when this front-end ships:

> *Easy Genomics — Amplify v6 auth upgrade (v1.6)*
>
> The next front-end deploy upgrades the Cognito client library (Amplify JS v5 → v6). After deploy, **every currently
> signed-in user will be signed out once** and must log in again. That is expected: v6 does not recognise v5 session
> keys.
>
> No accounts, passwords, or data are affected. After that one sign-in, sessions persist as before.
>
> If someone is bounced to `/signin` on every subsequent page load, that is *not* this migration — escalate it as a
> token-storage regression. Google SSO should still complete through `/auth/callback` onto `/`.
>
> No Cognito / CDK / user-pool change. Support line if asked: “authentication library upgrade — sign in once, no other
> action needed.”

### Spike findings

The migration spike's questions, answered against `aws-amplify@6.22.0` / `@aws-amplify/auth@6.21.1`.

**1. Does `fetchAuthSession({ forceRefresh: true })` fully replace `getRefreshedToken()`?** Yes. It returns a freshly
minted ID token from the same Cognito user pool, so the API Gateway authorizer accepts it unchanged. One behavioural
difference matters: when the refresh token is rejected, Amplify resolves with _no_ tokens instead of throwing
(`TokenOrchestrator.handleErrors` returns `null` for `NotAuthorizedException`). `getRefreshedToken` therefore checks for
a missing token explicitly and throws, otherwise the Bearer header would be dropped silently.

**2. Does v6 de-duplicate concurrent refreshes? Can the `tokenRefreshPromise` wrapper in `factory.ts` be deleted?** No,
and no — **the wrapper must stay.** `TokenOrchestrator.getTokens()` calls `refreshTokens()` directly with no in-flight
promise; its only in-flight guard (`waitForInflightOAuth`) covers the OAuth redirect, not refresh. Every concurrent
`fetchAuthSession({ forceRefresh: true })` issues its own Cognito call. This is not merely wasteful: v6 lists
`RefreshTokenReuseException` ("refresh token invalidated by rotation") among the errors it treats as fatal and clears
the session for, so under refresh token rotation concurrent refreshes can sign the user out. The wrapper is protective,
not an optimisation.

**3. Does `signInWithRedirect({ provider: 'Google' })` preserve the flow, and does `auth/callback.vue` still complete
the code exchange?** The redirect itself ports cleanly, but **the callback does not — this was the one call site with no
like-for-like replacement.** In v5, `Auth.currentAuthenticatedUser()` completed the exchange as a side effect of the
`Auth` singleton's listener. v6 has no such singleton: the exchange is a side effect of the module imported by
`signInWithRedirect` (`signInWithRedirect.mjs` imports `enableOAuthListener.mjs`). If that module does not reach the
callback route's bundle, the `?code=` param is never exchanged, no `/oauth2/token` request is made, and
`getCurrentUser()`/`fetchAuthSession()` hang or reject with no diagnostic.

In the current chunk layout this happens to be safe — `signin.vue` imports `signInWithRedirect` and `useAuth` imports
`signOut` (which pulls the same module via `completeOAuthSignOut`), and both land in the shared vendor chunk the
callback route imports. That is incidental to how Nuxt is chunking today, and the failure is silent and production-only,
so `callback.vue` imports `aws-amplify/auth/enable-oauth-listener` explicitly. This is the safeguard AWS documents for
multi-page apps. The callback also uses `fetchAuthSession` rather than `getCurrentUser`, because `getTokens()` parks on
the in-flight OAuth flow before reading tokens.

**4. Does the `Amplify.configure` shape translate cleanly? Does any CDK output or env var need renaming?** No renaming
is needed, but a **type change does** bite. v6 nests config under `Auth.Cognito` with `userPoolClientId` and
`loginWith.oauth` (and infers region from the user pool ID), which is a mechanical translation. However, v6 requires
`redirectSignIn`/`redirectSignOut` to be `string[]` where v5 accepted a string. `nuxt-load-configuration-settings.ts`
writes these into the generated `.env` by interpolating an array, so they arrive as a comma-separated _string_. Passing
that straight through breaks the OAuth redirect, so the plugin now splits on commas. This one is easy to miss because it
only affects the SSO path.

**5. Does the v5 → v6 storage-key change sign every existing user out on deploy?** Expected yes — one forced re-login.
v6 reworked token storage and does not migrate v5 keys. Confirm on deploy (manual step above) and call it out in the
v1.6 release notes and the operator Slack message. Note that v6.22 already defaults to `localStorage` via
`CognitoUserPoolsTokenProvider`, matching v5, so no explicit `setKeyValueStorage` wiring is needed — the cookie-storage
default reported against early v6 releases does not apply.

**6. Does `error.code === 'NotAuthorizedException'` still discriminate a wrong password?** No. v6 surfaces the Cognito
exception on `error.name`; `error.code` is `undefined`, so the check silently fell through to the generic network toast.
`useAuth.signIn` now tests `error.name`.

**7. Is the `@aws-amplify/storage>fast-xml-parser` pnpm override still needed?** No — it is now dead config and has been
removed. It existed because `@aws-amplify/storage@5.9.12` pinned `fast-xml-parser@^4.2.5`, which needed a floor
(`>=4.5.5`) to clear the 4.x CVEs while staying below the breaking 5.x. v6's `@aws-amplify/storage@6.17.0` moved to
`^5.7.2`, which the existing repo-wide `"fast-xml-parser": ">=5.7.0"` override already covers.

**8. Does the react-native peer subtree disappear on v6?** No. `react-native@0.75.4` is still resolved in
`pnpm-lock.yaml` after the upgrade. `@aws-amplify/auth@6.21.1` declares `@aws-amplify/react-native` as an _optional_
peer, so the subtree is not pulled in by Amplify's own dependency edges, but it remains in the lockfile. Shrinking it is
not something this change can deliver.
