import { App, Stack } from 'aws-cdk-lib';
import { AwsHealthOmicsNestedStack } from '../../../src/infra/stacks/aws-healthomics-nested-stack';

jest.mock('../../../src/infra/constructs/lambda-construct', () => ({
  LambdaConstruct: jest.fn().mockImplementation(() => ({
    lambdaFunctions: new Map<string, unknown>(),
  })),
}));

describe('AwsHealthOmicsNestedStack cross-account shared workflow IAM access', () => {
  const region = 'us-west-2';
  const account = '654654609030';

  const createStack = () => {
    const app = new App();
    const parent = new Stack(app, 'parent-stack', { env: { account, region } });
    return new AwsHealthOmicsNestedStack(parent, 'aws-healthomics-nested-stack', {
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

  // A RAM-shared HealthOmics workflow keeps the real owner account ID in its ARN
  // (e.g. arn:aws:omics:us-west-2:851725267090:workflow/5425135), never an empty
  // account segment. The recipient account's Lambda execution role therefore needs
  // an explicit Allow against other accounts' workflow ARNs.
  const crossAccountWorkflowArnPattern = `arn:aws:omics:${region}:*:workflow/*`;

  const resourcesFor = (stack: AwsHealthOmicsNestedStack, policyName: string, actionName: string): string[] => {
    const statement = stack.iam
      .getPolicyStatements(policyName)
      .find((s) => s.toStatementJson().Action === actionName || s.toStatementJson().Action?.includes?.(actionName));
    return (statement?.toStatementJson().Resource as string[]) ?? [];
  };

  it('grants read-private-workflow access to shared workflows owned by another account', () => {
    const stack = createStack();
    expect(resourcesFor(stack, '/aws-healthomics/workflow/read-private-workflow', 'omics:GetWorkflow')).toContain(
      crossAccountWorkflowArnPattern,
    );
  });

  it('grants list-workflow-versions access to shared workflows owned by another account', () => {
    const stack = createStack();
    expect(
      resourcesFor(stack, '/aws-healthomics/workflow/list-workflow-versions', 'omics:ListWorkflowVersions'),
    ).toContain(crossAccountWorkflowArnPattern);
  });

  it('grants create-run-execution StartRun access to shared workflows owned by another account', () => {
    const stack = createStack();
    const statement = stack.iam
      .getPolicyStatements('/aws-healthomics/run/create-run-execution')
      .find((s) => (s.toStatementJson().Action as string[]).includes('omics:StartRun'));
    expect(statement?.toStatementJson().Resource).toContain(crossAccountWorkflowArnPattern);
  });

  // read-workflow-schema's GetWorkflow/ListShares grants are used only by the GitHub fallback
  // path (incl. SHARED workflows), but need the same cross-account access as the other handlers.
  it('grants read-workflow-schema GetWorkflow access to shared workflows owned by another account', () => {
    const stack = createStack();
    expect(resourcesFor(stack, '/aws-healthomics/workflow/read-workflow-schema', 'omics:GetWorkflow')).toContain(
      crossAccountWorkflowArnPattern,
    );
  });

  // GetWorkflow/ListWorkflowVersions/StartRun only resolve a bare workflow ID within the caller's
  // own account. For a RAM-shared workflow, the true owner account ID must be looked up via
  // ListShares and passed explicitly as `workflowOwnerId` — see resolveSharedWorkflowOwnerId.
  const sharesResourceArn = `arn:aws:omics:${region}:${account}:/shares`;

  it.each([
    '/aws-healthomics/workflow/read-private-workflow',
    '/aws-healthomics/workflow/list-workflow-versions',
    '/aws-healthomics/workflow/read-workflow-schema',
  ])('grants %s access to ListShares so the shared workflow owner account can be resolved', (policyName) => {
    const stack = createStack();
    expect(resourcesFor(stack, policyName, 'omics:ListShares')).toContain(sharesResourceArn);
  });
});
