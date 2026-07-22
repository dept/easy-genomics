# Production Deployment Runbook

This runbook is for deploying Easy Genomics into a **clean production AWS account** for the first time. Follow every
section in order before running the deploy command.

**Not what you need?**

- Upgrading an existing production deployment → [`upgrading.md`](./upgrading.md)
- Setting up a dev or pre-prod environment → [`../getting-started/install.md`](../getting-started/install.md)

**Before you start:** satisfy the tooling prerequisites in
[`../getting-started/prerequisites.md`](../getting-started/prerequisites.md) (`git`, `nvm`, `node v20`, `pnpm`).

---

## 1. AWS account prerequisites

### Dedicated account

Use a **separate AWS account** for production, isolated from any development or test accounts. This is the strongest
guard against configuration drift or accidental changes reaching production data.

### IAM permissions

The deploying principal (user, role, or pipeline role) needs **`AdministratorAccess`** or an equivalent CDK
bootstrap-compatible policy. Easy Genomics provisions IAM roles, Lambda functions, CloudFormation nested stacks,
DynamoDB tables, Cognito User Pools, API Gateway, CloudFront, S3, SNS, and SQS — broad permissions are required.

For CI/CD pipelines, OIDC-based keyless authentication (e.g. GitHub Actions OIDC + IAM role) is recommended over
long-lived access keys.

### CDK bootstrap

CDK bootstrap runs automatically as the first step of `pnpm run build-and-deploy`. No manual step is needed. If running
from a CI/CD pipeline, the pipeline role must have permission to create and update the `CDKToolkit` stack.

### Supported regions

