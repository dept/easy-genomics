import * as path from 'path';
import { RemovalPolicy } from 'aws-cdk-lib';
import { AllowedMethods, CachePolicy, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export interface OrgEmailAssetsBucketConstructProps {
  bucketName: string;
  envType: string;
  appDomainName: string;
}

// Keys the platform-default logo/lock images are seeded under — the BucketDeployment below
// uploads each source file under its own original name, so these must match the filenames in
// front-end/src/app/public/images/email/ exactly, not an arbitrary name. SesService falls back
// to these when an org hasn't uploaded its own logo — see default-email-branding.ts.
export const DEFAULT_EASY_GENOMICS_LOGO_KEY = 'defaults/easy-genomics.png';
export const DEFAULT_LOCK_IMAGE_KEY = 'defaults/lock.png';

/**
 * A private bucket for org-uploaded email branding logos, plus the CloudFront distribution that
 * serves them. It also hosts the platform's own default logo/lock images: many email clients
 * (Gmail included) strip embedded base64 data: URI images from received HTML email, so every
 * branding image — defaults and org uploads alike — has to be fetchable over ordinary HTTPS.
 *
 * The bucket stays fully private and CloudFront reaches it through Origin Access Control. OAC's
 * bucket policy names the `cloudfront.amazonaws.com` service principal scoped by `AWS:SourceArn`,
 * which is not a *public* policy, so accounts with S3 Block Public Access enabled at the account
 * level can still deploy this. An `AnyPrincipal` GetObject policy cannot: account-level BPA
 * overrides the bucket setting and denies `PutBucketPolicy` outright.
 *
 * The distribution deliberately has no custom domain and no certificate, so it is always reachable
 * at its own d....cloudfront.net address. The website's distribution cannot serve these assets: it
 * geo-restricts to AR/AU/US (Gmail's image-proxy egress country is not ours to control), maps
 * 403/404 to /index.html with HTTP 200, and its domain is a front-end stack value the back-end
 * cannot read at deploy time because the front-end stack deploys after this one.
 */
export class OrgEmailAssetsBucketConstruct extends Construct {
  readonly bucket: Bucket;
  /** Bare CloudFront domain, no scheme and no trailing slash — callers prepend `https://`. */
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: OrgEmailAssetsBucketConstructProps) {
    super(scope, id);

    this.bucket = new Bucket(this, 'bucket', {
      bucketName: props.bucketName,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      bucketKeyEnabled: true,
      enforceSSL: true,
      autoDeleteObjects: props.envType !== 'prod',
      removalPolicy: props.envType !== 'prod' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      // Retained for the org logo *upload* path: the browser PUTs straight to the S3 endpoint with
      // a presigned URL. Only GET-for-email moves to CloudFront.
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.PUT, HttpMethods.HEAD],
          allowedOrigins: [`https://${props.appDomainName}`],
          allowedHeaders: ['*'],
        },
      ],
    });

    // withOriginAccessControl also writes the bucket's GetObject policy for the CloudFront service
    // principal, scoped by AWS:SourceArn to this distribution.
    const distribution = new Distribution(this, 'distribution', {
      comment: `${props.bucketName} email assets`,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        compress: true,
      },
    });

    this.distributionDomainName = distribution.distributionDomainName;

    NagSuppressions.addResourceSuppressions(
      distribution,
      [
        {
          id: 'AwsSolutions-CFR1',
          reason:
            'Email recipients and their clients image proxies are global; Gmail fetches through Google infrastructure whose egress country we do not control. Geo-restricting this distribution would reproduce the broken-image failure it exists to fix.',
        },
        {
          id: 'AwsSolutions-CFR2',
          reason:
            "The origin is the org email branding bucket: the platform default logo/lock images plus every org's uploaded logo, none of it public any more (private bucket, OAC-only access). A WAF WebACL would cost more than it protects here and risks blocking legitimate email-client image-proxy fetches.",
        },
        {
          id: 'AwsSolutions-CFR3',
          reason:
            'CloudFront standard access logging writes to a separate log bucket; this suppression is about not provisioning one. Logo GETs carry no data worth a dedicated log bucket.',
        },
        {
          id: 'AwsSolutions-CFR4',
          reason:
            'The distribution uses the default CloudFront certificate, so its minimum TLS version is managed by CloudFront and cannot be raised without attaching a custom certificate. This distribution deliberately has no custom domain so that email assets resolve in environments with no hosted zone.',
        },
      ],
      true,
    );

    // CACHING_OPTIMIZED has a 1-day default TTL, so without invalidating on deploy a changed
    // default image would keep serving stale from CloudFront for up to 24 hours.
    new BucketDeployment(this, 'default-assets-deployment', {
      sources: [Source.asset(path.join(__dirname, '../../../../front-end/src/app/public/images/email'))],
      destinationBucket: this.bucket,
      destinationKeyPrefix: 'defaults',
      prune: false,
      distribution,
      distributionPaths: ['/defaults/*'],
    });
  }
}
