import { IConstruct } from 'constructs';
import { Component, github, typescript } from 'projen';

// Custom projen component that configures a Github Actions Workflow.
export class GithubActionsCICDRelease extends Component {
  private readonly environment: string;
  private readonly pnpmVersion: string;
  private readonly e2e: boolean;
  private readonly onPushBranch?: string;

  constructor(
    rootProject: typescript.TypeScriptProject,
    options: {
      environment: string;
      pnpmVersion: string;
      onPushBranch?: string;
      e2e: boolean;
    },
  ) {
    super(<IConstruct>rootProject);
    this.environment = options.environment;
    this.pnpmVersion = options.pnpmVersion;
    this.onPushBranch = options.onPushBranch;
    this.e2e = options.e2e;

    const wf = new github.GithubWorkflow(rootProject.github!, `cicd-release-${this.environment}`);
    const runsOn = ['ubuntu-latest'];
    if (this.onPushBranch) {
      wf.on({ push: { branches: [this.onPushBranch] } });
    } else {
      wf.on({ push: { branches: ['main'] } });
    }

    const jobs: Record<string, github.workflows.Job> = {
      ['build-deploy-back-end']: {
        name: 'Build & Deploy Back-End',
        runsOn,
        environment: this.environment,
        env: this.loadEnv(),
        permissions: {
          idToken: github.workflows.JobPermission.WRITE,
          contents: github.workflows.JobPermission.WRITE,
          actions: github.workflows.JobPermission.READ,
        },
        steps: [
          ...this.bootstrapSteps(),
          ...this.configureAwsCredentials(),
          {
            name: 'Run CI/CD Build & Deploy Back-End',
            run: 'pnpm run cicd-build-deploy-back-end',
          },
        ],
      },
      ['build-deploy-front-end']: {
        name: 'Build & Deploy Front-End',
        needs: ['build-deploy-back-end'],
        runsOn,
        environment: this.environment,
        env: this.loadEnv(),
        permissions: {
          idToken: github.workflows.JobPermission.WRITE,
          contents: github.workflows.JobPermission.WRITE,
          actions: github.workflows.JobPermission.READ,
        },
        steps: [
          ...this.bootstrapSteps(),
          ...this.configureAwsCredentials(),
          this.deriveApiUrlsStep(),
          {
            name: 'Run CI/CD Build & Deploy Front-End',
            run: 'pnpm cicd-build-deploy-front-end',
          },
        ],
      },
    };

    if (this.e2e) {
      jobs['run-e2e-tests'] = {
        name: 'Run E2E Tests',
        needs: ['build-deploy-front-end'],
        runsOn,
        environment: this.environment,
        env: this.loadEnv(),
        permissions: {
          idToken: github.workflows.JobPermission.WRITE,
          contents: github.workflows.JobPermission.WRITE,
          actions: github.workflows.JobPermission.READ,
        },
        steps: [
          ...this.bootstrapSteps(),
          ...this.configureAwsCredentials(),
          this.deriveApiUrlsStep(),
          {
            name: 'Clear Playwright Cache',
            run: 'rm -rf /home/runner/.cache/ms-playwright',
          },
          {
            name: 'Install Playwright + Chromium Only and Slack Reporter',
            run: 'pnpm add -Dw @playwright/test && pnpm add -Dw playwright-slack-report && npx playwright install chromium',
          },
          {
            name: 'Run E2E Tests',
            workingDirectory: 'packages/front-end',
            run: 'pnpm run test-e2e',
            continueOnError: true,
          },
          {
            name: 'Always Succeed Step',
            if: 'failure()',
            run: 'echo "E2E tests failed, but we are allowing the pipeline to succeed."',
          },
        ],
      };
    }

    wf.addJobs(jobs);
  }

