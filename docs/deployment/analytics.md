# Privacy-safe upstream analytics

Easy Genomics can send **anonymous** usage events from a deployment back to the Easy Genomics project's central
analytics (PostHog Cloud, US region). This helps the project make product decisions based on real usage instead of
guesses.

It is **off by default** and built around a **double opt-in**:

1. **The institution opts in** by setting `analytics.enabled: true` in `config/easy-genomics.yaml` and redeploying.
2. **Each end user opts in** by accepting the in-app consent banner. "Reject" and "Accept" have equal weight, and the
   default before a choice is made is _denied_ — nothing is sent until both opt-ins are granted.

> **HIPAA:** the upstream analytics is **not** designed for environments handling PHI. Institutions handling PHI should
> leave analytics disabled.

## What is (and is not) sent

Every event carries only:

- `deployment_id` — a random, anonymous per-deployment identifier. It lets the project count deployments without ever
  learning who they are. It is **not** derived from your AWS account id, domain, hostname, or anything identifying.
- `app_version` (the build number) and `env_type`.
- Coarse, **bucketed** magnitudes (file counts, upload sizes, durations) — never raw values.
- One-way **salted SHA-256 hashes** of user / lab / org / workflow ids, computed in the browser. The salt is
  per-deployment, so the same person at two institutions hashes to two unrelated values.

**Never sent:** emails, names, run names, file names, S3 keys, sample ids, sample-sheet contents, workflow parameters,
free-text search queries, JWTs, raw IPs, AWS account ids, domain names or hostnames.

> **Threat model for the hashed ids.** The per-deployment salt is embedded in the front-end bundle, so it is _not_
> secret from someone who can load that deployment's app and open devtools. Its purpose is **cross-deployment
> unlinkability**: because each deployment uses a different salt, the central PostHog project (and anyone analysing it)
> cannot link the same person across two deployments, and cannot reverse a hash without first obtaining that specific
> deployment's bundle. It does **not** guarantee that a party who already has the deployment's bundle cannot re-identify
> an id that is itself visible in that deployment's UI (e.g. a lab/run UUID in the URL): they could hash the known id
> with the bundled salt and match it. The hashing protects against linkage at the central project and against casual
> reversal, not against a local attacker brute-forcing ids they can already see. If stronger guarantees are required,
> hash identifiers server-side with a key that never reaches the browser.

Analytics is additionally **forced off** when any of the following is true:

- the browser sends `DNT: 1` (Do Not Track) or `Sec-GPC` / Global Privacy Control;
- `env-type` is `dev` (protects local development) — unless `analytics.allow-dev: true` is explicitly set for that
  deployment;
- the user is on `/signin`, `/forgot-password`, `/reset-password` or `/accept-invitation` (these URLs can contain
  emails).

## Enabling it

```yaml
easy-genomics:
  configurations:
    - <env-name>:
        # ... existing settings ...
        analytics:
          enabled: true
          # Optional: also allow analytics when env-type is 'dev' (e.g. a hosted demo).
          # Leave false for local development.
          allow-dev: true
```

Then redeploy. On deploy you'll see a one-time banner confirming analytics is on.

### What gets provisioned

When (and only when) `analytics.enabled: true`:

- **Back-end:** two AWS Secrets Manager secrets holding the random `deployment_id` and the per-deployment `salt`. They
  are generated once and reused on every redeploy.
- **Front-end:** no AWS resources. The browser sends events directly to PostHog (`https://us.i.posthog.com`). Note:
  because requests go to a third-party origin, ad-blockers may drop some events, and any strict Content-Security-Policy
  must allow `*.posthog.com`.

### First-deploy ordering

Deploy the **back-end first** so the identifier secrets exist, then build and deploy the **front-end** (the front-end
build reads the secrets and embeds the anonymous `deployment_id` + `salt` into the bundle). If you build the front-end
before the secrets exist, the build logs a warning and ships a bundle without identifiers — simply redeploy the
front-end once the back-end deploy completes.

## Turning it off

- **Institution-wide:** set `analytics.enabled: false` and redeploy. No events are sent and the SDK is not even loaded.
- **Per user:** toggle it off under **Profile → Privacy**. This flushes any queued events and records the opt-out. The
  choice follows the user across browsers.

## Rotating the deployment identifier

To "start fresh" (new anonymous `deployment_id`), delete the two analytics secrets and redeploy:

```
<envType>-<envName>-easy-genomics-analytics-deployment-id
<envType>-<envName>-easy-genomics-analytics-salt
```

New random values are generated on the next deploy and the front-end build picks them up.

## Project owner responsibilities

The Easy Genomics project (the data controller for cross-deployment telemetry) maintains: a published privacy policy, a
signed DPA with PostHog, a process for subject-access / deletion requests, a 12-month event-retention setting, a named
privacy contact, and PostHog's default bot filtering enabled.
