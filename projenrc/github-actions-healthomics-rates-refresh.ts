import { IConstruct } from 'constructs';
import { Component, github, typescript } from 'projen';

const RATES_FILE = 'packages/shared-lib/src/app/utils/healthomics-rates.generated.ts';
const BRANCH_PREFIX = 'chore/healthomics-rates-';
const PR_TITLE = 'chore(pricing): refresh HealthOmics rates from the AWS price list';

export class GithubActionsHealthOmicsRatesRefresh extends Component {
  private readonly pnpmVersion: string;

  constructor(rootProject: typescript.TypeScriptProject, options: { pnpmVersion: string }) {
    super(<IConstruct>rootProject);
    this.pnpmVersion = options.pnpmVersion;

    const wf = new github.GithubWorkflow(rootProject.github!, 'healthomics-rates-refresh');
    wf.on({
      schedule: [{ cron: '0 9 1 * *' }],
      workflowDispatch: {},
    });

    const project = rootProject as typescript.TypeScriptProject;
    const jobs: Record<string, github.workflows.Job> = {
      refresh: {
        name: 'Refresh HealthOmics rates',
        runsOn: ['ubuntu-latest'],
        permissions: {
          contents: github.workflows.JobPermission.WRITE,
          pullRequests: github.workflows.JobPermission.WRITE,
        },
        env: {
          RATES_FILE,
          GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
        },
        steps: [
          { name: 'Checkout', uses: 'actions/checkout@v4', with: { ref: 'development' } },
          { name: 'Install pnpm', uses: 'pnpm/action-setup@v4', with: { version: this.pnpmVersion } },
          {
            name: 'Setup node',
            uses: 'actions/setup-node@v4',
            with: { 'node-version': project.minNodeVersion, cache: 'pnpm' },
          },
          { name: 'Install dependencies', run: 'pnpm install --frozen-lockfile' },
          {
            name: 'Regenerate rates from the AWS price list',
            run: 'pnpm --filter @easy-genomics/shared-lib run generate:healthomics-rates',
          },
          {
            id: 'diff',
            name: 'Check for rate changes',
            run: [
              'if git diff --quiet -- "$RATES_FILE"; then',
              '  echo "Rates unchanged"',
              '  echo "changed=false" >> "$GITHUB_OUTPUT"',
              'else',
              '  git --no-pager diff --stat -- "$RATES_FILE"',
              '  echo "changed=true" >> "$GITHUB_OUTPUT"',
              'fi',
            ].join('\n'),
          },
          {
            id: 'push',
            name: 'Commit and push the refreshed rates',
            if: "steps.diff.outputs.changed == 'true'",
            env: { HUSKY: '0' },
            run: [
              'set -euo pipefail',
              'PUBLICATION_DATE=$(grep -m1 -o "publicationDate: \'[^\']*\'" "$RATES_FILE" | cut -d"\'" -f2)',
              '# Reuse the branch of a refresh PR that is still open, so there is only ever one.',
              'OPEN_BRANCH=$(gh pr list --base development --state open --json headRefName \\',
              `  --jq '[.[].headRefName | select(startswith("${BRANCH_PREFIX}"))][0] // ""')`,
              `BRANCH="\${OPEN_BRANCH:-${BRANCH_PREFIX}$(date -u +%Y-%m-%d)}"`,
              'DIFF_STAT=$(git --no-pager diff --stat -- "$RATES_FILE")',
              'git config user.name "github-actions[bot]"',
              'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
              'git checkout -B "$BRANCH"',
              'git add -- "$RATES_FILE"',
              `git commit -m "${PR_TITLE}" \\`,
              '  -m "Regenerated from the AWS HealthOmics price list published ${PUBLICATION_DATE}."',
              'git push --force origin "$BRANCH"',
              '{',
              '  echo "branch=$BRANCH"',
              '  echo "pr_open=$([ -n "$OPEN_BRANCH" ] && echo true || echo false)"',
              '  echo "publication_date=$PUBLICATION_DATE"',
              '  echo "diff_stat<<DIFF_STAT_EOF"',
              '  echo "$DIFF_STAT"',
              '  echo "DIFF_STAT_EOF"',
              '} >> "$GITHUB_OUTPUT"',
            ].join('\n'),
          },
          {
            name: 'Open the pull request',
            if: "steps.diff.outputs.changed == 'true' && steps.push.outputs.pr_open == 'false'",
            env: {
              BRANCH: '${{ steps.push.outputs.branch }}',
              PUBLICATION_DATE: '${{ steps.push.outputs.publication_date }}',
              DIFF_STAT: '${{ steps.push.outputs.diff_stat }}',
            },
            run: [
              'set -euo pipefail',
              'cat > /tmp/pr-body.md <<PR_BODY_EOF',
              'The monthly refresh found new HealthOmics rates in the AWS price list published ${PUBLICATION_DATE}.',
              '',
              '\\`\\`\\`',
              '${DIFF_STAT}',
              '\\`\\`\\`',
              '',
              'Review it like any data change: check that the rates that moved look plausible',
              'before merging, since they feed every run cost estimate.',
              '',
              'This PR was opened with GITHUB_TOKEN, so the PR checks did not run.',
              'Close and reopen it to run them.',
              'PR_BODY_EOF',
              `gh pr create --base development --head "$BRANCH" --title "${PR_TITLE}" --body-file /tmp/pr-body.md`,
            ].join('\n'),
          },
        ],
      },
    };

    wf.addJobs(jobs);
  }
}
