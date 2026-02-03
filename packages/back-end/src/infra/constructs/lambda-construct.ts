import * as fs from 'fs';
import path from 'path';
import { AssociativeArray, HttpRequest } from '@easy-genomics/shared-lib/src/app/utils/common';
import { toPascalCase } from '@easy-genomics/shared-lib/src/app/utils/string-utils';
import { aws_lambda, aws_lambda_nodejs, Duration } from 'aws-cdk-lib';
import { CognitoUserPoolsAuthorizer, JsonSchema, LambdaIntegration, Resource } from 'aws-cdk-lib/aws-apigateway';
import { MethodOptions } from 'aws-cdk-lib/aws-apigateway/lib/method';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IEventSource, IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EasyGenomicsNestedStackProps } from '../types/back-end-stack';

export const LAMBDA_FUNCTION_ROOT_DIR = 'src/app/controllers'; // DO NOT CHANGE

export interface LambdaConstructProps extends EasyGenomicsNestedStackProps {
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

// List of allowed Lambda Function operations requiring path parameter 'id' for specific resource
const ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID: AssociativeArray<HttpRequest> = {
  ['read']: 'GET', // Read specific record
  ['update']: 'PUT', // Update specific record
  ['cancel']: 'PUT', // Update specific record
  ['patch']: 'PATCH', // Patch specific record
  ['delete']: 'DELETE', // Delete specific record
};

export class LambdaConstruct extends Construct {
  private props: LambdaConstructProps;
  private readonly authorizer?: CognitoUserPoolsAuthorizer;
  readonly lambdaFunctions: Map<string, IFunction> = new Map();

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);
    this.props = props;

    if (this.props.userPool) {
      this.authorizer = new CognitoUserPoolsAuthorizer(this, `${id}-user-pool-authorizer`, {
        cognitoUserPools: [this.props.userPool],
      });
    }

    // Find all existing Lambda Functions within specified lambdaFunctionsDir and register them as REST APIs with API Gateway / Event Triggers
    this.getLambdaFunctions(path.join(__dirname, `../../../${this.props.lambdaFunctionsDir}`)).forEach(
      (lambdaFunction: AssociativeArray<string>) => {
        this.registerLambdaFunction(lambdaFunction);
      },
    );

    // Attach the Schema Models to API Gateway REST API
    if (this.props.restApi) {
      for (const value of Object.values(this.props.lambdaFunctionsResources)) {
        value.schemas?.forEach((schema: JsonSchema) => {
          this.props.restApi!.addModel(`${toPascalCase(schema.title!)}`, {
            modelName: `${toPascalCase(schema.title!)}`,
            schema: schema,
          });
        });
      }
    }
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
    const lambdaMethodOptions = this.props.lambdaFunctionsResources[lambdaApiEndpoint]?.methodOptions || undefined;

    const lambdaHandler: IFunction = new aws_lambda_nodejs.NodejsFunction(this, `${lambdaId}`, {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 1024,
      functionName: `${this.props.lambdaFunctionsNamespace}-${lambdaName}`.slice(0, 64),
      entry: `${lambdaFunction.path}`,
      handler: 'handler',
      tracing: aws_lambda.Tracing.ACTIVE,
      bundling: {
        loader: { '.hbs': 'text' },
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
    } else {
      // Register Lambda Function Endpoint with API Gateway REST API
      if (this.props.restApi) {
        const pathResource = this.props.restApi.root.resourceForPath(lambdaApiEndpoint);
        // Attach REST API Request methods for the respective Lambda function
        if (lambdaFunction.command in ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID) {
          const pathResourceWithId: Resource = pathResource.addResource('{id}');
          pathResourceWithId.addMethod(
            ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID[lambdaFunction.command],
            new LambdaIntegration(lambdaHandler),
            {
              authorizer: this.authorizer,
              ...lambdaMethodOptions,
            },
          );
        } else {
          pathResource.addMethod(
            ALLOWED_LAMBDA_FUNCTION_OPERATIONS[lambdaFunction.command],
            new LambdaIntegration(lambdaHandler),
            {
              authorizer: this.authorizer,
              ...lambdaMethodOptions,
            },
          );
        }
      }
    }

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
