import { IConstruct } from 'constructs';
import { Component, JsonFile, typescript } from 'projen';

// Custom projen component that configures nx.
export class Nx extends Component {
  constructor(rootProject: typescript.TypeScriptProject) {
    super(<IConstruct>rootProject);

    // Add nx library dependencies
    rootProject.addDevDeps('nx@^22.7.10');

    // Add nx.json file
    new JsonFile(<IConstruct>rootProject, 'nx.json', {
      obj: {
        extends: 'nx/presets/npm.json',
        // Never prompt to connect to Nx Cloud, so scripted builds and deploys cannot stop at a prompt.
        neverConnectToCloud: true,
        targetDefaults: {
          build: {
            // By default nx uses a local cache to prevent re-running targets
            // that have not had their inputs changed (eg. no changes to source files).
            cache: true,

            // Specifies the build target of a project is dependent on the
            // build target of dependant projects (via the caret)
            dependsOn: ['^build'],

            // Inputs tell nx which files can invalidate the cache should they updated.
            // We only want the build target cache to be invalidated if there
            // are changes to source files so the config below ignores output files.
            inputs: [
              '!{projectRoot}/test-reports/**/*',
              '!{projectRoot}/coverage/**/*',
              '!{projectRoot}/build/**/*',
              '!{projectRoot}/dist/**/*',
              '!{projectRoot}/lib/**/*',
              '!{projectRoot}/cdk.out/**/*',

              // SKIP_TESTS is part of the cache key so a build that skipped Jest and ESLint
              // cannot be replayed as a cache hit for one that should have run them.
              { env: 'SKIP_TESTS' },
            ],

            // Outputs tell nx where artifacts can be found for caching purposes.
            // The need for this will become more obvious when we configure

            // github action workflows and need to restore the nx cache for

            // subsequent job to fetch artifacts
            outputs: ['{projectRoot}/lib', '{projectRoot}/cdk.out'],
          },
          deploy: { dependsOn: ['build'] },
        },

        // This is used when running 'nx affected ….' command to selectively
        // run targets against only those packages that have changed since
        // lastest commit on origin/main
        affected: { defaultBase: 'origin/main' },
      },
    });
  }
}
