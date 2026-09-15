import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SpecRestApiConstruct } from '../../../src/infra/constructs/spec-rest-api-construct';

// Minimal fixture spec written to a temp file so the construct can load it the
// same way it loads the real easy-genomics-api.yaml (via the shared-lib loader).
const FIXTURE_SPEC = `openapi: 3.1.0
info:
  title: Test API
  version: 1.0.0
components:
  securitySchemes:
    cognitoJwt:
      type: http
      scheme: bearer
security:
  - cognitoJwt: []
paths:
  /easy-genomics/foo/create-foo:
    post:
      operationId: createFoo
      responses:
        '200':
          description: ok
  /easy-genomics/foo/read-foo/{id}:
    get:
      operationId: readFoo
      responses:
        '200':
          description: ok
`;

const fakeFunction = (arn: string) => ({ functionArn: arn }) as unknown as IFunction;

describe('SpecRestApiConstruct', () => {
  let specPath: string;

  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-rest-api-'));
    specPath = path.join(dir, 'spec.yaml');
    fs.writeFileSync(specPath, FIXTURE_SPEC, 'utf-8');
  });

  const synth = (lambdaFunctions: Map<string, IFunction>) => {
    const stack = new Stack(new App(), 'TestStack', { env: { account: '123', region: 'us-west-2' } });
    new SpecRestApiConstruct(stack, 'dev-test-apigw', {
      description: 'Test API Gateway',
      lambdaFunctions,
      userPool: { userPoolArn: 'arn:aws:cognito-idp:us-west-2:123:userpool/pool-1' } as any,
      includePathPrefixes: ['/easy-genomics'],
      specPath,
    });
    return Template.fromStack(stack);
  };

  const fullMap = () =>
    new Map<string, IFunction>([
      ['/easy-genomics/foo/create-foo', fakeFunction('arn:aws:lambda:us-west-2:123:function:create-foo')],
      ['/easy-genomics/foo/read-foo', fakeFunction('arn:aws:lambda:us-west-2:123:function:read-foo')],
    ]);

  it('creates a single SpecRestApi whose Body carries the spec paths', () => {
    const template = synth(fullMap());
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Body: Match.objectLike({
        paths: Match.objectLike({
          '/easy-genomics/foo/create-foo': Match.anyValue(),
          '/easy-genomics/foo/read-foo/{id}': Match.anyValue(),
        }),
      }),
    });
  });

  it('grants one Lambda invoke permission per backing function in the API stack', () => {
    const template = synth(fullMap());
    template.resourceCountIs('AWS::Lambda::Permission', 2);
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
    });
  });

  it('provisions a deployment stage and usage plan', () => {
    const template = synth(fullMap());
    template.resourceCountIs('AWS::ApiGateway::Stage', 1);
    template.resourceCountIs('AWS::ApiGateway::UsagePlan', 1);
  });

  it('fails synth when a spec route has no backing Lambda (typo guard)', () => {
    const partial = new Map<string, IFunction>([
      ['/easy-genomics/foo/create-foo', fakeFunction('arn:aws:lambda:us-west-2:123:function:create-foo')],
      // read-foo intentionally missing → must throw.
    ]);
    expect(() => synth(partial)).toThrow(/no matching Lambda function/);
  });
});
