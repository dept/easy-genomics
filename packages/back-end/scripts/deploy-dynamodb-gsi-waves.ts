/**
 * Pre-deploy helper that splits DynamoDB GSI creates/deletes across multiple
 * CloudFormation updates of the *currently deployed* templates.
 *
 * Why
 * ---
 * DynamoDB (and therefore `AWS::DynamoDB::Table`) rejects an UpdateTable that
 * creates or deletes more than one Global Secondary Index. Staging can land
 * two new indexes on `laboratory-run-table` in a single merge (PollStatus +
 * WorkflowExternalId), which is exactly the UAT failure:
 *
 *   Cannot perform more than one GSI creation or deletion in a single update
 *
 * Intermediate waves patch GetTemplate output (existing resources only) and
 * UpdateStack that template. They do **not** deploy cdk.out, so new Lambda
 * code cannot go live against a table that is still missing a later GSI.
 * The caller's final `cdk deploy` applies remaining app changes plus at most
 * one leftover GSI.
 *
 * Usage (from packages/back-end, already wired into `pnpm run deploy`):
 *   pnpm run deploy-dynamodb-gsi-waves
 *   pnpm run deploy-dynamodb-gsi-waves -- --dry-run
 */

import { join, resolve } from 'path';
import {
  CloudFormationClient,
  DescribeStacksCommand,
  GetTemplateCommand,
  UpdateStackCommand,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { isStackMissingError, listNestedStackPhysicalIds } from './lib/cloudformation-stack';
import { resolveDeployEnv } from './lib/deploy-env';
import { CfnTemplate, listTableSnapshots } from './lib/dynamodb-gsi-waves';
import { runGsiWaves } from './lib/gsi-wave-orchestrator';

const CDK_OUT_DIR = resolve(join(__dirname, '..', 'cdk.out'));
const BOOTSTRAP_QUALIFIER = process.env.CDK_BOOTSTRAP_QUALIFIER || 'hnb659fds';
const UPDATE_WAIT_SECONDS = 7200;

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

function parseTemplateBody(stackName: string, body: string | undefined): CfnTemplate | undefined {
  if (!body) {
    return undefined;
  }
  try {
    return JSON.parse(body) as CfnTemplate;
  } catch {
    throw new Error(
      `GSI waves: CloudFormation template for stack "${stackName}" is not JSON. ` +
        'This script cannot plan GSI waves from a YAML template body.',
    );
  }
}

async function getTemplateJson(client: CloudFormationClient, stackName: string): Promise<CfnTemplate | undefined> {
  try {
    const response = await client.send(new GetTemplateCommand({ StackName: stackName }));
    return parseTemplateBody(stackName, response.TemplateBody);
  } catch (err) {
    if (isStackMissingError(err)) {
      return undefined;
    }
    throw err;
  }
}

async function loadCurrentStacks(
  client: CloudFormationClient,
  topLevelStackNames: string[],
): Promise<Map<string, CfnTemplate>> {
  const stacks = new Map<string, CfnTemplate>();
  const visited = new Set<string>();

  const visit = async (stackName: string): Promise<void> => {
    if (visited.has(stackName)) {
      return;
    }
    visited.add(stackName);
    const template = await getTemplateJson(client, stackName);
    if (template && listTableSnapshots(template).length > 0) {
      stacks.set(stackName, template);
    }
    const nested = await listNestedStackPhysicalIds(client, stackName);
    for (const nestedId of nested) {
      await visit(nestedId);
    }
  };

  for (const stackName of topLevelStackNames) {
    await visit(stackName);
  }
  return stacks;
}

async function resolveAccountId(region: string): Promise<string> {
  if (process.env.AWS_ACCOUNT_ID) {
    return process.env.AWS_ACCOUNT_ID;
  }
  const sts = new STSClient({ region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Account) {
    throw new Error('GSI waves: could not resolve AWS account id for the CDK assets bucket.');
  }
  return identity.Account;
}

async function updateStackWithCurrentTemplate(
  cfn: CloudFormationClient,
  s3: S3Client,
  stackName: string,
  template: CfnTemplate,
  accountId: string,
  region: string,
): Promise<void> {
  const bucket = `cdk-${BOOTSTRAP_QUALIFIER}-assets-${accountId}-${region}`;
  const key = `gsi-waves/${encodeURIComponent(stackName)}/${Date.now()}.template.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(template),
      ContentType: 'application/json',
    }),
  );
  const templateUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  const described = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const parameters = (described.Stacks?.[0]?.Parameters ?? [])
    .filter((p) => p.ParameterKey)
    .map((p) => ({ ParameterKey: p.ParameterKey as string, UsePreviousValue: true }));

  try {
    await cfn.send(
      new UpdateStackCommand({
        StackName: stackName,
        TemplateURL: templateUrl,
        Parameters: parameters.length > 0 ? parameters : undefined,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/No updates are to be performed/i.test(message)) {
      return;
    }
    throw err;
  }

  await waitUntilStackUpdateComplete({ client: cfn, maxWaitTime: UPDATE_WAIT_SECONDS }, { StackName: stackName });
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const { dryRun } = parseArgs(argv);
  const env = resolveDeployEnv('GSI waves');
  const cdkOut = process.env.CDK_OUT ? resolve(process.env.CDK_OUT) : CDK_OUT_DIR;

  console.log(`GSI waves: env=${env.envType}-${env.envName} region=${env.awsRegion} cdkOut=${cdkOut}`);

  const cfn = new CloudFormationClient({ region: env.awsRegion });
  const s3 = new S3Client({ region: env.awsRegion });
  const topLevelStacks = [`${env.namePrefix}-easy-genomics-api-stack`, `${env.namePrefix}-main-back-end-stack`];

  const accountId = dryRun ? process.env.AWS_ACCOUNT_ID || 'dry-run' : await resolveAccountId(env.awsRegion);

  await runGsiWaves({
    cdkOut,
    dryRun,
    deps: {
      loadCurrentStacks: () => loadCurrentStacks(cfn, topLevelStacks),
      updateStack: (stackName, template) =>
        updateStackWithCurrentTemplate(cfn, s3, stackName, template, accountId, env.awsRegion),
    },
  });
}

if (!process.env.JEST_WORKER_ID) {
  main().catch((err: unknown) => {
    console.error('');
    console.error('GSI waves failed:');
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    console.error('');
    console.error('DynamoDB refuses to create or delete more than one GSI per table update. This script splits those');
    console.error(
      'changes across sequential CloudFormation updates of the currently deployed templates, then the final',
    );
    console.error('`cdk deploy` applies remaining app changes. Fix the error above and rerun `pnpm run deploy`.');
    process.exit(1);
  });
}
