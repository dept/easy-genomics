import { awscdk, javascript, typescript, LicenseOptions } from 'projen';
import {
  ArrowParens,
  HTMLWhitespaceSensitivity,
  JestOptions,
  PrettierOptions,
  ProseWrap,
  QuoteProps,
  TrailingComma,
  TypescriptConfigExtends,
  TypescriptConfigOptions,
} from 'projen/lib/javascript';
import { pathsToModuleNameMapper } from 'ts-jest';
import { ApacheLicense } from './projenrc/apache-license';
import { setupProjectFolders } from './projenrc/easy-genomics-project-setup';
import { GithubActionsApiDiffCheck } from './projenrc/github-actions-api-diff-check';
import { GithubActionsCICDRelease } from './projenrc/github-actions-cicd-release';
import { Husky } from './projenrc/husky';
import { Nx } from './projenrc/nx';
import { PnpmWorkspace } from './projenrc/pnpm';
import { VscodeSettings } from './projenrc/vscode';

const defaultReleaseBranch = 'main';
const cdkVersion = '2.176.0';
const nodeVersion = '20.15.0';
const pnpmVersion = '9.15.0';
const awsSdkClientOmicsVersion = '^3.1014.0';
const authorName = 'DEPT Agency';
const copyrightOwner = authorName;
const copyrightPeriod = `${new Date().getFullYear()}`;

const prettierOptions: PrettierOptions = {
  settings: {
    printWidth: 120,
    tabWidth: 2,
    singleQuote: true,
    semi: true,
    trailingComma: TrailingComma.ALL,
    arrowParens: ArrowParens.ALWAYS,
    bracketSpacing: true,
    htmlWhitespaceSensitivity: HTMLWhitespaceSensitivity.IGNORE,
    proseWrap: ProseWrap.ALWAYS,
    quoteProps: QuoteProps.PRESERVE,
    useTabs: false,
    vueIndentScriptAndStyle: true,
    bracketSameLine: false,
    plugins: ['prettier-plugin-tailwindcss'],
  },
  ignoreFileOptions: {
    // add any Projen ready-only generated config files here
    ignorePatterns: [
      '.eslintrc.json',
      '.github/pull_request_template.md',
      '.prettierrc.json',
      '.vscode/settings.json',
      'nx.json',
      '.eslintrc.json',
      'cdk.json',
      'cdk.out/',
      'tsconfig*.json',
      '*.d.ts',
    ],
  },
};

// Changing compiler options will require that you re-run projen twice.
// As the jestConfig is reliant on the current (pre-projen run) version of ./tsconfig.json
const eslintGlobalRules = {
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error'],
  'semi': ['error', 'always'],
  'comma-dangle': ['error', 'always-multiline'],
  'space-before-function-paren': 'off',
  'no-console': 'off',
  'arrow-parens': ['error', 'always'],
  'no-new': 'off',
  'no-empty': 'error',
  'prettier/prettier': 'off',
  'require-await': 'off',
  'array-callback-return': 'error',
  '@typescript-eslint/indent': 'off',
  'import/named': 'off',
};

const tsConfigOptions: TypescriptConfigOptions = {
  compilerOptions: {
    baseUrl: '.',
    rootDir: '.',
    // Add '@App/' as a path import alias for '<rootDir>/src/app/'
    lib: ['ES2022'],
    module: 'CommonJS',
    target: 'ES2022',
    declaration: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    noImplicitAny: true,
    strict: true,
    paths: {
      '@/*': ['../../*'],
      '@BE/*': ['packages/back-end/src/app/*'],
      '@FE/*': ['packages/front-end/src/app/*'],
      '@SharedLib/*': ['packages/shared-lib/src/app/*'],
    },
    // noUnusedLocals: false,
  },
  include: ['packages/back-end/src/**/*.ts', 'packages/front-end/src/**/*.ts', 'packages/shared-lib/src/**/*.ts'],
  exclude: [],
};

