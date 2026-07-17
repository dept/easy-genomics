import { IConstruct } from 'constructs';
import { Component, github, typescript } from 'projen';

export class GithubActionsApiDiffCheck extends Component {
  private readonly pnpmVersion: string;

  constructor(rootProject: typescript.TypeScriptProject, options: { pnpmVersion: string }) {
    super(<IConstruct>rootProject);
    this.pnpmVersion = options.pnpmVersion;

    const wf = new github.GithubWorkflow(rootProject.github!, 'api-diff-check');
    wf.on({
      pullRequest: {
        types: ['opened', 'synchronize', 'reopened', 'ready_for_review', 'labeled'],
      },
    });

    const project = rootProject as typescript.TypeScriptProject;
    const jobs: Record<string, github.workflows.Job> = {
      check: {
        name: 'API schema diff check',
        runsOn: ['ubuntu-latest'],
        permissions: {
          pullRequests: github.workflows.JobPermission.WRITE,
          contents: github.workflows.JobPermission.READ,
        },
        env: {
          HAS_BREAKING_LABEL: "${{ contains(github.event.pull_request.labels.*.name, 'breaking-change') }}",
        },
        steps: [
          {
            name: 'Checkout',
            uses: 'actions/checkout@v4',
            with: { 'fetch-depth': 0, ref: '${{ github.event.pull_request.head.sha }}' },
          },
          { name: 'Install pnpm', uses: 'pnpm/action-setup@v4', with: { version: this.pnpmVersion } },
          {
            name: 'Setup node',
            uses: 'actions/setup-node@v4',
            with: { 'node-version': project.minNodeVersion, cache: 'pnpm' },
          },
          { name: 'Install dependencies', run: 'pnpm install --frozen-lockfile' },
          {
            name: 'Verify OpenAPI spec is up to date',
            run: [
              'set -euo pipefail',
              '# Regenerate the spec + types from the Zod schemas and fail if the committed copy is stale',
              '# (e.g. a schema change was committed with --no-verify, bypassing the pre-commit hook).',
              'pnpm --filter @easy-genomics/shared-lib run generate:openapi',
              'pnpm --filter @easy-genomics/shared-lib run generate:api-types',
              'if ! git diff --quiet -- packages/shared-lib/src/app/openapi/easy-genomics-api.yaml packages/shared-lib/src/app/types/easy-genomics/generated.d.ts; then',
              '  echo "::error::OpenAPI spec/types are out of date. Run \'pnpm --filter @easy-genomics/shared-lib run generate:openapi && pnpm --filter @easy-genomics/shared-lib run generate:api-types\' and commit the result."',
              '  git --no-pager diff -- packages/shared-lib/src/app/openapi/easy-genomics-api.yaml packages/shared-lib/src/app/types/easy-genomics/generated.d.ts',
              '  exit 1',
              'fi',
            ].join('\n'),
          },
          {
            id: 'diff',
            name: 'Run optic diff',
            run: [
              'set -euo pipefail',
              'git show "origin/${GITHUB_BASE_REF}:packages/shared-lib/src/app/openapi/easy-genomics-api.yaml" > /tmp/api-base.yaml',
              '',
              '# No changes — annotate step summary and exit',
              'if diff -q /tmp/api-base.yaml packages/shared-lib/src/app/openapi/easy-genomics-api.yaml > /dev/null 2>&1; then',
              '  echo "### ✅ API diff: no changes detected" >> "$GITHUB_STEP_SUMMARY"',
              '  exit 0',
              'fi',
              '',
              '# Run optic diff (allow non-zero exit for breaking changes)',
              'set +e',
              'DIFF_OUTPUT=$(NO_COLOR=1 pnpm exec optic diff /tmp/api-base.yaml packages/shared-lib/src/app/openapi/easy-genomics-api.yaml --check 2>&1)',
              'OPTIC_EXIT=$?',
              'set -e',
              '',
              '# Export diff output for PR comment step',
              '{',
              '  echo "DIFF_OUTPUT<<OPTIC_EOF"',
              '  echo "$DIFF_OUTPUT"',
              '  echo "OPTIC_EOF"',
              '} >> "$GITHUB_ENV"',
              '',
              '# Export step outputs for conditional downstream steps',
              'echo "has_changes=true" >> "$GITHUB_OUTPUT"',
              'echo "has_breaking=$([ $OPTIC_EXIT -ne 0 ] && echo true || echo false)" >> "$GITHUB_OUTPUT"',
            ].join('\n'),
          },
          {
            name: 'Post diff as PR comment',
            if: "steps.diff.outputs.has_changes == 'true'",
            uses: 'actions/github-script@v7',
            with: {
              script: [
                "const marker = '<!-- api-diff-check -->';",
                'const body = `${marker}\\n## API Schema Diff\\n\\`\\`\\`\\n${process.env.DIFF_OUTPUT}\\n\\`\\`\\``;',
                'const { data: comments } = await github.rest.issues.listComments({',
                '  owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number,',
                '});',
                'const existing = comments.find(c => c.body?.includes(marker));',
                'if (existing) {',
                '  await github.rest.issues.updateComment({',
                '    owner: context.repo.owner, repo: context.repo.repo, comment_id: existing.id, body,',
                '  });',
                '} else {',
                '  await github.rest.issues.createComment({',
                '    owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number, body,',
                '  });',
                '}',
              ].join('\n'),
            },
          },
          {
            name: 'Fail on breaking changes without label',
            if: "steps.diff.outputs.has_changes == 'true'",
            env: {
              HAS_BREAKING: '${{ steps.diff.outputs.has_breaking }}',
            },
            run: [
              'if [ "$HAS_BREAKING" = "true" ] && [ "$HAS_BREAKING_LABEL" != "true" ]; then',
              '  echo "Breaking API changes detected. Add the \'breaking-change\' label to the PR to bypass this check."',
              '  exit 1',
              'fi',
            ].join('\n'),
          },
        ],
      },
    };

    wf.addJobs(jobs);
  }
}
