import { App, Stack } from 'aws-cdk-lib';
import { NFTowerNestedStack } from '../../../src/infra/stacks/nf-tower-nested-stack';

jest.mock('../../../src/infra/constructs/lambda-construct', () => ({
  LambdaConstruct: jest.fn().mockImplementation(() => ({
    lambdaFunctions: new Map<string, unknown>(),
  })),
}));

describe('NFTowerNestedStack create-workflow-execution IAM access', () => {
  const region = 'us-west-2';
  const account = '654654609030';

  const createStack = () => {
    const app = new App();
    const parent = new Stack(app, 'parent-stack', { env: { account, region } });
    return new NFTowerNestedStack(parent, 'nf-tower-nested-stack', {
      env: { account, region },
      constructNamespace: 'test',
      envName: 'test',
      envType: 'dev',
      appDomainName: 'test.example.com',
      namePrefix: 'test',
      jwtSecretKey: 'test',
      sysAdminEmail: 'test@example.com',
      sysAdminPassword: 'test',
      seqeraApiBaseUrl: 'https://seqera.example.com',
    });
  };

  // The launch limit check reads the lab's sample sheet and the run history, like the review-step estimate.
  it.each([
    ['dynamodb:Query', `arn:aws:dynamodb:${region}:${account}:table/test-laboratory-run-table/index/*`],
    ['s3:GetObject', `arn:aws:s3:::${account}-test-lab-bucket/*`],
    // It also counts warned and blocked launches in the daily usage totals.
    ['dynamodb:UpdateItem', `arn:aws:dynamodb:${region}:${account}:table/test-usage-daily-total-table`],
  ])('grants %s on %s for the launch limit check', (action, resource) => {
    const stack = createStack();
    const grantedResources = stack.iam
      .getPolicyStatements('/nf-tower/workflow/create-workflow-execution')
      .map((statement) => statement.toStatementJson())
      .filter((json) => [json.Action].flat().includes(action))
      .flatMap((json) => [json.Resource].flat());
    expect(grantedResources).toContain(resource);
  });
});
