import { BackEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import { BasePathMapping, DomainName, EndpointType, IRestApi, SecurityPolicy } from 'aws-cdk-lib/aws-apigateway';
import { Certificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, HostedZone, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayDomain } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

/**
 * Mapping from a public base path to a target REST API. Each entry becomes a
 * `BasePathMapping` under the shared custom domain.
 *
 * IMPORTANT — base-path stripping gotcha:
 *   API Gateway **strips** the base path before forwarding the request to the
 *   target API. So if you map `basePath: 'easy-genomics'` to the easy-genomics
 *   REST API, a request to `https://<domain>/easy-genomics/user/foo` reaches
 *   the backing API as `/user/foo`. The routes registered by `LambdaConstruct`
 *   today still include the domain prefix (e.g. `/easy-genomics/user/foo`), so
 *   a naive base-path mapping would 404.
 *
 *   Use `basePath: ''` (or omit) to map at the root; then the full path is
 *   forwarded unchanged and existing prefixed routes keep working. Multiple
 *   APIs on the same custom domain via non-empty base paths require the
 *   target routes to NOT include the base path — i.e. a controller-layout
 *   refactor. See the "Split Easy API" plan, section 5.
 */
export interface ApiBasePathMapping {
  /**
   * Public base path segment (no leading slash), e.g. `easy-genomics`.
   * Use `''` to map at the root; see the gotcha in the interface doc.
   */
  basePath: string;
  /** Target REST API to route traffic to. */
  restApi: IRestApi;
}

export interface ApiDomainStackProps extends BackEndStackProps {
  /**
   * Fully qualified API domain name (e.g. `api.easygenomics.example.com`).
   * Must be covered by the certificate at `awsApiCertificateArn` and sit
   * inside the hosted zone identified by `awsHostedZoneId`.
   */
  apiDomainName: string;

  /**
   * ARN of a pre-provisioned ACM certificate covering `apiDomainName`, in the
   * same region as the REST APIs. Regional API Gateway domains require a
   * regional cert — this is not the us-east-1 CloudFront cert.
   */
  awsApiCertificateArn: string;

  /**
   * Route53 hosted zone ID for the parent domain. Required for the A-record
   * alias to the API Gateway domain.
   */
  awsHostedZoneId: string;

  /** Base-path-to-REST-API mappings to register under this custom domain. */
  basePathMappings: ApiBasePathMapping[];
}

/**
 * Dedicated top-level stack that fronts one or more REST APIs with a public
 * custom domain so the client sees a stable base URL.
 *
 * Only provisioned in environments that have a Route53 hosted zone + ACM cert
 * available (typically prod). In non-prod the caller should skip creating
 * this stack entirely and consume per-stack `*ApiUrl` outputs directly.
 *
 * Kept deliberately small:
 *  - One `AWS::ApiGateway::DomainName`
 *  - One `AWS::Route53::RecordSet` (alias)
 *  - N `AWS::ApiGateway::BasePathMapping` (one per entry)
 *
 * This stack only imports REST APIs (no ownership), so relocating or
 * re-splitting the upstream APIs does not require rebuilding this stack.
 *
 * Supported topologies:
 *
 *  1. **Root mapping (recommended for now)** — map one REST API at `basePath: ''`.
 *     The full request path is forwarded unchanged, so existing controller
 *     routes like `/easy-genomics/user/foo` keep working. Use a separate
 *     subdomain (e.g. `api.example.com` for easy-genomics and
 *     `platform-api.example.com` for AWS HealthOmics + NF-Tower) and update
 *     the front-end to consume both URLs via `BASE_API_URL` /
 *     `AWS_EASY_GENOMICS_API_URL`.
 *
 *  2. **Prefix mapping (requires controller restructure)** — map multiple
 *     REST APIs under non-empty base paths like `easy-genomics`,
 *     `aws-healthomics`, `nf-tower`. API Gateway STRIPS the base path before
 *     forwarding, so the target APIs must register their routes WITHOUT the
 *     domain-name prefix. That's a larger refactor tracked in the split plan.
 *
 * Prefer topology (1) until the controller-layout refactor lands.
 */
export class ApiDomainStack extends Stack {
  readonly props: ApiDomainStackProps;
  readonly domainName: DomainName;

  constructor(scope: Construct, id: string, props: ApiDomainStackProps) {
    // NOTE: Do not pass `env` to super. Sibling top-level stacks in this app
    // are environment-agnostic from CDK's perspective; passing a concrete env
    // here would break cross-stack references used for BasePathMapping.
    super(scope, id);
    this.props = props;

    const certificate: ICertificate = Certificate.fromCertificateArn(
      this,
      'ApiCertificate',
      this.props.awsApiCertificateArn,
    );

    this.domainName = new DomainName(this, 'ApiCustomDomain', {
      domainName: this.props.apiDomainName,
      certificate: certificate,
      endpointType: EndpointType.REGIONAL,
      securityPolicy: SecurityPolicy.TLS_1_2,
    });

    for (const mapping of this.props.basePathMappings) {
      new BasePathMapping(this, `BasePathMapping-${mapping.basePath}`, {
        domainName: this.domainName,
        restApi: mapping.restApi,
        basePath: mapping.basePath,
      });
    }

    const hostedZone: IHostedZone = HostedZone.fromHostedZoneAttributes(this, 'ApiHostedZone', {
      hostedZoneId: this.props.awsHostedZoneId,
      zoneName: this.props.appDomainName,
    });

    new ARecord(this, 'ApiAliasRecord', {
      zone: hostedZone,
      recordName: this.props.apiDomainName,
      target: RecordTarget.fromAlias(new ApiGatewayDomain(this.domainName)),
    });

    new CfnOutput(this, 'PublicApiUrl', {
      key: 'PublicApiUrl',
      value: `https://${this.props.apiDomainName}`,
      description: 'Public base URL for all REST APIs; path prefixes map to individual APIs.',
    });
  }
}