  private loadEnv(): Record<string, string> {
    return {
      // NODE ENV settings
      'NODE_OPTIONS': '--max-old-space-size=8192',
      // Shared settings
      'AWS_ACCOUNT_ID': '${{ secrets.AWS_ACCOUNT_ID }}',
      'AWS_REGION': '${{ secrets.AWS_REGION }}',
      'ENV_TYPE': '${{ vars.ENV_TYPE }}',
      'ENV_NAME': '${{ vars.ENV_NAME }}',
      'APP_DOMAIN_NAME': '${{ vars.APP_DOMAIN_NAME }}',
      'AWS_HOSTED_ZONE_ID': '${{ secrets.AWS_HOSTED_ZONE_ID }}', // Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
      'AWS_CERTIFICATE_ARN': '${{ secrets.AWS_CERTIFICATE_ARN }}', // Not required when env-type: 'dev', but must exist for the same app-domain-name if configured
      // Back-End specific settings
      'JWT_SECRET_KEY': '${{ secrets.JWT_SECRET_KEY }}',
      'SYSTEM_ADMIN_EMAIL': '${{ vars.SYSTEM_ADMIN_EMAIL }}',
      'SYSTEM_ADMIN_PASSWORD': '${{ secrets.SYSTEM_ADMIN_PASSWORD }}',
      'ORG_ADMIN_EMAIL': '${{ vars.ORG_ADMIN_EMAIL }}',
      'ORG_ADMIN_PASSWORD': '${{ secrets.ORG_ADMIN_PASSWORD }}',
      'LAB_MANAGER_EMAIL': '${{ vars.LAB_MANAGER_EMAIL }}',
      'LAB_MANAGER_PASSWORD': '${{ secrets.LAB_MANAGER_PASSWORD }}',
      'LAB_TECHNICIAN_EMAIL': '${{ vars.LAB_TECHNICIAN_EMAIL }}',
      'LAB_TECHNICIAN_PASSWORD': '${{ secrets.LAB_TECHNICIAN_PASSWORD }}',
      'TEST_ACCESS_TOKEN': '${{ secrets.TEST_ACCESS_TOKEN }}',
      'TEST_S3_URL': '${{ secrets.TEST_S3_URL }}',
      'TEST_WORKSPACE_ID': '${{ secrets.TEST_WORKSPACE_ID }}',
      'TEST_INVITE_EMAIL': '${{ vars.TEST_INVITE_EMAIL }}',
      // Front-End specific settings
      'SLACK_E2E_TEST_WEBHOOK_URL': '${{ vars.SLACK_E2E_TEST_WEBHOOK_URL }}',
    };
  }

  private bootstrapSteps(): github.workflows.JobStep[] {
    const project = this.project as typescript.TypeScriptProject;
    return [
      {
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: { 'fetch-depth': 0 },
      },
      {
        name: 'Install pnpm',
        uses: 'pnpm/action-setup@v4',
        with: { version: this.pnpmVersion },
      },
      {
        name: 'Setup node',
        uses: 'actions/setup-node@v4',
        with: {
          'node-version': project.minNodeVersion,
          cache: 'pnpm',
        },
      },
      // Ensures the nx cache for the current commit sha is restored
      // before running any subsequent commands. This allows outputs
      // from any previous target executions to become available and
      // avoids re-running previously cached targets unnecessarily.
      // This action also updates the cache with any changes and the
      // end of the job so that subsequent jobs get the updated cache.
      {
        name: 'Nx cache',
        uses: 'actions/cache@v4',
        with: {
          path: 'node_modules/.cache/nx',
          'fail-on-cache-miss': false,
          key: 'nx-${{ github.repository_id }}-${{ github.sha }}',
        },
      },
      {
        name: 'Install dependencies',
        run: 'pnpm install --frozen-lockfile',
      },
      // This determines the sha of the last successful build on the main branch
      // (known as the base sha) and adds to env vars along with the current (head) sha.
      // The commits between the base and head sha's is used by subsequent 'nx affected'
      // commands to determine what packages have changed so targets only run
      // against those packages.
      {
        name: 'Derive SHAs for nx affected commands',
        uses: 'nrwl/nx-set-shas@v4',
        with: { 'main-branch-name': 'main' },
      },
    ];
  }

