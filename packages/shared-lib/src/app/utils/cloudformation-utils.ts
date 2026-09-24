import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStacksCommandInput,
  DescribeStacksCommandOutput,
  Output,
} from '@aws-sdk/client-cloudformation';

const cloudFormationClient: CloudFormationClient = new CloudFormationClient();

/**
 * Public utility to read a single output value from a named CloudFormation stack.
 *
 * A stack name is unique within an account and region, so this resolves values that
 * cannot be identified reliably by resource name.
 *
 * Returns undefined when the stack does not exist, has no outputs, or does not
 * publish the requested key — all legitimate states for a deployment that has not
 * been fully rolled out. Every other error propagates so credential and permission
 * failures still reach the caller.
 *
 * @param stackName
 * @param outputKey
 */
export async function getStackOutput(stackName: string, outputKey: string): Promise<string | undefined> {
  const describeStacksCommand: DescribeStacksCommand = new DescribeStacksCommand({
    StackName: stackName,
  } as DescribeStacksCommandInput);

  let response: DescribeStacksCommandOutput;
  try {
    response = await cloudFormationClient.send<DescribeStacksCommandInput, DescribeStacksCommandOutput>(
      describeStacksCommand,
    );
  } catch (error) {
    if (isStackNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }

  // A stack created by an un-executed changeset sits in REVIEW_IN_PROGRESS and
  // reports no Outputs at all, so this cannot assume the array is present.
  const outputs: Output[] = response.Stacks?.[0]?.Outputs ?? [];
  const output: Output | undefined = outputs.find((o: Output) => o.OutputKey === outputKey);

  return output?.OutputValue ? output.OutputValue.replace(/\/+$/, '') : undefined;
}

/**
 * Private utility to distinguish a missing stack, which is a supported state, from
 * every other ValidationError, which is not.
 */
function isStackNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ValidationError' && error.message.includes('does not exist');
}
