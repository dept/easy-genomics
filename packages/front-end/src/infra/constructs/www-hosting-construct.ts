import * as fs from 'fs';
import path from 'path';
import { S3Construct } from '@easy-genomics/shared-lib/src/infra/constructs/s3-construct';
import { FrontEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { CfnOutput, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Certificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  DistributionProps,
  GeoRestriction,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  IOrigin,
  OriginAccessIdentity,
  ResponseHeadersPolicy,
  ResponseSecurityHeadersBehavior,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CanonicalUserPrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ARecord, HostedZone, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Bucket, BucketAccessControl, BucketProps, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

export type SecurityHeaders = ResponseSecurityHeadersBehavior & {
  /**
   * Whether or not to apply security headers.
   *
   * Defaults to true.
   */
  enabled?: boolean;
};

/**
 * Default Security Headers for Static Web App Hosting.
 *
 * NOTES:
 * 1. Content Security Policy should be manually configured and applied. They can be hard to get right but are the most effective frontend security control. Add your own and merge with this config!
 * 2. The XSS Protections is not configured due to low support and CSP being a better protection.
 */
export const DefaultSecurityHeaders: SecurityHeaders = {
  enabled: true,
  frameOptions: {
    frameOption: HeadersFrameOption.DENY,
    override: false,
  },
  strictTransportSecurity: {
    accessControlMaxAge: Duration.days(365),
    override: false,
  },
  contentTypeOptions: {
    override: false,
  },
  referrerPolicy: {
    referrerPolicy: HeadersReferrerPolicy.NO_REFERRER,
    override: false,
  },
};

export interface WwwHostingConstructProps extends FrontEndStackProps {
  description: string;
  indexCacheDuration?: Duration;
  securityHeaders?: SecurityHeaders;
  webAclId?: string;
  webSiteIndexDocument?: string;
}

/**
 * This WWW Hosting Construct to provision the resources for a static website.
 */
export class WwwHostingConstruct extends Construct {
  readonly props: WwwHostingConstructProps;
  readonly s3Buckets: Map<string, Bucket> = new Map();

  constructor(scope: Construct, id: string, props: WwwHostingConstructProps) {
    super(scope, id);
    this.props = {
      indexCacheDuration: Duration.minutes(5),
      securityHeaders: DefaultSecurityHeaders,
      webSiteIndexDocument: 'index.html',
      ...props,
    };

    // WWW S3 Bucket
    this.setupS3Buckets();

    // CloudFront Distribution
    this.setupCloudFrontDistribution();
  }

  // WWW S3 Bucket for static web pages
  private setupS3Buckets = () => {
    const appDomainName: string = this.props.appDomainName;
    const s3: S3Construct = new S3Construct(this, `${this.props.constructNamespace}-s3-www`, {
      envType: this.props.envType,
    });
    Tags.of(s3).add('easy-genomics:s3-bucket-type', 'www');

    let wwwBucketProps: BucketProps = {
      accessControl: BucketAccessControl.PRIVATE,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    };

    if (this.props.envType !== 'dev') {
      const accessLogBucketName: string = `${this.props.env.account}-${appDomainName}-www-access-logs`; // Must be globally unique
      // Create S3 Bucket for CloudFront www access logging
      const accessLogBucket: Bucket = s3.createBucket(accessLogBucketName, {
        accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        lifecycleRules: [
          {
            expiration: Duration.days(1),
          },
        ],
        objectOwnership: ObjectOwnership.OBJECT_WRITER,
      });
      this.s3Buckets.set(accessLogBucketName, accessLogBucket); // Add Bucket to Map collection

      wwwBucketProps = {
        ...wwwBucketProps,
        serverAccessLogsPrefix: 'www-s3-log-',
        serverAccessLogsBucket: accessLogBucket,
      };

      const cloudFrontLogBucketName: string = `${this.props.env.account}-${appDomainName}-cfd-access-logs`; // Must be globally unique
      // Create S3 Bucket for CloudFront distribution access logging
      const cloudFrontLogBucket: Bucket = s3.createBucket(cloudFrontLogBucketName, {
        accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        lifecycleRules: [
          {
            expiration: Duration.days(1),
          },
        ],
        objectOwnership: ObjectOwnership.OBJECT_WRITER,
      });
      this.s3Buckets.set(cloudFrontLogBucketName, cloudFrontLogBucket); // Add Bucket to Map collection
    }

    // Using the configured domainName for the WWW S3 Bucket
    const wwwBucketName: string = `${this.props.env.account}-${appDomainName}`; // Must be globally unique

    // Create S3 Bucket for static website hosting through CloudFront distribution
    const wwwBucket: Bucket = s3.createBucket(wwwBucketName, wwwBucketProps);
    this.s3Buckets.set(wwwBucketName, wwwBucket); // Add Bucket to Map collection
  };

  // CloudFront Distribution
  private setupCloudFrontDistribution = () => {
    const appDomainName: string = this.props.appDomainName;
    const wwwBucketName: string = `${this.props.env.account}-${appDomainName}`; // Must be globally unique

    const wwwBucket: Bucket | undefined = this.s3Buckets.get(wwwBucketName);
    if (!wwwBucket) {
      throw new Error(`S3 Bucket not found: ${wwwBucketName}`);
    }

    // Grant CloudFront access to WWW S3 Bucket
    const originAccessIdentity: OriginAccessIdentity = new OriginAccessIdentity(this, 'cloudfront-OAI', {
      comment: `OAI for ${wwwBucketName}`,
    });

    wwwBucket.grantRead(originAccessIdentity);

    wwwBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [wwwBucket.arnForObjects('*')],
        principals: [new CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
      }),
    );

    new CfnOutput(this, 'HostingBucketName', { key: 'HostingBucketName', value: wwwBucket.bucketName });

    const responseHeadersPolicy: ResponseHeadersPolicy | undefined = this.applySecurityHeaders();

    const indexCachePolicy = new CachePolicy(this, 'IndexCachePolicy', {
      maxTtl: this.props.indexCacheDuration,
      minTtl: this.props.indexCacheDuration,
      defaultTtl: this.props.indexCacheDuration,
      comment: `Caching policy for ${appDomainName}`,
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const s3Origin: IOrigin = S3BucketOrigin.withOriginAccessIdentity(wwwBucket, { originAccessIdentity });
    const indexPath: string = `/${this.props.webSiteIndexDocument}`;

    const certificate: ICertificate | undefined =
      this.props.awsHostedZoneId && this.props.awsCertificateArn
        ? this.getCertificate(this.props.awsCertificateArn)
        : undefined;
    const domainNames: string[] = this.props.awsHostedZoneId && certificate ? [this.props.appDomainName] : [];

    // Configure CloudFront distribution settings
    const distributionProps: DistributionProps = {
      certificate,
      defaultRootObject: this.props.webSiteIndexDocument,
      domainNames,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      webAclId: this.props.webAclId, // Optional AWS WAF web ACL
      geoRestriction: GeoRestriction.allowlist(...['AR', 'AU', 'US']),
      enableLogging: this.props.envType !== 'dev',
      logBucket:
        this.props.envType !== 'dev'
          ? this.s3Buckets.get(`${this.props.env.account}-${appDomainName}-cfd-access-logs`)
          : undefined,
      defaultBehavior: {
        origin: s3Origin,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS, // HEAD, GET, OPTIONS
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        responseHeadersPolicy,
      },
      additionalBehaviors: {
        [indexPath]: {
          origin: s3Origin,
          cachePolicy: indexCachePolicy,
          responseHeadersPolicy,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          // Short TTL so SPA deep-link / cold-start 403s are not stuck on a blank
          // error response for minutes after a fresh deploy (see CloudFront console
          // "Minimum TTL" on custom error responses).
          ttl: Duration.seconds(10),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(10),
        },
      ],
    };

    // Create CloudFront distribution
    const distribution: Distribution = new Distribution(this, 'SiteDistribution', distributionProps);

    if (this.props.awsHostedZoneId && this.props.awsCertificateArn) {
      console.log(`Proceeding to setup CloudFront Distribution with Site Alias: ${this.props.appDomainName}`);
      // Retrieve Hosted Zone by configured awsHostedZoneId and appDomainName
      const hostedZone: IHostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: this.props.awsHostedZoneId,
        zoneName: this.props.appDomainName,
      });

      new CfnOutput(this, 'HostedZoneName', { key: 'HostedZoneName', value: hostedZone.zoneName });

      // Setup Route53 alias record for the CloudFront distribution

      new ARecord(this, 'SiteAliasRecord', {
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        zone: hostedZone,
      });
      // Domain Name alias configured for the ApplicationUrl

      new CfnOutput(this, 'ApplicationUrl', { key: 'ApplicationUrl', value: `https://${appDomainName}` });
    } else {
      // Domain Name alias not configured for the ApplicationUrl - output CloudFront Distribution URL

      new CfnOutput(this, 'ApplicationUrl', {
        key: 'ApplicationUrl',
        value: `https://${distribution.distributionDomainName}`,
      });
    }

    const wwwSourceDir = path.join(__dirname, '../../../dist'); // Generated site contents folder
    if (fs.existsSync(wwwSourceDir)) {
      // Deploy site contents to S3 bucket

      new BucketDeployment(this, 'DeployWithInvalidation', {
        sources: [Source.asset(wwwSourceDir)],
        destinationBucket: wwwBucket,
        distribution,
        distributionPaths: ['/*'],
      });
    }
  };

  private getCertificate = (awsCertificateArn: string): ICertificate => {
    // Retrieve TLS certificate
    return Certificate.fromCertificateArn(this, 'SiteCertificate', awsCertificateArn);
  };

  private applySecurityHeaders = (): ResponseHeadersPolicy | undefined => {
    if (this.props.securityHeaders?.enabled) {
      return new ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
        securityHeadersBehavior: this.props.securityHeaders,
      });
    } else {
      return undefined;
    }
  };
}
