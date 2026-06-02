# Installation Quick Start Guide

The configuration deployment consists of 3 simple steps:

1. Configure the AWS Credentials on your local machine.
2. Configure the `easy-genomics.yaml` shared settings and back-end specific settings.
3. Deploy the Easy Genomics solution.

This guide covers obtaining the source code and deploying a `dev` / `pre-prod` environment. Make sure you have satisfied
the [Prerequisites and Preparation](./prerequisites.md) first.

- AWS credential setup → [../deployment/aws-setup.md](../deployment/aws-setup.md)
- `easy-genomics.yaml` configuration → [../deployment/configuration.md](../deployment/configuration.md)
- Production deployment → [../deployment/](../deployment/) (see `production.md`, owned by DOCS-02)

## Obtain the source code and install dependencies

Once the prerequisites and preparation steps are complete, run the following commands to obtain the Easy Genomics
project source code and install the project dependencies.

1. Clone this Github Repository to your local O/S environment:

   ```
   $ git clone https://github.com/twobulls/easy-genomics.git
   ```

2. Change directory into the Easy Genomics project root directory (referred to as `${easy-genomics root-dir}` from
   henceforth):

   ```
   $ cd easy-genomics
   [easy-genomics]$
   ```

3. Run `pnpm install` to install the initial project dependencies, including `projen` for project and dependency
   management.

   ```
   [easy-genomics]$ pnpm install
   ```

4. (Development only) Run `pnpm projen` to synthesize/update the project files managed by `projen`. This step is
   typically only needed when you are changing project configuration in `.projenrc.ts`, not as part of a normal
   production deployment:

   ```
   [easy-genomics]$ pnpm projen
   ```

5. (Development only) Run `pnpm projen install` to install all the defined `.projenrc.ts` dependencies for compilation.
   This is intended for local development/bootstrapping; it is **not required** and generally **should not be run
   immediately before a production `build-and-deploy`**, because it can regenerate configs and dependencies:

   ```
   [easy-genomics]$ pnpm projen install
   ```

## Deploy

After configuring your [AWS credentials](../deployment/aws-setup.md) and
[`easy-genomics.yaml`](../deployment/configuration.md), deploy the entire Easy Genomics solution to AWS using the
following command.

```
[easy-genomics]$ pnpm run build-and-deploy
```

Once the deployment is completed, it will output the `ApplicationUrl` which can then be accessed from your web browser.

```
[easy-genomics]$ pnpm run build-and-deploy
...

Outputs:
dev-main-front-end-stack.ApplicationUrl = https://abcdef12345.cloudfront.net
dev-main-front-end-stack.HostingBucketName = {app-domain-name}
```

- NOTE: If the `aws-hosted-zone-id` and/or the `aws-certificate-arn` are not defined in the `easy-genomics.yaml`, the
  `ApplicationUrl` returned will be the CloudFront Distribution URL.

Finally, use the `${easy-genomics root-dir}/config/easy-genomics.yaml` file's configured `org-admin-email` and
`org-admin-password` account details to log in into Easy Genomics to test the functionality.

Once you have completed an initial deployment of the Back-End and Front-End application logic, you can subsequently use
the `build-and-deploy` short-cut command from the `${easy-genomics root-dir}` directory to conveniently complete both
Back-End and Front-End deployments in one command.

```
e.g.
[easy-genomics/packages/front-end]$ cd ../../
[easy-genomics]$ pnpm run build-and-deploy             # Deploys both Back-End and Front-End logic using the existing easy-genomics.yaml settings
```
