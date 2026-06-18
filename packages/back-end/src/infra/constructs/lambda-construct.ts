import * as fs from 'fs';
import path from 'path';
import { AssociativeArray, HttpRequest } from '@easy-genomics/shared-lib/src/app/utils/common';
import { aws_lambda, aws_lambda_nodejs, Duration } from 'aws-cdk-lib';
import { JsonSchema } from 'aws-cdk-lib/aws-apigateway';
import { MethodOptions } from 'aws-cdk-lib/aws-apigateway/lib/method';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IEventSource, IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CommonApiNestedStackProps } from '../types/back-end-stack';

export const LAMBDA_FUNCTION_ROOT_DIR = 'src/app/controllers'; // DO NOT CHANGE

// LambdaConstruct auto-discovers controllers, builds a NodejsFunction for each,
// wires event sources for `process-*` handlers, and exposes them by endpoint
// path via `lambdaFunctions`. HTTP route registration is NOT done here — the
// owning stack's `SpecRestApiConstruct` sources every method/integration/
// authorizer from easy-genomics-api.yaml and resolves each route to a function
// using this map. It deliberately does NOT extend any single domain's
// nested-stack props, so no domain can accidentally inherit another domain's
// API ownership just by sharing Cognito/VPC dependencies.
export interface LambdaConstructProps extends CommonApiNestedStackProps {
  lambdaFunctionsDir: string;
  lambdaFunctionsNamespace: string;
  lambdaFunctionsResources: {
    [key: string]: LambdaFunctionsResources;
  };
  environment?: {
    // Common process.env settings
    [key: string]: string;
  };
}

interface LambdaFunctionsResources {
  schemas?: JsonSchema[];
  events?: IEventSource[];
  callbacks?: ((fn: IFunction) => void)[];
  environment?: {
    // Specific process.env settings
    [key: string]: string;
  };
  methodOptions?: MethodOptions;
  timeoutSeconds?: number;
  memorySizeMb?: number;
}

// List of allowed "CRUD" Lambda Function operations with respective REST API command mapping
const ALLOWED_LAMBDA_FUNCTION_OPERATIONS: AssociativeArray<HttpRequest> = {
  ['create']: 'POST',
  ['confirm']: 'POST',
  ['list']: 'GET', // List multiple records
  ['read']: 'GET',
  ['update']: 'PUT',
  ['cancel']: 'PUT',
  ['patch']: 'PATCH',
  ['delete']: 'DELETE',
  // Additional Lambda Function operations for managing objects by using the Posted Hash/Partition Key & Sort Key
  ['add']: 'POST',
  ['edit']: 'POST',
  ['request']: 'POST',
  ['remove']: 'POST',
};

