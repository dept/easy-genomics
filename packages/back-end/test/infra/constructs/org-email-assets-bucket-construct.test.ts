import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { OrgEmailAssetsBucketConstruct } from '../../../src/infra/constructs/org-email-assets-bucket-construct';

function synth(): Template {
  const app = new App();
  const stack = new Stack(app, 'test-stack');
  new OrgEmailAssetsBucketConstruct(stack, 'test-construct', {
    bucketName: 'dev-demo-org-email-assets-bucket',
    envType: 'dev',
    appDomainName: 'dev-demo.easygenomics.org',
  });
  return Template.fromStack(stack);
}

// Collects every statement across every bucket policy in the template so the tests below can
// reason about principals directly. hasResourceProperties matchers can't express "no statement
// anywhere grants a wildcard principal", which is the property that actually blocks the bug.
function bucketPolicyStatements(template: Template): any[] {
  const policies = template.findResources('AWS::S3::BucketPolicy');
  return Object.values(policies).flatMap((policy: any) => policy.Properties.PolicyDocument.Statement);
}

describe('OrgEmailAssetsBucketConstruct', () => {
  it('blocks all four public-access controls so the bucket deploys under account-level BPA', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'dev-demo-org-email-assets-bucket',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('grants no Allow statement to a wildcard principal', () => {
    // The regression guard for the v1.5 deploy failure: an Allow to Principal '*' is exactly what
    // account-level BlockPublicPolicy rejects. The enforceSSL Deny statement also targets
    // Principal { AWS: '*' } and is intentional, hence the Effect filter.
    const publicAllows = bucketPolicyStatements(synth()).filter(
      (statement: any) =>
        statement.Effect === 'Allow' && (statement.Principal === '*' || statement.Principal?.AWS === '*'),
    );

    expect(publicAllows).toEqual([]);
  });

  it('creates one CloudFront distribution with an Origin Access Control', () => {
    const template = synth();

    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('grants GetObject to the CloudFront service principal scoped by AWS:SourceArn', () => {
    const cloudFrontAllows = bucketPolicyStatements(synth()).filter(
      (statement: any) => statement.Effect === 'Allow' && statement.Principal?.Service === 'cloudfront.amazonaws.com',
    );

    expect(cloudFrontAllows).toHaveLength(1);
    expect(JSON.stringify(cloudFrontAllows[0].Action)).toContain('s3:GetObject');
    expect(JSON.stringify(cloudFrontAllows[0].Condition)).toContain('AWS:SourceArn');
  });

  it('does not attach a custom domain or certificate to the distribution', () => {
    // The distribution is always reached at its own d....cloudfront.net domain, so no environment
    // needs a hosted zone or certificate for email assets to resolve.
    const distributions = synth().findResources('AWS::CloudFront::Distribution');
    const config = Object.values(distributions)[0] as any;

    // CDK omits both Aliases and ViewerCertificate from the rendered template entirely when a
    // distribution uses only the default cloudfront.net certificate (verified against an actual
    // synth) — it does not emit `ViewerCertificate: { CloudFrontDefaultCertificate: true }`.
    expect(config.Properties.DistributionConfig.Aliases).toBeUndefined();
    expect(config.Properties.DistributionConfig.ViewerCertificate).toBeUndefined();
  });

  it('does not geo-restrict the distribution', () => {
    // Gmail fetches images through Google's image proxy, whose egress country is not ours to
    // control. A geo-restriction here reproduces the broken-image failure this change fixes.
    const distributions = synth().findResources('AWS::CloudFront::Distribution');
    const config = Object.values(distributions)[0] as any;

    expect(config.Properties.DistributionConfig.Restrictions).toBeUndefined();
  });

  it('scopes the upload CORS rule to the app domain, not a wildcard origin', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: Match.arrayWith(['GET', 'PUT', 'HEAD']),
            AllowedOrigins: ['https://dev-demo.easygenomics.org'],
          }),
        ]),
      },
    });
  });

  it('seeds the default logo/lock images via a BucketDeployment targeting this bucket', () => {
    synth().resourceCountIs('Custom::CDKBucketDeployment', 1);
  });
});
