const mockSend = jest.fn();

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetLogEventsCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { CloudWatchLogsService } from '../../../src/app/services/cloudwatch-logs-service';

describe('CloudWatchLogsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('joins event messages from the tail of the stream into one string', async () => {
    mockSend.mockResolvedValue({
      events: [{ message: 'line one' }, { message: '' }, { message: 'line two' }, {}],
    });

    const service = new CloudWatchLogsService();
    const text = await service.getLogStreamText('/aws/omics/WorkflowLog', 'run/123/engine', 50);

    expect(text).toBe('line one\nline two');
    const commandInput = mockSend.mock.calls[0][0].input;
    expect(commandInput).toEqual({
      logGroupName: '/aws/omics/WorkflowLog',
      logStreamName: 'run/123/engine',
      limit: 50,
      startFromHead: false,
    });
  });

  it('returns an empty string when the stream has no events', async () => {
    mockSend.mockResolvedValue({});
    const service = new CloudWatchLogsService();
    expect(await service.getLogStreamText('g', 's')).toBe('');
  });

  it('propagates SDK errors to the caller', async () => {
    mockSend.mockRejectedValue(new Error('ResourceNotFoundException'));
    const service = new CloudWatchLogsService();
    await expect(service.getLogStreamText('g', 's')).rejects.toThrow('ResourceNotFoundException');
  });
});