const jestOptions: JestOptions = {
  jestConfig: {
    // Add all the special paths to let Jest resolve them properly
    moduleNameMapper: {
      ...(tsConfigOptions.compilerOptions?.paths
        ? pathsToModuleNameMapper(tsConfigOptions.compilerOptions?.paths, {
            prefix: '<rootDir>/',
          })
        : {}),
    },
    coveragePathIgnorePatterns: ['/node_modules/'],
  },
  junitReporting: false,
  extraCliOptions: ['--detectOpenHandles'],
};

const licenseOptions: LicenseOptions = {
  spdx: 'Apache-2.0',
  copyrightOwner: copyrightOwner,
  copyrightPeriod: copyrightPeriod,
};

const root = new typescript.TypeScriptProject({
  authorName: authorName,
  authorOrganization: true,
  defaultReleaseBranch: defaultReleaseBranch,
  description:
    'Easy Genomics web application to help simplify genomic analysis of sequenced genetic data for bioinformaticians utilizing AWS HealthOmics & NextFlow Tower',
  eslint: true,
  jest: true,
  jestOptions: jestOptions,
  githubOptions: {
    pullRequestLintOptions: {
      semanticTitle: true,
      semanticTitleOptions: {
        types: ['feat', 'fix', 'hotfix', 'release', 'refactor', 'chore', 'docs', 'infra'],
      },
    },
  },
  homepage: 'https://github.com/twobulls/easy-genomics',
  licensed: false, // we apply the Apache 2.0 license later
  minNodeVersion: nodeVersion,
  name: '@easy-genomics/root',
  packageManager: javascript.NodePackageManager.PNPM,
  prettier: true,
  prettierOptions,
  // Use the pinned workspace projen version (avoid `pnpm dlx` drift).
  projenCommand: 'pnpm exec projen',
  projenrcTs: true,
  sampleCode: false,
  tsconfig: tsConfigOptions,
  // Disable default github actions workflows generated
  // by projen as we will generate our own later (that uses nx)
  depsUpgradeOptions: { workflow: false },
  buildWorkflow: false,
  pullRequestTemplate: false,
  release: false,
  devDeps: [
    '@aws-sdk/types',
    '@commitlint/cli',
    '@commitlint/config-conventional',
    '@commitlint/cz-commitlint',
    '@types/aws-lambda',
    '@types/uuid',
    '@typescript-eslint/eslint-plugin@^7',
    '@typescript-eslint/parser@^7',
    '@useoptic/optic@^1.0.9',
    'aws-sdk-client-mock',
    'aws-sdk-client-mock-jest',
    'cz-conventional-changelog',
    // eslint 9 is a breaking change: https://github.com/projen/projen/issues/3950#issuecomment-2481314810
    'eslint@^8',
    'eslint-plugin-prettier',
    'husky',
    'lint-staged',
    'validate-branch-name',
    'prettier',
  ],
});

// Apply the global ESLint rules to the root project
if (root.eslint) {
  root.eslint.addRules({ ...eslintGlobalRules });
  root.eslint.addOverride({
    files: ['packages/*/src/**/*.{js,ts,vue}'],
    rules: {
      'import/no-extraneous-dependencies': 'off',
    },
  });
  // Use eslint-config-prettier to disable conflicting rules; avoid eslint-plugin-prettier runtime dependency.
  root.eslint.addExtends('plugin:@typescript-eslint/recommended', 'prettier');
}
root.removeScript('build');
root.addScripts({
  // Development convenience scripts
  ['build-back-end']:
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/back-end --verbose=true --outputStyle=stream',
  ['build-front-end']:
    'nx reset && pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/front-end --verbose=true',
  ['build-and-deploy']:
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/back-end --verbose=true --outputStyle=stream && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/back-end --verbose=true --outputStyle=stream && ' +
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/front-end --verbose=true --outputStyle=stream && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/front-end --verbose=true --outputStyle=stream',
  ['prettier']: "prettier --write '{**/*,*}.{js,ts,vue,scss,json,md,html,mdx}'",
  ['upgrade']:
    'pnpm dlx projen upgrade && ' +
    'pnpm nx run-many --targets=upgrade --projects=@easy-genomics/shared-lib,@easy-genomics/back-end,@easy-genomics/front-end',
  // CI/CD convenience scripts
  ['cicd-build-deploy-back-end']:
    'export CI_CD=true NX_SKIP_NX_CACHE=true && ' +
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/back-end --verbose=true --outputStyle=stream && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/back-end --verbose=true --outputStyle=stream',
  ['cicd-build-deploy-front-end']:
    'export CI_CD=true NX_SKIP_NX_CACHE=true && ' +
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/front-end --verbose=true --outputStyle=stream && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/front-end --verbose=true --outputStyle=stream',
  ['prepare']: 'husky || true', // Enable Husky each time projen is synthesized
  ['projen']: 'nx reset; pnpm exec projen', // Clear NX cache each time projen is synthesized to avoid cache disk-space overconsumption
  ['pre-commit']: 'lint-staged',
});

