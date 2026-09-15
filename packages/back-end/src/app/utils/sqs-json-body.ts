/**
 * Parse an SQS record body that may be either:
 *  - a raw JSON payload published directly to the queue, or
 *  - an SNS→SQS notification envelope (`{ Message: "<json string>" }`) left
 *    over from the previous SNS fan-in topology.
 *
 * Publishing now goes straight to the FIFO queues (no SNS hop), but keeping
 * both shapes means in-flight SNS-wrapped messages still process cleanly
 * during a rolling deploy.
 */
export function parseSqsJsonBody<T>(body: string): T {
  const parsed = JSON.parse(body);
  if (parsed && typeof parsed === 'object' && typeof parsed.Message === 'string') {
    return JSON.parse(parsed.Message) as T;
  }
  return parsed as T;
}