Any AWS region where
[AWS HealthOmics is available](https://docs.aws.amazon.com/general/latest/gr/healthomics-quotas.html). Set `aws-region`
in `easy-genomics.yaml` to match. The S3 lab bucket and API Gateway will be deployed into the same region.

> **Note:** The ACM certificate for the CloudFront distribution must be in `us-east-1` regardless of your deployment
> region — see [Section 4](#4-acm-certificate) below.

---

## 2. Route 53 hosted zone

Easy Genomics requires a Route 53 public hosted zone to wire the custom domain for the CloudFront distribution.

### 2.1 Create the hosted zone

In the AWS console (Route 53 → Hosted zones → Create hosted zone), create a public hosted zone for your app domain, for
example `genomics.mylab.org`.

Alternatively, using the AWS CLI:

```bash
aws route53 create-hosted-zone \
  --name genomics.mylab.org \
  --caller-reference "$(date +%s)"
```

The response includes the hosted zone ID in the form `Z0123456789ABCDEFGHIJK`.

### 2.2 NS delegation (subdomain only)

If the domain is a subdomain of a parent zone managed elsewhere, copy the four NS records from the new hosted zone and
add them as NS records in the parent zone. This delegates DNS authority for the subdomain to Route 53.

### 2.3 Record the hosted zone ID

You will need the **Hosted Zone ID** in [Section 5](#5-easy-genomicsyaml-production-values).

---

## 3. ACM certificate

Easy Genomics uses CloudFront for the front-end, and CloudFront requires the ACM certificate to be in **`us-east-1`**
regardless of your deployment region.

### 3.1 Request the certificate

1. In the AWS console, switch to the **US East (N. Virginia) / us-east-1** region.
2. Open **Certificate Manager → Request a certificate**.
3. Choose **Request a public certificate**.
4. Enter the domain name (e.g. `genomics.mylab.org`). Adding a wildcard (`*.genomics.mylab.org`) is optional.
5. Choose **DNS validation**.

Using the AWS CLI (must specify `--region us-east-1`):

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name genomics.mylab.org \
  --validation-method DNS
```

### 3.2 DNS validation

After requesting the certificate, ACM provides one or more CNAME records that prove domain ownership.

- **Console shortcut:** if your hosted zone is in the same account, ACM shows a **"Create records in Route 53"** button
  that adds the CNAME records automatically.
- **Manual:** copy the CNAME name and value from ACM and add them to the Route 53 hosted zone created in Section 2.

### 3.3 Wait for Issued status

Validation typically completes in 1–5 minutes once the DNS records propagate.

```bash
aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/... \
  --query 'Certificate.Status' \
  --output text
# Expected: ISSUED
```

### 3.4 Record the certificate ARN

You will need the **Certificate ARN** (format: `arn:aws:acm:us-east-1:…:certificate/…`) in
[Section 5](#5-easy-genomicsyaml-production-values).

---

## 4. `easy-genomics.yaml` production values

Copy the example config and edit it for your production environment:

```bash
cp config/easy-genomics.example.yaml config/easy-genomics.yaml
```

Use the following template for a production deployment. Lines marked `# PROD:` are the key differences from a dev or
pre-prod configuration.

```yaml
easy-genomics:
  configurations:
    - mylab: # env-name: short slug identifying your deployment (e.g. 'cdc', 'wslh', 'mylab')
        aws-account-id: '123456789012'
        aws-region: 'us-east-1' # region where AWS HealthOmics is available in your account
        env-type: 'prod' # PROD: required — prevents CloudFormation from destroying any resource
        app-domain-name: 'genomics.mylab.org' # must match your Route 53 hosted zone domain

        aws-hosted-zone-id: 'Z0123456789ABCDEFGHIJK' # PROD: required — from Section 2
        aws-certificate-arn: 'arn:aws:acm:us-east-1:123456789012:certificate/...' # PROD: required — from Section 3; must be us-east-1

        # Optional: Google SSO — leave all four fields empty to disable Google sign-in
        # google-client-id:
        # google-client-secret:
        # cognito-domain-prefix:
        # callback-urls: 'https://genomics.mylab.org/auth/callback'
        # logout-urls: 'https://genomics.mylab.org/signin'

        back-end:
          jwt-secret-key: 'your-strong-random-secret' # PROD: set explicitly — do not leave empty (random default is not stable across deploys)
          seqera-api-base-url: # Optional: only for self-hosted Seqera instances; defaults to https://api.cloud.seqera.io
          github-pat-secret-name: # Optional: AWS Secrets Manager secret name for a GitHub PAT (Contents: Read-only) used to fetch nf-core workflow schemas

          sys-admin-email: 'admin@mylab.org' # Required: email address for the initial system administrator account
          sys-admin-password: 'Your$ecure1!' # Required: min 8 chars, at least 1 uppercase, 1 lowercase, 1 number, 1 special character


          # PROD: the following test seed accounts must be absent or commented out.
          # They seed test users on every deploy and are for dev/pre-prod environments only.
          # org-admin-email:
          # org-admin-password:
          # lab-manager-email:
          # lab-manager-password:
          # lab-technician-email:
          # lab-technician-password:
```

### Key differences from dev / pre-prod

| Field                 | Dev                   | Pre-prod              | **Prod**                                 |
| --------------------- | --------------------- | --------------------- | ---------------------------------------- |
| `env-type`            | `'dev'`               | `'pre-prod'`          | **`'prod'`** — stack cannot be destroyed |
| `aws-hosted-zone-id`  | Optional              | Required              | **Required**                             |
| `aws-certificate-arn` | Optional              | Required              | **Required** (must be `us-east-1`)       |
| `jwt-secret-key`      | Can be empty (random) | Can be empty (random) | **Must be set explicitly**               |
| Test seed accounts    | Included              | Included              | **Must be absent**                       |

> **Schema note:** `easy-genomics.yaml` is validated against a strict Zod schema at deploy time. Unrecognized keys at
> the top level cause the deploy to fail. Do not add keys that are not in the template above.

---

## 5. Account isolation

### Recommended: separate AWS account

Running production in its own AWS account provides the strongest isolation:

- IAM and resource boundaries are enforced at the account level — no policy misconfiguration can let a dev process reach
  production data.
- Billing, CloudTrail, and CloudWatch are scoped to production only, making audits and cost tracking simpler.

### `env-type: 'prod'` safety property

Setting `env-type` to `'prod'` is the in-code safety net: the CDK app will refuse to destroy any CloudFormation resource
in a prod stack, even if `cdk destroy` is run. DynamoDB tables also have deletion protection and point-in-time recovery
enabled automatically in `prod`.

### Stack naming convention

The `env-name` slug you choose (e.g. `cdc`) combines with `env-type` to form all stack and resource name prefixes:

```
prod-cdc-main-back-end-stack
prod-cdc-main-front-end-stack
prod-cdc-easy-genomics-api-stack
prod-cdc-organization-table
...
```

Choose a short, lowercase, hyphen-free slug that identifies your organization or deployment.

### No required account structure

Easy Genomics does not prescribe how many accounts you use or how they are organized. If your organization has an
existing AWS account governance model (AWS Organizations, Control Tower, landing zones), Easy Genomics fits into it as a
standard CDK application.

---

## 6. Run the deployment

Configure AWS credentials before deploying — see [`aws-setup.md`](./aws-setup.md).

Then, from the repository root, choose the path that matches your setup:

<details>
<summary><strong>Option A — Manual deploy (local machine or AWS CloudShell)</strong></summary>

```bash
pnpm run build-and-deploy
```

CDK bootstrap runs automatically on the first deploy. The command builds and deploys both the back-end and front-end
stacks. On success, the final output includes the application URL:

```
Outputs:
prod-mylab-main-front-end-stack.ApplicationUrl = https://genomics.mylab.org
prod-mylab-main-front-end-stack.HostingBucketName = genomics.mylab.org
```

If `aws-hosted-zone-id` and `aws-certificate-arn` are correctly configured, `ApplicationUrl` will be your custom domain
over HTTPS. If they are missing or invalid, the URL falls back to the raw CloudFront distribution domain.

</details>

<details>
<summary><strong>Option B — CI/CD pipeline (GitHub Actions or equivalent)</strong></summary>

The deploy command is the same (`pnpm run build-and-deploy`). To wire it into a pipeline:

1. **Credentials:** configure the pipeline role with `AdministratorAccess`. OIDC-based keyless auth (GitHub Actions
   OIDC + an IAM role with a trusted GitHub Actions subject condition) is preferred over long-lived access keys.

2. **Secrets:** do not commit `easy-genomics.yaml` to the repository. Store sensitive values (`jwt-secret-key`,
   `sys-admin-password`) in your pipeline's secret store (GitHub Actions Secrets, AWS Secrets Manager, etc.) and write
   `easy-genomics.yaml` at deploy time from those values.

3. **Environment variables:** the pipeline job needs `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` +
   `AWS_DEFAULT_REGION` (or the OIDC equivalent) before running `pnpm run build-and-deploy`.

See `.github/workflows/cicd-release-*.yml` in this repository for reference workflow patterns used by the Easy Genomics
team.

</details>

---

## 7. Post-deploy smoke test checklist

Run these checks immediately after a successful first deploy:

- [ ] `ApplicationUrl` opens in a browser and shows the Easy Genomics login page over HTTPS
- [ ] The SSL certificate is valid — browser shows the lock icon for your custom domain
- [ ] Log in with `sys-admin-email` / `sys-admin-password` — the first login prompts for a password change
- [ ] Create an organization — confirms DynamoDB write, Cognito, and API Gateway are all functional
- [ ] Create a laboratory inside the organization — confirms the laboratory service stack is reachable
- [ ] Open CloudWatch → Log Groups, filter by `prod-{env-name}` — no `ERROR`-level entries at startup
- [ ] (If AWS HealthOmics workflows are planned) Confirm the HealthOmics service is accessible in your chosen region
      from this account — some regions require explicit service opt-in

---

## 8. Cost Explorer (run cost billing) — one-time enablement

Easy Genomics can show **billed** per-run cost from AWS Cost Explorer after HealthOmics runs are tagged with `RunId`
(and related cost allocation tags). This is a **manual, account-level** setup.

Pre-run estimates and platform post-run compute estimates work **without** Cost Explorer. Billed totals require both the
AWS Billing steps below **and** `cost-explorer.enabled: true` in `config/easy-genomics.yaml` (default `false`). That
flag deploys the daily sync Lambda / CE IAM and switches the UI from “billed unavailable” copy to the 24–48h pending
messaging. After flipping the YAML, redeploy the back-end and rebuild the front-end.

1. In the AWS Billing console, **Launch Cost Explorer** (one-way enablement; cannot be turned off, only IAM-restricted).
2. Activate these **cost allocation tags** (Billing → Cost allocation tags). Activation can take up to 24 hours:
   - `LaboratoryId`
   - `OrganizationId`
   - `RunId`
   - `Application`
   - `Platform`
   - `UserId`
   - `UserEmail`
   - `WorkflowId` (optional; useful for workflow-level rollups)
3. Do **not** enable hourly/resource-level CE granularity unless separately justified (extra AWS charges).
4. Set `cost-explorer.enabled: true` in `config/easy-genomics.yaml`, then redeploy back-end and rebuild front-end.
5. Expect **24–48 hours** after run completion before billed cost appears in Easy Genomics (daily cost-sync Lambda).
6. Typical EG CE API spend under the recommended daily batch sync is on the order of **~$0.30–$1/month**.

For Seqera / Batch per-run billed attribution, see `docs/deployment/seqera-cost-labels.md` (resource labels + CUR /
Split Cost Allocation Data). Tower **estimated** compute cost does not require Cost Explorer.