root.addFields({
  'lint-staged': {
    '{**/*,*}.{js,ts,vue,scss,json,md,html,mdx}': ['prettier --write'],
    'packages/front-end/src/**/*.{js,ts}': ['pnpm --prefix packages/front-end run lint'],
    'packages/back-end/src/**/*.{js,ts}': ['pnpm --prefix packages/back-end run lint'],
    'packages/shared-lib/src/**/*.{js,ts}': ['pnpm --prefix packages/shared-lib run lint'],
  },
});

// Defines the Easy Genomics 'shared-lib' subproject
const sharedLib = new typescript.TypeScriptProject({
  parent: root,
  name: '@easy-genomics/shared-lib',
  outdir: './packages/shared-lib',
  defaultReleaseBranch: defaultReleaseBranch,
  docgen: false,
  sampleCode: false,
  authorName: authorName,
  authorOrganization: true,
  licensed: false, // we apply the Apache 2.0 license later
  // Use same settings from root project
  packageManager: root.package.packageManager,
  projenCommand: root.projenCommand,
  minNodeVersion: root.minNodeVersion,
  deps: [
    '@aws-sdk/client-api-gateway',
    '@aws-sdk/client-cognito-identity-provider',
    `@aws-sdk/client-omics@${awsSdkClientOmicsVersion}`,
    '@aws-sdk/client-s3',
    '@aws-sdk/client-secrets-manager@^3.782.0',
    'aws-cdk',
    'aws-cdk-lib',
    'aws-lambda',
    'js-yaml',
    'strnum',
    'uuid',
    'zod',
  ],
  devDeps: [
    '@types/aws-lambda',
    '@types/js-yaml',
    '@types/uuid',
    '@redocly/cli@~1.34.15',
    'aws-cdk-lib',
    'openapi-typescript',
    'tsx',
    'typescript-json-schema',
    'zod-to-json-schema@~3.24.6',
  ],
  tsconfig: {
    ...tsConfigOptions,
    compilerOptions: {
      ...tsConfigOptions.compilerOptions,
      baseUrl: '.',
      paths: {
        '@BE/*': ['../packages/back-end/src/app/*'],
        '@FE/*': ['../packages/front-end/src/app/*'],
        '@SharedLib/*': ['src/app/*'],
      },
    },
  },
});
sharedLib.addScripts({
  ['lint']: "eslint 'src/**/*.{js,ts}' --fix",
});
sharedLib.addTask('generate:openapi', { exec: 'tsx src/app/openapi/generate-openapi.ts' });
sharedLib.addTask('lint:openapi', { exec: 'redocly lint src/app/openapi/easy-genomics-api.yaml' });
sharedLib.addTask('generate:api-types', {
  exec: 'openapi-typescript src/app/openapi/easy-genomics-api.yaml -o src/app/types/easy-genomics/generated.d.ts',
});
sharedLib.preCompileTask.prependExec('pnpm run generate:api-types');

if (sharedLib.eslint) {
  sharedLib.eslint.addRules({ ...eslintGlobalRules });
  // Keep ESLint independent from prettier plugin runtime resolution under pnpm.
  sharedLib.eslint.addExtends('prettier');
}

