// The client is constructed at module load, so the SDK is mocked rather than the
// instance. shared-lib declares no AWS mocking library of its own; the root-level
// aws-sdk-client-mock resolves an older @smithy/types than the CloudFormation
// client compiles against, so it cannot be used here.
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cloudformation', () => ({
  CloudFormationClient: jest.fn(() => ({ send: mockSend })),
  DescribeStacksCommand: jest.fn((input: unknown) => ({ input })),
}));

import { getStackOutput } from './cloudformation-utils';

describe('getStackOutput', () => {
  const stackName = 'dev-demo-main-back-end-stack';
  const outputKey = 'ApiGatewayRestApiUrl';
  const outputValue = 'https://enq0s22xth.execute-api.us-west-2.amazonaws.com/prod';

  const stackWithOutputs = (outputs: { OutputKey: string; OutputValue: string }[]) => ({
    Stacks: [{ StackName: stackName, StackStatus: 'CREATE_COMPLETE', Outputs: outputs }],
  });

  const awsError = (name: string, message: string) => Object.assign(new Error(message), { name });

  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns the value published under the requested key', async () => {
    mockSend.mockResolvedValue(
      stackWithOutputs([
        { OutputKey: 'SomeOtherOutput', OutputValue: 'ignored' },
        { OutputKey: outputKey, OutputValue: outputValue },
      ]),
    );

    await expect(getStackOutput(stackName, outputKey)).resolves.toEqual(outputValue);
  });

  it('queries the stack by name', async () => {
    mockSend.mockResolvedValue({ Stacks: [] });

    await getStackOutput(stackName, outputKey);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual({ StackName: stackName });
  });

  it('returns the value verbatim, leaving normalisation to the caller', async () => {
    mockSend.mockResolvedValue(stackWithOutputs([{ OutputKey: outputKey, OutputValue: `${outputValue}/` }]));

    await expect(getStackOutput(stackName, outputKey)).resolves.toEqual(`${outputValue}/`);
  });

  it('returns undefined when the stack does not publish the requested key', async () => {
    mockSend.mockResolvedValue(stackWithOutputs([{ OutputKey: 'SomeOtherOutput', OutputValue: 'ignored' }]));

    await expect(getStackOutput(stackName, outputKey)).resolves.toBeUndefined();
  });

  it('returns undefined when the stack reports no outputs at all', async () => {
    // A stack created by an un-executed changeset sits in REVIEW_IN_PROGRESS with no
    // Outputs array, which must not be read as a missing key on a healthy stack.
    mockSend.mockResolvedValue({ Stacks: [{ StackName: stackName, StackStatus: 'REVIEW_IN_PROGRESS' }] });

    await expect(getStackOutput(stackName, outputKey)).resolves.toBeUndefined();
  });

  it('returns undefined when the response contains no stacks', async () => {
    mockSend.mockResolvedValue({ Stacks: [] });

    await expect(getStackOutput(stackName, outputKey)).resolves.toBeUndefined();
  });

  it('returns undefined when the published value is empty', async () => {
    mockSend.mockResolvedValue(stackWithOutputs([{ OutputKey: outputKey, OutputValue: '' }]));

    await expect(getStackOutput(stackName, outputKey)).resolves.toBeUndefined();
  });

  it('returns undefined when the stack does not exist', async () => {
    // The back-end has not been deployed yet — a supported state, not a failure.
    mockSend.mockRejectedValue(awsError('ValidationError', `Stack with id ${stackName} does not exist`));

    await expect(getStackOutput(stackName, outputKey)).resolves.toBeUndefined();
  });

  it('rethrows a permission failure rather than reporting it as a missing stack', async () => {
    // Swallowing this would let the caller report "deploy the back-end first" for an
    // IAM problem, sending the operator to fix something that is not broken.
    mockSend.mockRejectedValue(
      awsError('AccessDenied', 'User is not authorized to perform: cloudformation:DescribeStacks'),
    );

    await expect(getStackOutput(stackName, outputKey)).rejects.toThrow(/not authorized/);
  });

  it('rethrows a credentials failure', async () => {
    mockSend.mockRejectedValue(awsError('CredentialsProviderError', 'Could not load credentials from any providers'));

    await expect(getStackOutput(stackName, outputKey)).rejects.toThrow(/credentials/);
  });

  it('rethrows a ValidationError that is not a missing stack', async () => {
    mockSend.mockRejectedValue(awsError('ValidationError', '1 validation error detected'));

    await expect(getStackOutput(stackName, outputKey)).rejects.toThrow(/validation error detected/);
  });
});
