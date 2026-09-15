# Configuration

Configure the `easy-genomics.yaml` shared and back-end settings for your deployment environment. Make sure your
[AWS credentials](./aws-setup.md) are configured first.

## `easy-genomics.yaml`

Copy the `${easy-genomics root-dir}/config/easy-genomics.example.yaml` as
`${easy-genomics root-dir}/config/easy-genomics.yaml` and edit the Shared and Back-End settings for your deployment
environment.

Please ensure each of the settings are enclosed with quotes `'...'` to enforce explicit string values.

- NOTE:

  - The quotation for the `aws-account-id` setting is mandatory if the AWS Account ID starts with `00...`.

  - The `easy-genomics.yaml` configuration validation logic has been updated to only support one configuration
    collection in order to simplify the build and deployment workflow. As a result, if there are multiple configuration
    collections you will need to remove or comment the remaining configuration collections.

```
e.g.

easy-genomics:
   configurations:
      - demo: ## Unique 'env-name' identifier for the following collection of configuration settings (e.g. dev, uat, demo, prod)
         ## Shared settings common to Back-End and Front-End sub-packages
         aws-account-id: '123456789' # e.g. '123456789'
         aws-region: 'us-east-1' # e.g. 'us-east-1'
         env-type: 'dev' # 'dev' | 'pre-prod' | 'prod'; only 'dev' and 'pre-prod' can have AWS CloudFormation resources destroyed
         app-domain-name: 'demo.easy-genomics.mycompany.com' # e.g. demo.easy-genomics.myinstitution.org
         ## The following Front-End Infrastructure settings will need to be pre-configured in AWS and defined when 'env-type' is 'pre-prod' or 'prod'.
         aws-hosted-zone-id: # Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
         aws-certificate-arn: # Not required when env-type: 'dev', but must exist for the same app-domain-name if configured

         # Back-End specific settings
         back-end:
            jwt-secret-key: # Optional: If undefined, a random value will be generated on deployment for JWT Signature
            seqera-api-base-url: # Optional: Update for self-hosted Seqera API Base URL; if unspecified this defaults to 'https://api.cloud.seqera.io'
            ## The System Admin account is required
            sys-admin-email: 'sysadmin@easygenomics.org' # Replace with your institution's preferred System Admin account
            sys-admin-password: # System Admin Password - must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
            ## Optional: The following user accounts are only seeded for 'dev' and 'pre-prod' environments for testing purposes
            #org-admin-email: 'admin@easygenomics.org'
            #org-admin-password: '' # Admin Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
            #lab-manager-email: 'lab.manager@easygenomics.org'
            #lab-manager-password: '' # Lab Admin Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
            #lab-technician-email: 'lab.technician@easygenomics.org'
            #lab-technician-password: '' # Lab Technician Password - if set, must be minimum 8 chars long and contain: 1 number, 1 special char, 1 uppercase letter, 1 lowercase letter
```

- Please consult the
  [/packages/shared-lib/src/app/types/configuration.d.ts](https://github.com/twobulls/easy-genomics/blob/main/packages/shared-lib/src/app/types/configuration.d.ts)
  for more information regarding the configuration type definition.
- Each configuration is validated at run-time, if a configuration is incomplete or invalid it will be ignored as part of
  the build and deployment.

## Optional: GitHub PAT Secret for nf-core Workflow Schemas

Easy Genomics can enrich the workflow parameter form with richer type information, default values, dropdown options, and
help text by fetching the `nextflow_schema.json` from the workflow's GitHub repository. This is enabled by tagging an
AWS HealthOmics workflow with a `github-repo-url` tag pointing to its GitHub repository.

To fetch schema files from private repositories (or to avoid GitHub API rate limits on public ones), you need to provide
a GitHub Fine-Grained Personal Access Token (PAT) with **Contents: Read-only** scope.

**Why it's needed:**

The GitHub Contents API requires authentication to read files from private repositories, and unauthenticated requests to
public repositories are subject to strict rate limits. The PAT is stored securely in AWS Secrets Manager — it is never
embedded in code or configuration files.

**How to set it up:**

1. Create a GitHub Fine-Grained PAT with **Contents: Read-only** permission scoped to the repositories that host your
   workflow schemas.

2. Store the token in AWS Secrets Manager. You can use an existing secret or let Easy Genomics create a placeholder
   secret for you on first deploy and populate it afterwards:

   ```bash
   # Option A: Create a new secret manually before deploying
   aws secretsmanager create-secret \
     --name 'my-github-pat' \
     --secret-string 'github_pat_xxxxxxxxxxxx'

   # Option B: Populate the CDK-created placeholder after deploying (omit github-pat-secret-name from yaml)
   aws secretsmanager put-secret-value \
     --secret-id '{name-prefix}-github-pat-secret' \
     --secret-string 'github_pat_xxxxxxxxxxxx'
   ```

3. Set `github-pat-secret-name` in `easy-genomics.yaml` to the name of the secret created in step 2. If this field is
   left empty, Easy Genomics will create a placeholder secret named `{name-prefix}-github-pat-secret` that you can
   populate after the first deploy (Option B above).

   ```yaml
   back-end:
     github-pat-secret-name: 'my-github-pat' # Optional: leave empty to use the auto-created placeholder
   ```

4. Tag your AWS HealthOmics workflow with the repository URL:

   ```bash
   aws omics tag-resource \
     --resource-arn 'arn:aws:omics:{region}:{account}:workflow/{id}' \
     --tags 'github-repo-url=https://github.com/your-org/your-workflow'
   ```

   Easy Genomics will automatically fetch and cache the `nextflow_schema.json` from that repository whenever the tag is
   added or updated.

Once configured, continue with the deploy step in [../getting-started/install.md](../getting-started/install.md).
