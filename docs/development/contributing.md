# Contributing

> **Note:** This page holds the contribution conventions and test/audit commands relocated from the root `README.md`.
> The full contributing guide — including the AI Coding Principles from `CLAUDE.md`, PR review expectations, and the
> testing requirements from `TESTING.md` — is owned by DOCS-05 and will expand this page.

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
