# Easy Genomics

> ⚠️ **Upgrading an existing deployment? [Read the upgrade guide FIRST](./docs/deployment/upgrading.md) — there is a
> data-loss hazard.** Applying this release to an existing environment without the documented safeguards can permanently
> delete your DynamoDB tables. See [`docs/deployment/upgrading.md`](./docs/deployment/upgrading.md) and the
> [migration runbook](./docs/operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md) before merging.

## Introduction

This open-source web application project aims to help simplify genomic analysis of sequenced genetic data for
bioinformaticians utilizing AWS HealthOmics & NextFlow Tower. This project is an initiative of the Wisconsin State
Laboratory of Hygiene (WSLH), AWS HealthOmics, and the US Centers for Disease Control and Prevention (CDC).

This web application has been designed to work on AWS Cloud Infrastructure and utilises:

- AWS CDK leveraging CloudFormation for Infrastructure-as-Code (IaC)
- AWS SDKs & libraries
- NX for mono-repo management and build management
- Nuxt for front-end build and development
- Projen for project and dependency management
- PNPM for package management

This project is organized as a mono-repo that consists of the following sub-packages:

- `packages/back-end`: contains back-end application-logic, data integrations with AWS HealthOmics / NextFlow Tower, and
  back-end infrastructure
- `packages/front-end`: contains front-end application-logic, styling, and front-end infrastructure
- `packages/shared-lib`: contains shared code, object type-definitions, infrastructure constructs shared between the
  `back-end` and `front-end` sub-packages

In addition to the sub-package structure, the `back-end` application logic is further organized into the following
sub-components for logical separation to make it easier to maintain and enhance:

- `easy-genomics`: contains this web application's specific logic
- `aws-healthomics`: contains AWS HealthOmics specific logic
- `nf-tower`: contains NextFlow Tower specific logic

## 📚 Documentation

Full documentation lives in [`docs/`](./docs/), organised by audience:

- **[Getting Started](./docs/getting-started/)** — prerequisites, installation, and your first workflow run.
- **[Deployment](./docs/deployment/)** — AWS setup, `easy-genomics.yaml` configuration, upgrading, and
  **[production deployment](./docs/deployment/production.md)**.
- **[Development](./docs/development/)** — local back-end development, contributing conventions, and architecture.
- **[Operations](./docs/operations/)** — troubleshooting and migration runbooks.

New to Easy Genomics? Start with **[docs/getting-started/prerequisites.md](./docs/getting-started/prerequisites.md)**.

## License

This project is licensed under the terms of the [LICENSE](./LICENSE) file in the root of this repository.
