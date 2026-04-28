import { NestedStackProps } from "aws-cdk-lib";
import { BackEndStackProps } from '@easy-genomics/shared-lib/src/infra/types/main-stack';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import { IVpc } from "aws-cdk-lib/aws-ec2";

// Shared contract for any nested stack that registers Lambda-backed HTTP routes
// against an API Gateway REST API. Domain-specific props extend this rather
// than inheriting from each other, so API/route ownership is explicit per domain.
export interface CommonApiNestedStackProps extends BackEndStackProps, NestedStackProps {
    restApi?: RestApi,
    userPool?: UserPool,
    userPoolClient?: UserPoolClient,
    iamPolicyStatements?: Map<string, PolicyStatement[]>,
    vpc?: IVpc,
}

// Defined the Auth specific props
export interface AuthNestedStackProps extends BackEndStackProps, NestedStackProps {
    cognitoIdpKmsKey?: Key,
}

// Defines the Easy Genomics specific props
//
// `dynamoDBTables` is intentionally REQUIRED and INJECTED by the parent
// `EasyGenomicsApiStack`. Tables are created at the parent (top-level) stack
// scope rather than inside this nested stack so that:
//   1. `cdk import "${EasyGenomicsApiStack}"` can actually adopt the tables
//      during the documented split-stack migration. The CDK CLI's resource
//      importer only walks a single template per invocation; if tables lived
//      in this nested stack they would be invisible to import.
//   2. Cross-stack references (`Map<string, Table>`) stay within the parent
//      stack process, avoiding a fan-out of `Fn::ImportValue` exports.
export interface EasyGenomicsNestedStackProps extends CommonApiNestedStackProps {
    cognitoIdpKmsKey?: Key,
    dynamoDBTables: Map<string, Table>,
}

// Defines the AWS HealthOmics specific props
// (decoupled from EasyGenomicsNestedStackProps so it doesn't accidentally rejoin the easy-genomics API stack)
export interface AwsHealthOmicsNestedStackProps extends CommonApiNestedStackProps {
}

// Defines the NextFlow Tower specific props
// (decoupled from EasyGenomicsNestedStackProps so it doesn't accidentally rejoin the easy-genomics API stack)
export interface NFTowerNestedStackProps extends CommonApiNestedStackProps {
}

// Defines the Data Provisioning specific props
export interface DataProvisioningNestedStackProps extends BackEndStackProps, NestedStackProps {
    userPool: UserPool,
    userPoolSystemAdminGroupName?: string,
    dynamoDBTables: Map<string, Table>
}

// Defines the Easy Genomics dedicated (top-level) API stack props.
// This stack owns its own RestApi and parents the easy-genomics nested stack
// plus data-provisioning so cross-stack exports stay narrow.
export interface EasyGenomicsApiStackProps extends BackEndStackProps {
    userPool: UserPool,
    userPoolClient: UserPoolClient,
    userPoolSystemAdminGroupName?: string,
    cognitoIdpKmsKey?: Key,
    vpc?: IVpc,
}
