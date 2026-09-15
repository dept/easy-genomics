import { CloudFormationClient, ListStackResourcesCommand, StackResourceSummary } from '@aws-sdk/client-cloudformation';

export function isStackMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /does not exist/i.test(message);
}

export async function listAllStackResources(
  client: CloudFormationClient,
  stackName: string,
): Promise<StackResourceSummary[]> {
  const collected: StackResourceSummary[] = [];
  let nextToken: string | undefined;
  do {
    const resp = await client.send(new ListStackResourcesCommand({ StackName: stackName, NextToken: nextToken }));
    if (resp.StackResourceSummaries) {
      collected.push(...resp.StackResourceSummaries);
    }
    nextToken = resp.NextToken;
  } while (nextToken);
  return collected;
}

export async function listNestedStackPhysicalIds(client: CloudFormationClient, stackName: string): Promise<string[]> {
  let collected: StackResourceSummary[];
  try {
    collected = await listAllStackResources(client, stackName);
  } catch (err) {
    if (isStackMissingError(err)) {
      return [];
    }
    throw err;
  }
  return collected
    .filter((r) => r.ResourceType === 'AWS::CloudFormation::Stack' && r.PhysicalResourceId)
    .map((r) => r.PhysicalResourceId as string);
}
