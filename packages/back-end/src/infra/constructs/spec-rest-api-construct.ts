import { loadEasyGenomicsApiSpec } from '@easy-genomics/shared-lib/src/app/openapi/load-spec';
import { ACCESS_CONTROL_ALLOW_HEADERS } from '@easy-genomics/shared-lib/src/app/utils/common';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  AccessLogFormat,
  ApiDefinition,
  EndpointType,
  LogGroupLogDestination,
  MethodLoggingLevel,
  Period,
  SpecRestApi,
  UsagePlan,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { CfnPermission, IFunction } from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { enrichSpecForApiGateway } from './openapi-spec-enrichment';

export interface SpecRestApiConstructProps {
  description: string;
  /**
   * Endpoint-path (no `/{id}`) → Lambda function map, aggregated from the
   * `LambdaConstruct`(s) that own the routes this API serves. The construct
   * derives integrations and invoke permissions from this map plus the spec.
   */
  lambdaFunctions: Map<string, IFunction>;
  /** Cognito user pool whose JWTs authorize requests to this API. */
  userPool: UserPool;
  /** Spec paths under these prefixes are served here (e.g. ['/easy-genomics']). */
  includePathPrefixes: string[];
  /** Overrides the spec file location; used by unit tests. */
  specPath?: string;
}

/**
 * Provisions an API Gateway REST API directly from the committed OpenAPI spec
 * (`easy-genomics-api.yaml`) using `SpecRestApi`, replacing the imperative
 * `RestApi` + per-route `addMethod` wiring.
 *
 * Every route/method/integration/authorizer/CORS preflight lives inside the
 * single `RestApi.definitionBody` instead of being a standalone CloudFormation
 * resource, which collapses the per-endpoint resource amplification that pushed
 * the Easy Genomics API stack against the 500-resource limit.
 *
 * IMPORTANT — physical-id preservation: this construct and its inner
 * `SpecRestApi` are intentionally given the SAME ids the previous
 * `ApiGatewayConstruct`/`RestApi` used, so the `AWS::ApiGateway::RestApi`
 * logical id (and therefore the deployed REST API id and invoke URL) is
 * unchanged on upgrade. Easy Genomics runs in customer-owned accounts; a
 * replaced REST API would change every customer's API URL.
 */
export class SpecRestApiConstruct extends Construct {
  readonly restApi: SpecRestApi;

  constructor(scope: Construct, id: string, props: SpecRestApiConstructProps) {
    super(scope, id);
    const stack = Stack.of(this);

    const { document, usedEndpoints } = enrichSpecForApiGateway(loadEasyGenomicsApiSpec(props.specPath), {
      includePathPrefixes: props.includePathPrefixes,
      cognitoProviderArns: [props.userPool.userPoolArn],
      region: stack.region,
      partition: stack.partition,
      corsAllowHeaders: ACCESS_CONTROL_ALLOW_HEADERS,
      resolveLambdaArn: (endpointKey) => props.lambdaFunctions.get(endpointKey)?.functionArn,
    });

    const logGroup = new logs.LogGroup(this, `${id}-access-log`);

    // Same id as the previous RestApi so the logical id is preserved (see class doc).
    this.restApi = new SpecRestApi(this, id, {
      apiDefinition: ApiDefinition.fromInline(document),
      endpointTypes: [EndpointType.REGIONAL],
      cloudWatchRole: true,
      cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(logGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
        loggingLevel: MethodLoggingLevel.INFO,
      },
    });

    // SpecRestApi does not create per-method LambdaIntegration permissions, so
    // grant API Gateway invoke rights once per backing function. These are
    // created with CfnPermission in THIS construct's scope (the API's stack)
    // rather than via `fn.addPermission` (which would place them in the Lambda's
    // nested stack) — the nested stacks are near the 500-resource limit while the
    // API stack has ample headroom after the SpecRestApi collapse. Restricting
    // the source ARN to this API's execute-api ARN keeps each grant scoped.
    const sourceArn = this.restApi.arnForExecuteApi();
    for (const endpointKey of usedEndpoints) {
      const lambdaFunction = props.lambdaFunctions.get(endpointKey);
      if (!lambdaFunction) {
        continue; // Unreachable: usedEndpoints only contains resolved endpoints.
      }
      new CfnPermission(this, `invoke${endpointKey.replace(/[^a-zA-Z0-9]/g, '')}`, {
        action: 'lambda:InvokeFunction',
        functionName: lambdaFunction.functionArn,
        principal: 'apigateway.amazonaws.com',
        sourceArn,
      });
    }

    const usagePlan: UsagePlan = this.restApi.addUsagePlan(`${id}-usageplan`, {
      name: `${props.description} Usage Plan`,
      description: `${props.description} Usage Plan`,
      throttle: {
        rateLimit: 100,
        burstLimit: 10,
      },
      quota: {
        limit: 1000,
        period: Period.DAY,
      },
    });
    usagePlan.addApiStage({
      stage: this.restApi.deploymentStage,
    });
  }
}
