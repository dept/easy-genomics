# Back-End

CDK infrastructure and AWS Lambda handlers for the Easy Genomics API. This package defines the serverless back-end: the
HTTP and SQS Lambda functions, the domain service layer they call, and the CDK constructs and stacks that provision
every AWS resource.

## Key directories

| Directory               | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `src/app/controllers/`  | Lambda handlers — thin controllers, one file per route             |
| `src/app/services/`     | Domain and AWS-SDK service layer (business logic lives here)       |
| `src/infra/constructs/` | Reusable CDK constructs (DynamoDB, SNS, S3, etc.)                  |
| `src/infra/stacks/`     | CDK stacks composing constructs into deployable infrastructure     |
| `src/local-server/`     | Local dev server that proxies HTTP requests to the Lambda handlers |

## Conventions

Lambda filename prefixes (`create-`, `read-`, `list-`, `update-`, `delete-`, …) determine the HTTP route. Handlers stay
thin — business logic belongs in a domain service, never inline in the handler or in a direct AWS-SDK call. See
[`docs/development/contributing.md`](../../docs/development/contributing.md) for the full set of contribution
conventions.

## Running locally

The back-end runs against real AWS services via a local dev server. See
[`docs/development/local-backend-dev.md`](../../docs/development/local-backend-dev.md) for setup and troubleshooting.

## Where to look next

- [Documentation index](../../docs/README.md)
- [Contributing guide](../../docs/development/contributing.md)
