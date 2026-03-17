import { Component, Project, TextFile } from 'projen';
import { PROJEN_MARKER } from 'projen/lib/common';

/**
 * Custom projen component that generates .husky/{git hook} logic
 * to help enforce conventional commit messages, and code linting.
 */
export class Husky extends Component {
  constructor(rootProject: Project) {
    super(rootProject);

    // Generate / override the .husky/commit-msg hook file
    {
      const commitMsg = new TextFile(rootProject, '.husky/commit-msg', {
        marker: true,
      });
      commitMsg.addLine(`# ${PROJEN_MARKER} -- see projenrc/husky.ts`);
      commitMsg.addLine('# commit-msg hook file');
      commitMsg.addLine('pnpm exec commitlint --edit $1');
      commitMsg.addLine('');
    }

    // Generate / override the .husky/pre-commit hook file
    {
      const preCommit = new TextFile(rootProject, '.husky/pre-commit', {
        marker: true,
      });
      preCommit.addLine(`# ${PROJEN_MARKER} -- see projenrc/husky.ts`);
      preCommit.addLine('# pre-commit hook file');
      preCommit.addLine(
        "pnpm exec validate-branch-name -r '^(main|release){1}$|^(feat|fix|hotfix|infra|release|refactor|chore|docs)/.+$'",
      );
      preCommit.addLine('pnpm pre-commit');
      preCommit.addLine('pnpm exec projen');
      preCommit.addLine('pnpm --filter @easy-genomics/back-end test -- --silent');
      preCommit.addLine('');
    }
  }
}
