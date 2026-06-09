# Contributing

How to contribute to Easy Genomics — for human and AI contributors alike. This page covers claiming work, the coding
principles every change must follow, branch/commit conventions, testing expectations, and the pull-request flow.

## Before you start

Work is tracked as JIRA tickets identified by an `EG-XXX` code (the same code that goes into your branch name and
commits — see [Branch Naming convention](#branch-naming-convention)).

1. **Claim the ticket.** Assign the JIRA ticket to yourself (or create one) before writing code, so the work isn't
   duplicated. External contributors without JIRA access should open a GitHub issue describing the change first and wait
   for a maintainer to confirm before starting.
2. **Reference `EG-XXX`** in your branch name and commit messages so the work is traceable.

## AI Coding Principles

Every change — whether written by a human or with AI assistance — must follow the **AI Coding Principles** and
**Architecture Rules** defined in `CLAUDE.md` at the repo root. `CLAUDE.md` is the authoritative source; the summary
below is a pointer, not a replacement — read it before contributing.

- **Write for humans first** — descriptive names, explicit over clever, comment _why_ (not _what_).
- **Be specific and consistent** — match the naming, structure, and patterns already in the codebase; don't invent new
  ones where an established one fits.
- **DRY** — reuse the shared utilities, services, and Zod schemas in `packages/shared-lib` and the domain services
  before writing anything new.
- **KISS** — the simplest solution that fully satisfies the requirement; Lambda handlers stay thin (≤ ~50 lines),
  business logic lives in services.
- **SOLID** — single-responsibility services, extend via new files, handlers depend on service abstractions (never AWS
  SDK clients directly).
- **Minimise noise** — read only what you need, show diffs not whole files, keep changes small.

Error handling follows the typed-error rules in `ERROR_HANDLING.md` (repo root): use the typed error classes and
`buildErrorResponse(err, event)`; never throw bare `Error`s or swallow failures silently.

## Test Runners

### End-to-End Tests

End-to-End tests validates the entire application from start to finish by simulating real user scenarios. The tests are
written in TypeScript and use the Playwright library to automate a headless browser instance interacting with the
application.

End-to-End tests (`*.spec.e2e.ts`) are located in the `packages/front-end/test/e2e` directory and are executed using
[Playwright](https://playwright.dev/).

Run the following commands from the root directory of the project. The headless commands will run via a CLI only,
whereas the headed browser instance will open a browser window simulating user interaction with the application.

```bash
# The following commands are used to run the end-to-end tests on an environment specified inn the `easy-genomics.yaml` file.
$ pnpm `test-e2e`  # run all tests in headless mode - used for CI/CD execution
$ pnpm `test-e2e:sys-admin ` # a headless browser instance to run System Admin tests
$ pnpm `test-e2e:org-admin ` # a headless browser instance to run Org Admin tests
$ pnpm `test-e2e:sys-admin:headed ` # a headed browser instance to run System Admin tests
$ pnpm `test-e2e:org-admin:headed ` # a headed browser instance to run Org Admin tests
```

## Branch Naming convention

This project requires the branch name to follow the customized
[validate-branch-name](https://www.npmjs.com/package/validate-branch-name) regular expression:
`^(main|release){1}$|^(feat|fix|hotfix|infra|release|refactor|chore|docs)/.+$`, defined within the `.husky/pre-commit`
hook.

Format: `<Branch Type>/<Summary>`

where `<Branch Type>`:

- `feat`
- `fix`
- `hotfix`
- `infra`
- `release`
- `refactor`
- `chore`
- `docs`

### Example branch names

```
git checkout -b "feat/EG-XXX_add_new_feature"
^-------------^  ^-----^ ^--------------------^
|                |       |
|                |       +-> Summary in present tense with JIRA ticket prefix when possible.
|                |
|                +--> Branch Type: feat, fix, hotfix, infra, release, refactor, chore, docs.
|
+-------> Create new branch from current branch.
```

```
git branch -m "fix/EG-XXX_fix_something_&_something_else"
^-----------^  ^-^ ^-----------------------------------^
|              |   |
|              |   +-> Summary in present tense with JIRA ticket prefix when possible.
|              |
|              +--> Branch Type: feat, fix, hotfix, infra, release, refactor, chore, docs.
|
+-------> Modify current branch name.
```

## Conventional Commit syntax

This project requires commit messages to follow the
[Conventional Commit specification](https://www.conventionalcommits.org/):

Format: `<Commit Type>(<Scope>): <Subject>`

where `<Commit Type>`:

- `feat`: Introduces a new feature or provides an enhancement of an existing feature
- `fix`: Patches a bug
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `style`: Formatting, missing semi colons, etc; no production code change
- `test`: Adds missing tests or corrects existing tests
- `docs`: Documentation only changes
- `chore`: Changes to the build process or auxiliary tools and libraries such as CI or package updates

Note: `<Scope>` is optional

### Example commit message

```
git commit -m "feat(EG-XXX): add hat wobble"
^-----------^  ^--^ ^----^   ^------------^
|              |    |        |
|              |    |        +-> Subject in present tense.
|              |    |
|              |    +--> Scope: specify the JIRA ticket code here when possible.
|              |
|              +--> Commit Type: chore, docs, feat, fix, refactor, style, or test.
|
+-------> Create a commit to the current branch with a message.
```

## Upgrading Packages

To upgrade the node packages across the entire project using Projen simply run the following command:

```sh
pnpm run upgrade
```

## CDK Infrastructure Security Audit

To audit the Back-End or Front-End CDK infrastructure against AWS Security guidelines defined by CDK-Nag, run the
`pnpm run cdk-audit` command within the `back-end` or `front-end` sub-package folder.

```
[easy-genomics/packages/back-end]$ pnpm run cdk-audit

or

[easy-genomics/packages/front-end]$ pnpm run cdk-audit
```

## Testing expectations

Testing standards are defined in `CLAUDE.md` (**Testing Standards**); `TESTING.md` at the repo root is the running
manual test log. For any change:

- **New happy paths need an end-to-end test.** E2E tests run against a fully deployed `quality` environment with
  Playwright + Chromium (`pnpm run test-e2e` — see [Test Runners](#test-runners) above). Don't mock AWS services; the
  suite makes real calls.
- **New error paths** should at minimum be manually tested and logged in `TESTING.md`.
- **Unit tests** (where they exist) live alongside the source file they test — follow the existing naming pattern in
  that package.

## Pull requests

1. **Fill in the PR template.** Opening a PR pre-populates
   [`.github/pull_request_template.md`](../../.github/pull_request_template.md): a descriptive **Title**, the **Type of
   Change**, a **Description** with context and linked `EG-XXX`/issue, the **Testing** you performed, the **Impact**,
   and the **Checklist**.
2. **Review the diff.** Run the **PR Review Prompt** in `CLAUDE.md` against the diff between your branch and the target
   branch. It focuses on the four things that block a merge: potential bugs, performance, security, and correctness —
   not style nits.
3. **Sign off** with the outcome: ✅ approved, or ☑️ issues found (with the issues listed). Address any ☑️ findings and
   re-test before requesting a human review.

Keep PRs focused: one ticket, the minimal change to satisfy it, no unrelated refactoring.
