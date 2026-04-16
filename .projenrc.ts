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
import { GithubActionsCICDRelease } from './projenrc/github-actions-cicd-release';
import { Husky } from './projenrc/husky';
import { Nx } from './projenrc/nx';
import { PnpmWorkspace } from './projenrc/pnpm';
import { VscodeSettings } from './projenrc/vscode';

const defaultReleaseBranch = 'main';
const cdkVersion = '2.176.0';
const nodeVersion = '20.15.0';
const pnpmVersion = '9.15.0';
const awsSdkClientOmicsVersion = '^3.1019.0';
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
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/back-end --verbose=true',
  ['build-front-end']:
    'nx reset && pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/front-end --verbose=true',
  ['build-and-deploy']:
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/back-end --verbose=true && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/back-end --verbose=true && ' +
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/front-end --verbose=true && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/front-end --verbose=true',
  ['prettier']: "prettier --write '{**/*,*}.{js,ts,vue,scss,json,md,html,mdx}'",
  ['upgrade']:
    'pnpm dlx projen upgrade && ' +
    'pnpm nx run-many --targets=upgrade --projects=@easy-genomics/shared-lib,@easy-genomics/back-end,@easy-genomics/front-end',
  // CI/CD convenience scripts
  ['cicd-build-deploy-back-end']:
    'export CI_CD=true && ' +
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/back-end --verbose=true && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/back-end --verbose=true',
  ['cicd-build-deploy-front-end']:
    'export CI_CD=true && ' +
    'pnpm nx run-many --targets=build --projects=@easy-genomics/shared-lib,@easy-genomics/front-end --verbose=true && ' +
    'pnpm nx run-many --targets=deploy --projects=@easy-genomics/front-end --verbose=true',
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
    'aws-cdk',
    'aws-cdk-lib',
    'aws-lambda',
    'js-yaml',
    'strnum',
    'uuid',
    'zod',
  ],
  devDeps: ['@types/aws-lambda', '@types/js-yaml', '@types/uuid', 'aws-cdk-lib', 'openapi-typescript'],
  tsconfig: {
    ...tsConfigOptions,
    compilerOptions: {
      ...tsConfigOptions.compilerOptions,
      // Emit lib/app/... (not lib/src/app/...) so deep imports like
      // @easy-genomics/shared-lib/lib/app/utils/common resolve after compile.
      rootDir: 'src',
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
      },
      collectCoverageFrom: ['<rootDir>/src/app/**/*.ts', '!<rootDir>/src/app/**/*.d.ts'],
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
        '@FE/*': ['../packages/front-end/src/app/*'],
        '@SharedLib/*': ['../packages/shared-lib/src/app/*'],
      },
    },
  },
  deps: [
    '@aws-crypto/client-node',
    '@aws-crypto/decrypt-node',
    '@aws-crypto/encrypt-node',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-dynamodb',
    `@aws-sdk/client-omics@${awsSdkClientOmicsVersion}`,
    '@aws-sdk/client-ses',
    '@aws-sdk/client-sns',
    '@aws-sdk/client-sqs',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-ssm',
    '@aws-sdk/client-sso-oidc',
    '@aws-sdk/client-sts',
    '@aws-sdk/client-s3',
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
  ['deploy']: 'pnpm cdk bootstrap && pnpm exec projen deploy',
  ['build-and-deploy']: 'pnpm -w run build-back-end && pnpm run deploy --require-approval any-change', // Run root build-back-end script to inc shared-lib
  ['lint']: "eslint 'src/**/*.{js,ts}' --fix",
  ['local-server']: 'tsx src/local-server/index.ts',
  ['local-server:watch']: 'tsx watch src/local-server/index.ts',
  ['invoke-process-handler']: 'tsx src/local-server/invoke-process-handler.ts',
  ['backfill-omics-run-tags']: 'tsx scripts/backfill-omics-run-tags.ts',
  ['backfill-omics-run-tags:dry-run']: 'tsx scripts/backfill-omics-run-tags.ts --dry-run',
  ['recompute-laboratory-run-retention']:
    'tsx scripts/recompute-laboratory-run-retention.ts --laboratoryId $LAB_ID --retentionMonths $RETENTION_MONTHS',
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
    'prettier-plugin-tailwindcss',
    'sass',
    'tailwind-merge',
    'tailwindcss',
    'unplugin-vue-components',
    'uuid',
    'vue@3.5.32',
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

// Synthesize the project
root.synth();