// Defines the Easy Genomics 'back-end' subproject
const backEndApp = new awscdk.AwsCdkTypeScriptApp({
  parent: root,
  name: '@easy-genomics/back-end',
  outdir: './packages/back-end',
  cdkVersion: cdkVersion,
  defaultReleaseBranch: defaultReleaseBranch,
  docgen: false,
  eslint: true,
  jest: true,
  jestOptions: {
    jestConfig: {
      // Ensure Jest can resolve tsconfig path aliases used by lambda handlers/tests.
      moduleNameMapper: {
        '^@BE/(.*)$': '<rootDir>/src/app/$1',
        '^@SharedLib/(.*)$': '<rootDir>/../shared-lib/src/app/$1',
        '^@FE/(.*)$': '<rootDir>/../front-end/src/app/$1',
        '^@easy-genomics/shared-lib/lib/app/(.*)$': '<rootDir>/../shared-lib/src/app/$1',
      },
    },
  },
  lambdaAutoDiscover: false,
  requireApproval: awscdk.ApprovalLevel.NEVER,
  sampleCode: false,
  authorName: authorName,
  authorOrganization: true,
  licensed: false, // we apply the Apache 2.0 license later
  packageManager: root.package.packageManager,
  projenCommand: root.projenCommand,
  minNodeVersion: root.minNodeVersion,
  tsconfig: {
    ...tsConfigOptions,
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@BE/*': ['src/app/*'],
        '@FE/*': ['../front-end/src/app/*'],
        '@SharedLib/*': ['../shared-lib/src/app/*'],
        // Some packages import shared-lib via its compiled output path.
        // During tests/ts-jest compilation in a workspace, `lib/` may not exist yet,
        // so we map those deep imports to the source tree.
        '@easy-genomics/shared-lib/lib/app/*': ['../shared-lib/src/app/*'],
      },
    },
  },
  deps: [
    '@aws-crypto/client-node',
    '@aws-crypto/decrypt-node',
    '@aws-crypto/encrypt-node',
    '@aws-sdk/client-bedrock-runtime@3.782.0',
    '@aws-sdk/client-cloudformation@^3.786.0',
    '@aws-sdk/client-cloudwatch-logs@3.782.0',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-dynamodb',
    `@aws-sdk/client-omics@${awsSdkClientOmicsVersion}`,
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sns',
    '@aws-sdk/client-sqs',
    '@aws-sdk/client-ssm',
    '@aws-sdk/client-sso-oidc',
    '@aws-sdk/client-sts',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-secrets-manager@^3.782.0',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/lib-storage',
    '@aws-sdk/s3-request-presigner',
    '@aws-sdk/types',
    '@aws-sdk/util-dynamodb',
    '@easy-genomics/shared-lib@workspace:*',
    'archiver',
    'aws-cdk-lib',
    'aws-lambda',
    'base64-js',
    'cdk-nag',
    'dotenv',
    'jsonwebtoken',
    'uuid',
  ],
  devDeps: [
    '@aws-sdk/types',
    '@types/aws-lambda',
    '@types/express',
    '@types/jsonwebtoken',
    '@types/node',
    '@types/archiver',
    '@types/uuid',
    'aws-jwt-verify',
    'aws-sdk-client-mock',
    'eslint-plugin-prettier',
    'express',
    'prettier',
    'tsx',
  ],
});
backEndApp.addScripts({
  ['cdk-audit']: 'export CDK_AUDIT=true && pnpm exec projen build',
  ['build']: 'pnpm exec projen compile && pnpm exec projen test && pnpm exec projen build',
  // Pre-deploy safety check. Runs before every `cdk deploy` and, on the
  // first run against an un-armed environment, automatically takes an
  // on-demand backup, enables `DeletionProtectionEnabled`, and enables
  // PITR on every existing easy-genomics DynamoDB table before
  // CloudFormation gets a chance to issue DeleteTable during the
  // stack-split migration. Missing tables (fresh / greenfield deploys)
  // are skipped, so there is no bypass flag; the guard is always on.
  // See `scripts/preflight-deletion-protection.ts` and
  // `docs/operations/migration-runbooks/EASY_GENOMICS_PROD_MIGRATION.md`.
  ['preflight-deletion-protection']: 'tsx scripts/preflight-deletion-protection.ts',
  // NOTE: `--all` is required now that the back-end synthesizes multiple
  // top-level stacks (`*-main-back-end-stack`, `*-easy-genomics-api-stack`,
  // and optionally `*-api-domain-stack`). Without it, `cdk deploy` refuses to
  // pick a default and exits with "specify which stacks to use".
  //
  // The preflight guard runs AFTER `cdk bootstrap` (which only touches the
  // CDK toolkit stack, not app resources) and BEFORE any app-stack deploy,
  // so a failing guard aborts without any destructive CloudFormation call.
  ['deploy']: 'pnpm cdk bootstrap && pnpm run preflight-deletion-protection && pnpm exec projen deploy --all',
  ['build-and-deploy']: 'pnpm -w run build-back-end && pnpm run deploy --require-approval any-change', // Run root build-back-end script to inc shared-lib
  ['lint']: "eslint 'src/**/*.{js,ts}' --fix",
  ['local-server']: 'tsx src/local-server/index.ts',
  ['local-server:watch']: 'tsx watch src/local-server/index.ts',
  ['invoke-process-handler']: 'tsx src/local-server/invoke-process-handler.ts',
  ['backfill-omics-run-tags']: 'tsx scripts/backfill-omics-run-tags.ts',
  ['backfill-omics-run-tags:dry-run']: 'tsx scripts/backfill-omics-run-tags.ts --dry-run',
  ['backfill-workflow-run-history-and-usages']: 'tsx scripts/backfill-workflow-run-history-and-usages.ts',
  ['backfill-workflow-run-history-and-usages:dry-run']:
    'tsx scripts/backfill-workflow-run-history-and-usages.ts --dry-run',
  ['seed-workflow-tagging-test-runs']: 'tsx scripts/seed-workflow-tagging-test-runs.ts',
  ['seed-workflow-tagging-test-runs:dry-run']: 'tsx scripts/seed-workflow-tagging-test-runs.ts --dry-run',
  ['migrate-lab-s3-bucket-refs']: 'tsx scripts/migrate-lab-s3-bucket-refs.ts',
  ['migrate-lab-s3-bucket-refs:dry-run']: 'tsx scripts/migrate-lab-s3-bucket-refs.ts --dry-run',
});

if (backEndApp.eslint) {
  backEndApp.eslint.addRules({ ...eslintGlobalRules });
  // `src/local-server/**` is a dev-only entrypoint, so it may import devDependencies.
  // Keep the default rule behavior everywhere else.
  backEndApp.eslint.addRules({
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: ['**/test/**', '**/build-tools/**', '**/src/local-server/**'],
        optionalDependencies: false,
        peerDependencies: true,
      },
    ],
  });
  backEndApp.eslint.addExtends('prettier');
}
// Defines the Easy Genomics 'front-end' subproject
const frontEndApp = new awscdk.AwsCdkTypeScriptApp({
  parent: root,
  name: '@easy-genomics/front-end',
  outdir: './packages/front-end',
  cdkVersion: cdkVersion,
  defaultReleaseBranch: defaultReleaseBranch,
  docgen: false,
  eslint: true,
  jest: true,
  jestOptions: {
    jestConfig: {
      moduleNameMapper: {
        '^@FE/(.*)$': '<rootDir>/src/app/$1',
        '^@SharedLib/(.*)$': '<rootDir>/../shared-lib/src/app/$1',
        '^@BE/(.*)$': '<rootDir>/../back-end/src/app/$1',
      },
    },
  },
  lambdaAutoDiscover: false,
  requireApproval: awscdk.ApprovalLevel.NEVER,
  sampleCode: false,
  // Copyright & Licensing
  authorName: authorName,
  authorOrganization: true,
  licensed: false, // we apply the Apache 2.0 license later
  // Use same settings from root project
  packageManager: root.package.packageManager,
  projenCommand: root.projenCommand,
  minNodeVersion: root.minNodeVersion,
  tsconfig: {
    ...tsConfigOptions,
    extends: TypescriptConfigExtends.fromPaths(['./.nuxt/tsconfig.json']),
    compilerOptions: {
      baseUrl: '.',
      lib: ['DOM', 'ES2022'],
      sourceMap: true,
      types: ['node', 'vue'],
      verbatimModuleSyntax: false,
      paths: {
        '@/*': ['../../*'],
        '@FE/*': ['src/app/*'],
        '@BE/*': ['../packages/back-end/src/app/*'],
        '@SharedLib/*': ['../packages/shared-lib/src/app/*'],
        '#app': ['node_modules/nuxt/dist/app'], // Nuxt
        '#ui/*': ['node_modules/@nuxt/ui/dist/runtime/*'], // NuxtUI
      },
    },
    include: ['.nuxt/**/*.d.ts', 'auto-imports.d.ts', 'components.d.ts', '**/*.ts', '**/*d.ts', '**/*.vue'],
  },
  deps: [
    '@aws-amplify/ui-vue@3.1.30',
    `@aws-sdk/client-omics@${awsSdkClientOmicsVersion}`,
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    '@aws-sdk/util-format-url',
    '@easy-genomics/shared-lib@workspace:*',
    '@iconify-json/heroicons',
    '@iconify-json/lucide',
    '@iconify-json/logos@1.2.10',
    '@nuxt/ui@2.18.4', // Lock to version 2.18.4 due to input text bug
    '@pinia/nuxt',
    '@playwright/test',
    '@smithy/types',
    '@smithy/url-parser',
    '@vueuse/core',
    '@vueuse/integrations',
    '@vueuse/nuxt',
    'amazon-cognito-identity-js',
    'aws-amplify@5.3.18',
    'axios',
    'cdk-nag',
    'class-variance-authority',
    'clsx',
    'date-fns',
    'dotenv',
    'esrun',
    'file-saver',
    'jwt-decode',
    'nuxt',
    'pinia',
    'pinia-plugin-persistedstate',
    'playwright',
    'playwright-core',
    'playwright-slack-report',
    'posthog-js',
    'prettier-plugin-tailwindcss',
    'sass',
    'tailwind-merge',
    'tailwindcss',
    'unplugin-vue-components',
    'uuid',
    'zod',
  ],
  devDeps: [
    '@aws-sdk/types',
    '@nuxt/types',
    '@nuxtjs/eslint-config-typescript',
    '@types/node',
    '@types/uuid',
    '@typescript-eslint/parser',
    'eslint-plugin-prettier',
    'eslint-plugin-vue',
    'kill-port',
    'typed-openapi',
    'vue-eslint-parser',
  ],
});
frontEndApp.addScripts({
  ['cdk-audit']: 'export CDK_AUDIT=true && pnpm exec projen build',
  ['build']:
    'pnpm run nuxt-reset && pnpm run nuxt-prepare && pnpm exec projen test && pnpm exec projen build && pnpm run nuxt-load-settings && pnpm run nuxt-generate',
  ['deploy']: 'pnpm cdk bootstrap && pnpm exec projen deploy',
  ['build-and-deploy']:
    'pnpm -w run build-front-end && pnpm cdk bootstrap && pnpm exec projen deploy --require-approval any-change', // Run root build-front-end script to inc shared-lib
  ['nuxt-dev']: 'pnpm -w run build-front-end && pnpm kill-port 3000 && nuxt dev',
  ['nuxt-load-settings']: 'npx esrun nuxt-load-configuration-settings.ts',
  ['nuxt-generate']: 'nuxt generate',
  ['nuxt-prepare']: 'nuxt prepare', // Required to create front-end/.nuxt/tsconfig.json
  ['nuxt-preview']: 'nuxt preview',
  ['nuxt-postinstall']: 'nuxt prepare',
  ['test-e2e']:
    'pnpm run test-e2e:sys-admin || true && pnpm run test-e2e:org-admin || true && pnpm run test-e2e:lab-manager || true && pnpm run test-e2e:lab-technician || true',
  ['test-e2e:sys-admin']: 'USER_TYPE=sys-admin npx playwright test --project=sys-admin',
  ['test-e2e:org-admin']: 'USER_TYPE=org-admin npx playwright test --project=org-admin',
  ['test-e2e:lab-manager']: 'USER_TYPE=lab-manager npx playwright test --project=lab-manager',
  ['test-e2e:lab-technician']: 'USER_TYPE=lab-technician npx playwright test --project=lab-technician',
  ['test-e2e:sys-admin:headed']: 'USER_TYPE=sys-admin npx playwright test --project=sys-admin --ui',
  ['test-e2e:org-admin:headed']: 'USER_TYPE=org-admin npx playwright test --project=org-admin --ui',
  ['test-e2e:lab-manager:headed']: 'USER_TYPE=lab-manager npx playwright test --project=lab-manager --ui',
  ['test-e2e:lab-technician:headed']: 'USER_TYPE=lab-technician npx playwright test --project=lab-technician --ui',
  ['nuxt-reset']: 'nuxt cleanup',
  ['nftower-spec-to-zod']: "pnpm typed-openapi ../shared-lib/src/app/types/nf-tower/seqera-api-latest.yml -r 'zod'",
  ['lint']: "eslint 'src/**/*.{js,ts}' --fix",
  ['local-server']: 'USE_LOCAL_BACKEND=1 pnpm run nuxt-dev',
});

