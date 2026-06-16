import {
  getAnalyticsDeploymentIdSecretName,
  getAnalyticsSaltSecretName,
} from '@easy-genomics/shared-lib/src/app/utils/analytics-utils';
import { BackEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface AnalyticsConstructProps extends BackEndStackProps {}

/**
 * Provisions the anonymous, per-deployment identifiers used by the privacy-safe
 * upstream analytics layer.
 *
 * It only does one thing: create two AWS Secrets Manager secrets holding a random
 * `deployment_id` and a random `salt`. Both are generated once (on first deploy)
 * by Secrets Manager and reused on every subsequent deploy, so the deployment's
 * identity is stable. Neither value is derived from the AWS account id, domain,
 * hostname or anything else identifying.
 *
 * This construct is only instantiated when `analytics.enabled: true` in
 * `easy-genomics.yaml`. When analytics is off, none of these resources exist.
 *
 * Rotation: to "start fresh", delete both secrets and redeploy — new random
 * values will be generated and the front-end build will pick them up.
 */
export class AnalyticsConstruct extends Construct {
  readonly props: AnalyticsConstructProps;
  readonly deploymentIdSecret: Secret;
  readonly saltSecret: Secret;

  constructor(scope: Construct, id: string, props: AnalyticsConstructProps) {
    super(scope, id);
    this.props = props;

    const removalPolicy: RemovalPolicy = this.props.envType === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Random opaque identifier for this deployment. Generated once, reused on redeploy.
    this.deploymentIdSecret = new Secret(this, `${this.props.namePrefix}-analytics-deployment-id`, {
      secretName: getAnalyticsDeploymentIdSecretName(this.props.namePrefix),
      description:
        'Easy Genomics privacy-safe analytics: random, anonymous per-deployment identifier (deployment_id). ' +
        'Reused across deploys. Delete and redeploy to rotate.',
      removalPolicy,
      generateSecretString: {
        passwordLength: 36,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    // Per-deployment salt for one-way hashing of user / lab / org identifiers.
    this.saltSecret = new Secret(this, `${this.props.namePrefix}-analytics-salt`, {
      secretName: getAnalyticsSaltSecretName(this.props.namePrefix),
      description:
        'Easy Genomics privacy-safe analytics: per-deployment salt used to one-way hash user / lab / org ids. ' +
        'Reused across deploys. Delete and redeploy to rotate.',
      removalPolicy,
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    new CfnOutput(this, 'AnalyticsDeploymentIdSecretName', {
      key: 'AnalyticsDeploymentIdSecretName',
      value: this.deploymentIdSecret.secretName,
    });
    new CfnOutput(this, 'AnalyticsSaltSecretName', {
      key: 'AnalyticsSaltSecretName',
      value: this.saltSecret.secretName,
    });

    printAnalyticsOptInBanner();
  }
}

/**
 * Prints a one-time, hard-to-miss banner during synth/deploy whenever an
 * institution has opted in to upstream analytics. Mirrors the plain `console.*`
 * deploy-time output used elsewhere in the CDK app.
 */
export function printAnalyticsOptInBanner(): void {
  /* eslint-disable no-console */
  console.log('');
  console.log('============================================================================');
  console.log(' Easy Genomics — UPSTREAM ANALYTICS ENABLED (analytics.enabled: true)');
  console.log('----------------------------------------------------------------------------');
  console.log(' This deployment is opted in to sending ANONYMOUS usage events to the');
  console.log(' Easy Genomics project to help improve the product.');
  console.log('');
  console.log('  - Double opt-in: end users must also accept the in-app consent banner');
  console.log('    before any event is sent. Nothing is sent until both opt-ins are granted.');
  console.log('  - Anonymous: no emails, names, file names, sample data, run parameters,');
  console.log('    IPs, account ids, domains or hostnames are ever sent.');
  console.log('  - To turn this off: set analytics.enabled: false and redeploy.');
  console.log('');
  console.log('  HIPAA: the upstream analytics is NOT designed for environments handling');
  console.log('  PHI. Institutions handling PHI should leave analytics disabled.');
  console.log('============================================================================');
  console.log('');
  /* eslint-enable no-console */
}