  private configureAwsCredentials(): github.workflows.JobStep[] {
    return [
      {
        name: 'Configure AWS Credentials',
        id: 'configure_iam_credentials',
        uses: 'aws-actions/configure-aws-credentials@v4',
        with: {
          'role-to-assume': 'arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/GitHub_to_AWS_via_FederatedOIDC',
          'role-session-name': 'GitHub_to_AWS_via_FederatedOIDC',
          'role-duration-seconds': 3600,
          'aws-region': '${{ secrets.AWS_REGION }}',
          'audience': 'sts.amazonaws.com',
        },
      },
    ];
  }

  /**
   * Derive split-stack API URLs from CloudFormation outputs.
   *
   * `AWS_API_GATEWAY_URL` must come from the shared "main-back-end" stack
   * because it owns `/nf-tower` and `/aws-healthomics`.
   *
   * `AWS_EASY_GENOMICS_API_URL` comes from the dedicated easy-genomics stack.
   * This output can be absent in pre-migration environments, in which case we
   * leave the var unset and the UI falls back to
   * `${AWS_API_GATEWAY_URL}/easy-genomics`.
   */
  private deriveApiUrlsStep(): github.workflows.JobStep {
    return {
      name: 'Derive API URLs from stack outputs',
      // Note: projen's `JobStep` typing doesn't currently expose `shell`, but
      // GitHub Actions supports it and we want bash strict mode semantics.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ shell: 'bash' } as any),
      run: [
        'set -euo pipefail',
        'MAIN_STACK_NAME="${ENV_TYPE}-${ENV_NAME}-main-back-end-stack"',
        'EASY_STACK_NAME="${ENV_TYPE}-${ENV_NAME}-easy-genomics-api-stack"',
        '',
        // Main back-end stack is required in all environments.
        'BASE_URL="$(aws cloudformation describe-stacks \\',
        '  --region "$AWS_REGION" \\',
        '  --stack-name "$MAIN_STACK_NAME" \\',
        "  --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayRestApiUrl`].OutputValue' \\",
        '  --output text)"',
        '',
        'if [ -z "${BASE_URL:-}" ] || [ "${BASE_URL:-}" = "None" ]; then',
        '  echo "Unable to derive AWS_API_GATEWAY_URL from stack output ApiGatewayRestApiUrl in $MAIN_STACK_NAME" >&2',
        '  exit 1',
        'fi',
        '',
        'BASE_URL="${BASE_URL%/}"',
        'echo "AWS_API_GATEWAY_URL=$BASE_URL" >> "$GITHUB_ENV"',
        'echo "Derived AWS_API_GATEWAY_URL=$BASE_URL"',
        '',
        // If the easy-genomics stack does not exist yet, treat as optional.
        'EG_URL="$(aws cloudformation describe-stacks \\',
        '  --region "$AWS_REGION" \\',
        '  --stack-name "$EASY_STACK_NAME" \\',
        "  --query 'Stacks[0].Outputs[?OutputKey==`EasyGenomicsApiUrl`].OutputValue' \\",
        '  --output text 2>/dev/null || true)"',
        '',
        'if [ -n "${EG_URL:-}" ] && [ "${EG_URL:-}" != "None" ]; then',
        '  EG_URL="${EG_URL%/}"',
        '  echo "AWS_EASY_GENOMICS_API_URL=$EG_URL" >> "$GITHUB_ENV"',
        '  echo "Derived AWS_EASY_GENOMICS_API_URL=$EG_URL"',
        'else',
        '  echo "Easy Genomics API output not found in $EASY_STACK_NAME; leaving AWS_EASY_GENOMICS_API_URL unset."',
        'fi',
      ].join('\n'),
    };
  }
}