// Setup Frontend App ESLint configuration
if (frontEndApp.eslint) {
  frontEndApp.eslint.addRules({ ...eslintGlobalRules });
  frontEndApp.eslint.addExtends('@nuxtjs/eslint-config-typescript', 'prettier', 'plugin:vue/vue3-recommended');
  frontEndApp.eslint.addPlugins('eslint-plugin-vue', 'vue');
}

// Apply additional project setup
new PnpmWorkspace(root);
new VscodeSettings(root);
new Nx(root);
new Husky(root);
new GithubActionsCICDRelease(root, {
  environment: 'quality',
  pnpmVersion: pnpmVersion,
  onPushBranch: 'development',
  e2e: true,
});
new GithubActionsCICDRelease(root, {
  environment: 'quality-uat',
  pnpmVersion: pnpmVersion,
  onPushBranch: 'staging',
  e2e: true,
});
new GithubActionsCICDRelease(root, {
  environment: 'sandbox',
  pnpmVersion: pnpmVersion,
  onPushBranch: 'infra/*',
  e2e: false,
});
new GithubActionsApiDiffCheck(root, { pnpmVersion });
new ApacheLicense(root, licenseOptions);
new ApacheLicense(backEndApp, licenseOptions);
new ApacheLicense(frontEndApp, licenseOptions);
new ApacheLicense(sharedLib, licenseOptions);

