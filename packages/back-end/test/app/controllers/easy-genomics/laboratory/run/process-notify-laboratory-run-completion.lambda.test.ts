import { Context } from 'aws-lambda';
import { SQSEvent, SQSRecord } from 'aws-lambda/trigger/sqs';
import { handler } from '../../../../../../src/app/controllers/easy-genomics/laboratory/run/process-notify-laboratory-run-completion.lambda';

jest.mock('../../../../../../src/app/services/easy-genomics/notification-service');

import { NotificationService } from '../../../../../../src/app/services/easy-genomics/notification-service';

// The lambda holds a module-scope `NotificationService` singleton. `notifyRunCompletion` is a real
// prototype method, so Jest's class automock snapshots it as a frozen own-instance property at
// construction time (see the identical note in notification-service.test.ts) — reassigning
// `NotificationService.prototype.notifyRunCompletion` from inside a test never reaches it.
// Mutating the captured instance's own property is what actually takes effect.
const notificationServiceInstance = (NotificationService as jest.MockedClass<typeof NotificationService>).mock
  .instances[0] as jest.Mocked<NotificationService>;

describe('process-notify-laboratory-run-completion.lambda', () => {
  const createEvent = (records: SQSRecord[]): SQSEvent => ({ Records: records }) as any;
  const createContext = (): Context =>
    ({ functionName: 'process-notify-laboratory-run-completion', getRemainingTimeInMillis: () => 30000 }) as any;

  let mockNotify: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotify = jest.fn().mockResolvedValue({ sent: 1 });
    notificationServiceInstance.notifyRunCompletion = mockNotify;
  });

  it('resolves and sends notifications for a LaboratoryRun SNS processing event', async () => {
    const snsBody = {
      Message: JSON.stringify({
        Operation: 'UPDATE',
        Type: 'LaboratoryRun',
        Record: { RunId: 'run-1', LaboratoryId: 'lab-1', Status: 'COMPLETED' },
      }),
    };
    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ RunId: 'run-1' }));
  });

  it('skips non-LaboratoryRun event types without throwing', async () => {
    const snsBody = { Message: JSON.stringify({ Operation: 'UPDATE', Type: 'User', Record: {} }) };
    const event = createEvent([{ body: JSON.stringify(snsBody) } as any]);

    const result = await handler(event, createContext(), () => {});

    expect(result.statusCode).toBe(200);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