export class LambdaConstruct extends Construct {
  private props: LambdaConstructProps;
  readonly lambdaFunctions: Map<string, IFunction> = new Map();

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);
    this.props = props;

    // Find all existing Lambda Functions within specified lambdaFunctionsDir, build each, and wire event triggers
    this.getLambdaFunctions(path.join(__dirname, `../../../${this.props.lambdaFunctionsDir}`)).forEach(
      (lambdaFunction: AssociativeArray<string>) => {
        this.registerLambdaFunction(lambdaFunction);
      },
    );
  }

  /**
   * Registers the Lambda function with the supplied API Gateway REST API.
   * @param lambdaFunction
   */
  private registerLambdaFunction = (lambdaFunction: AssociativeArray<string>) => {
    const lambdaPath: string = path.parse(lambdaFunction.path).dir;
    const lambdaHandlerName: string = path.parse(lambdaFunction.path).name; // Removes .ts
    const lambdaName: string = path.parse(lambdaHandlerName).name; // Removes .lambda
    const lambdaId: string = `${this.props.lambdaFunctionsNamespace}-${lambdaName}`;
    const lambdaApiDir: string = lambdaPath.split(LAMBDA_FUNCTION_ROOT_DIR).pop() || '';
    const lambdaApiEndpoint: string = `${lambdaApiDir}/${lambdaName}`;

    const commonProcessEnv = this.props.environment || undefined;
    const lambdaProcessEnv = this.props.lambdaFunctionsResources[lambdaApiEndpoint]?.environment || undefined;
    const lambdaTimeoutSeconds = this.props.lambdaFunctionsResources[lambdaApiEndpoint]?.timeoutSeconds || 30;
    const lambdaMemorySizeMb = this.props.lambdaFunctionsResources[lambdaApiEndpoint]?.memorySizeMb || 1024;

    const lambdaHandler: IFunction = new aws_lambda_nodejs.NodejsFunction(this, `${lambdaId}`, {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(lambdaTimeoutSeconds),
      memorySize: lambdaMemorySizeMb,
      functionName: `${this.props.lambdaFunctionsNamespace}-${lambdaName}`.slice(0, 64),
      entry: `${lambdaFunction.path}`,
      handler: 'handler',
      tracing: aws_lambda.Tracing.ACTIVE,
      bundling: {
        loader: { '.hbs': 'text', '.yaml': 'text' },
        externalModules: ['@aws-sdk/*'],
      },
      logRetention: RetentionDays.ONE_DAY,
      logRetentionRetryOptions: {
        // Attempt to avoid LogRetention creation failure due to throttling
        maxRetries: 10, // AWS default is 3
      },
      environment: {
        ...commonProcessEnv, // Common process.env settings
        ...lambdaProcessEnv, // Specific process.env settings
      },
    });

    // Attach relevant IAM policies to Lambda Function matching specific API Endpoint
    const iamPolicyStatements: PolicyStatement[] | undefined = this.props.iamPolicyStatements?.get(lambdaApiEndpoint);
    if (iamPolicyStatements) {
      if (process.env.CI_CD === 'true') {
        console.debug(
          `Attaching IAM Policy to REST API Endpoint: ${lambdaApiEndpoint}\n${JSON.stringify(iamPolicyStatements, null, 2)}`,
        );
      }
      iamPolicyStatements.forEach((iamPolicyStatement: PolicyStatement) => {
        lambdaHandler.addToRolePolicy(iamPolicyStatement);
      });
    } else {
      console.warn(`WARNING: ${lambdaApiEndpoint} does not have any IAM Policies attached`);
    }

    if (lambdaFunction.command === 'process') {
      // Register Event Source Listeners/Triggers for the respective Lambda function
      this.props.lambdaFunctionsResources[lambdaApiEndpoint]?.events?.forEach((eventSource: IEventSource) => {
        lambdaHandler.addEventSource(eventSource);
      });

      // Register Callback Functions for the respective Lambda function
      this.props.lambdaFunctionsResources[lambdaApiEndpoint]?.callbacks?.forEach((callback) => {
        callback(lambdaHandler);
      });
    }

    // HTTP route registration is handled by the owning stack's
    // SpecRestApiConstruct, which sources every method/integration/authorizer
    // from easy-genomics-api.yaml. Here we only expose the function by its
    // endpoint path so that construct can resolve each spec operation to its
    // backing Lambda ARN (and so Cognito triggers can find `process-*` handlers).
    this.lambdaFunctions.set(lambdaApiEndpoint, lambdaHandler);
  };

  /**
   * Recursive function that finds the paths of each existing Lambda function
   * within the specified directory and resolves the REST API request type for
   * registering with API Gateway.
   *
   * The Lambda function definitions must start with a support REST API command
   * as defined by ALLOWED_LAMBDA_FUNCTION_OPERATIONS or starts with 'process',
   * and ends with '.lambda.ts'.
   *
   * @param directory
   * @param lambdaFunctions
   */
  private getLambdaFunctions = (
    directory: string,
    lambdaFunctions: AssociativeArray<string>[] = [],
  ): AssociativeArray<string>[] => {
    const filesInDirectory: string[] = fs.readdirSync(directory);
    for (const file of filesInDirectory) {
      const absolutePath: string = path.join(directory, file);
      if (fs.statSync(absolutePath).isDirectory()) {
        this.getLambdaFunctions(absolutePath, lambdaFunctions);
      } else {
        if (file.endsWith('.lambda.ts')) {
          const lambdaRestApiCommand: string = file.split('-', 1).pop()!;
          if (lambdaRestApiCommand in ALLOWED_LAMBDA_FUNCTION_OPERATIONS || lambdaRestApiCommand === 'process') {
            lambdaFunctions.push({
              path: absolutePath,
              command: lambdaRestApiCommand, // ALLOWED_LAMBDA_FUNCTION_OPERATIONS key (e.g. 'create', 'list', 'read', etc..)
            });
          }
        }
      }
    }
    return lambdaFunctions;
  };
}
