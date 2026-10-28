import { Component, Project, YamlFile } from 'projen';

// Custom projen component that generates .github/dependabot.yml.
//
// projen's built-in `dependabot` option is not used: it cannot set the commit-message
// prefix that pull-request-lint requires, and it cannot coexist with the `upgrade` tasks.
// The github-actions ecosystem is left out because the workflows are projen output;
// Dependabot edits to them would be reverted by the next `pnpm exec projen`.

export class GithubDependabot extends Component {
  constructor(rootProject: Project, options: { targetBranch: string }) {
    super(rootProject);

    new YamlFile(rootProject, '.github/dependabot.yml', {
      obj: {
        version: 2,
        updates: [
          {
            'package-ecosystem': 'npm',
            'directory': '/',
            'target-branch': options.targetBranch,
            'schedule': { interval: 'weekly' },
            // package.json versions are owned by .projenrc.ts; only the lock file may change.
            'versioning-strategy': 'lockfile-only',
            // Produces "chore(deps): ..." PR titles, which pull-request-lint accepts.
            'commit-message': { prefix: 'chore', include: 'scope' },
            // A projen upgrade regenerates committed files, so it stays a deliberate `pnpm upgrade`.
            'ignore': [{ 'dependency-name': 'projen' }],
            'groups': {
              'npm-minor-and-patch': { 'update-types': ['minor', 'patch'] },
            },
          },
        ],
      },
    });
  }
}
