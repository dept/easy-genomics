import { ACCESS_CONTROL_ALLOW_HEADERS } from '@easy-genomics/shared-lib/src/app/utils/common';
import { aws_apigateway, RemovalPolicy, StackProps } from 'aws-cdk-lib';
import { EndpointType, MethodLoggingLevel, Period, RestApi, UsagePlan } from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ApiGatewayConstructProps extends StackProps {
  description: string;
}

/**
 * This ApiGateway Construct provisions an AWS API Gateway REST API with an api
 * key and usage plan.
 */
export class ApiGatewayConstruct extends Construct {
  readonly restApi: RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    // Create log group for API Gateway
    const logGroup = new logs.LogGroup(this, `${id}-access-log`);

    // Create API Gateway and register Lambda Functions & REST API request type
    this.restApi = new aws_apigateway.RestApi(this, id, {
      description: props.description,
      binaryMediaTypes: [], // Must be empty to support CORS
      endpointTypes: [EndpointType.REGIONAL],
      defaultCorsPreflightOptions: {
        // TODO: Enhance CORS restrictions for FE integration
        allowOrigins: aws_apigateway.Cors.ALL_ORIGINS,
        allowMethods: aws_apigateway.Cors.ALL_METHODS,
        allowCredentials: true,
        allowHeaders: ACCESS_CONTROL_ALLOW_HEADERS,
      },
      cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY,
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new aws_apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: aws_apigateway.AccessLogFormat.jsonWithStandardFields({
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

    // const apiKey: IApiKey = this.restApi.addApiKey(`${id}-apikey`);
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
    // usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: this.restApi.deploymentStage,
    });
  }
}