// Provision templated project folders structure with README.md descriptions.
setupProjectFolders(root);

root.package.addField('packageManager', `pnpm@${pnpmVersion}`);

root.gitignore.addPatterns(
  '*.bkp',
  '*.dtmp',
  '.env',
  '.env.*',
  '.idea',
  '.vscode',
  '.DS_Store',
  'test-reports',
  '.nuxt',
  '.output',
  'dist',
  'config/easy-genomics.yaml',
  'packages/back-end/cdk.context.json',
  'packages/front-end/test-results',
  'packages/front-end/tests/e2e/.auth/*.json',
  'packages/front-end/playwright-report',
  '.pnpm-store',
);
// Exception: Include .env example files (used for local dev setup documentation)
root.gitignore.addPatterns('!packages/back-end/.env.local.example', '!config/.env.nuxt.local.example');

// Security: force minimum patched versions for transitive deps with active Dependabot alerts.
// These overrides survive future `pnpm exec projen` runs because they live here, not in package.json.
// @opentelemetry/core (CVE-2026-54285) is excluded: the fix requires a 1.x→2.x major bump that
// breaks all @opentelemetry/*@0.53.0/1.x peer deps in the lockfile — needs a coordinated suite
// upgrade tracked separately.
root.addFields({
  pnpm: {
    overrides: {
      // CVE-2026-12151 (WebSocket DoS), CVE-2026-9679 (header injection),
      // CVE-2026-11525 (SameSite downgrade), CVE-2026-6733 (queue poisoning)
      // Capped at <7: undici 7+ requires Node.js 22; Lambda + CI run Node 20
      undici: '>=6.27.0 <7.0.0',
      // CVE-2026-12143 (CRLF injection via multipart field names)
      // Bare key (no @version selector): pnpm matches selectors against the declared specifier,
      // not the resolved version. @types/node-fetch declares form-data@^3.0.0 but resolves to
      // 4.0.4, so @3/@4 selectors don't match. Bare key catches all paths.
      'form-data': '>=4.0.6',
      // DOMPurify ALLOWED_ATTR permanent pollution + Trusted Types policy bypass
      dompurify: '>=3.4.11',
      // CVE-2026-53655 (file smuggling via PAX size override on intermediary headers)
      tar: '>=7.5.16',
      // CVE-2026-54269 (schema-derived names can shadow runtime-significant properties)
      // Capped at <8: protobufjs 8.x has breaking API changes; all consumers pin ~7
      protobufjs: '>=7.6.3 <8.0.0',
      // CVE-2026-53550 (quadratic-complexity DoS in merge key handling via repeated aliases)
      // Also forces any transitive js-yaml 3.x to resolve to the safe 4.x line
      'js-yaml': '>=4.1.1',

      // --- PR3: CRITICAL severity ---
      // CVE-2024-55565: newline injection in quoted shell args (RCE in shell pipelines)
      'shell-quote': '>=1.8.4',
      // CVE-2022-24433, CVE-2022-25912, CVE-2024-22012: option-parsing RCE + blockUnsafeOperations bypass
      'simple-git': '>=3.36.0',
      // CVE-2025-29244 + 3 others + XMLBuilder comment/CDATA injection: entity expansion / encoding bypass DoS and XSS
      'fast-xml-parser': '>=5.7.0',

      // --- PR3: HIGH severity ---
      // 9 advisories: ReDoS via repeated wildcards and nested extglobs
      // Capped at <10: minimatch 10.x is ESM-only and breaks eslint-plugin-import@2.x CJS default import.
      // eslint-plugin-import declares ^3.1.2 (CJS-compatible); scoped override keeps it on safe 3.x.
      minimatch: '>=9.0.7 <10.0.0',
      'eslint-plugin-import>minimatch': '>=3.1.2 <4.0.0',
      // 6 advisories: ASN.1 recursion, signature forgery, BigInt DoS, basicConstraints bypass
      'node-forge': '>=1.4.0',
      // CVE-2024-37890 + 2 others: memory exhaustion DoS from tiny fragments
      ws: '>=8.21.0',
      // CVE-2024-55565 + 3 others: ReDoS via extglob quantifiers + POSIX method injection
      picomatch: '>=4.0.4',

      // --- PR3: HIGH severity (batch 2) ---
      // CVE-2025-27152, CVE-2024-55417: prototype pollution + unbounded recursion DoS
      flatted: '>=3.4.2',
      // CVE-2024-21501: prototype pollution via __proto__ in defaults merge
      defu: '>=6.1.5',
      // CVE-2024-55970: prototype pollution in fromJS()
      immutable: '>=5.1.5',
      // CVE-2022-24045: HMAC signature not verified — auth bypass
      jws: '>=3.2.3',
      // CVE-2023-26136: per-instance prototype hijack via cookie.set()
      'js-cookie': '>=3.0.7',
      // CVE-2024-55964: CLI command injection via -c/--cmd flag
      glob: '>=10.5.0',
      // CVE-2025-29823 + 1: host header injection + open redirect via Referer
      koa: '>=2.16.4',
      // CVE-2025-31136: attribute values with unescaped XML special chars
      'fast-xml-builder': '>=1.1.7',
      // CVE-2024-21501: DoS via DOCTYPE entity expansion (billion laughs variant)
      svgo: '>=3.3.3',
      // CVE-2021-23337, CVE-2020-28500, CVE-2019-10744: template injection + prototype pollution
      lodash: '>=4.17.23',
      // CVE-2024-55955, CVE-2023-42226: RCE via RegExp.flags + CPU exhaustion DoS
      'serialize-javascript': '>=7.0.5',
    },
  },
});

// Synthesize the project
root.synth();
