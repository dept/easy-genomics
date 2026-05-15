import { logSafeEvent } from '../../../src/app/utils/logSafeEvent';

describe('logSafeEvent', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => logSpy.mockRestore());

  const logged = (): Record<string, unknown> => {
    const raw: string = logSpy.mock.calls[0][0];
    return JSON.parse(raw.replace('EVENT: \n', ''));
  };

  describe('redactKeys — sensitive key names', () => {
    it('redacts an authorization key at root level', () => {
      logSafeEvent({ authorization: 'Bearer abc123', path: '/api' });
      expect(logged()).toEqual({ authorization: '[REDACTED]', path: '/api' });
    });

    it('redacts an email key at root level', () => {
      logSafeEvent({ email: 'user@example.com', id: '42' });
      expect(logged()).toEqual({ email: '[REDACTED]', id: '42' });
    });

    it('redacts a token key at root level', () => {
      logSafeEvent({ token: 'secret', userId: '1' });
      expect(logged()).toEqual({ token: '[REDACTED]', userId: '1' });
    });

    it('redacts a password key at root level', () => {
      logSafeEvent({ password: 'hunter2' });
      expect(logged()).toEqual({ password: '[REDACTED]' });
    });

    it('redacts a cookie key at root level', () => {
      logSafeEvent({ cookie: 'session=xyz' });
      expect(logged()).toEqual({ cookie: '[REDACTED]' });
    });

    it('redacts a phone key at root level', () => {
      logSafeEvent({ phone: '+1-555-0100' });
      expect(logged()).toEqual({ phone: '[REDACTED]' });
    });

    it('redacts phone_number (substring match) at root level', () => {
      logSafeEvent({ phone_number: '+1-555-0100' });
      expect(logged()).toEqual({ phone_number: '[REDACTED]' });
    });

    it('redacts sensitive keys nested inside objects', () => {
      logSafeEvent({ user: { email: 'a@b.com', name: 'Alice' } });
      expect(logged()).toEqual({ user: { email: '[REDACTED]', name: 'Alice' } });
    });

    it('redacts sensitive keys deeply nested', () => {
      logSafeEvent({ level1: { level2: { token: 'abc', safe: true } } });
      expect(logged()).toEqual({ level1: { level2: { token: '[REDACTED]', safe: true } } });
    });

    it('is case-insensitive — redacts Authorization with capital A', () => {
      logSafeEvent({ Authorization: 'Bearer xyz' });
      expect(logged()).toEqual({ Authorization: '[REDACTED]' });
    });
  });

  describe('redactKeys — non-sensitive values pass through', () => {
    it('passes through non-sensitive string values', () => {
      logSafeEvent({ path: '/health', method: 'GET' });
      expect(logged()).toEqual({ path: '/health', method: 'GET' });
    });

    it('passes through numeric values', () => {
      logSafeEvent({ statusCode: 200 });
      expect(logged()).toEqual({ statusCode: 200 });
    });

    it('passes through boolean values', () => {
      logSafeEvent({ isBase64Encoded: false });
      expect(logged()).toEqual({ isBase64Encoded: false });
    });

    it('passes through null values', () => {
      logSafeEvent({ body: null });
      expect(logged()).toEqual({ body: null });
    });
  });

  describe('redactKeys — array handling', () => {
    it('recurses into arrays and redacts sensitive keys inside elements', () => {
      logSafeEvent({
        records: [
          { email: 'a@b.com', id: '1' },
          { email: 'c@d.com', id: '2' },
        ],
      });
      expect(logged()).toEqual({
        records: [
          { email: '[REDACTED]', id: '1' },
          { email: '[REDACTED]', id: '2' },
        ],
      });
    });

    it('passes through arrays of primitives unchanged', () => {
      logSafeEvent({ ids: [1, 2, 3] });
      expect(logged()).toEqual({ ids: [1, 2, 3] });
    });
  });

  describe('requestContext.authorizer handling', () => {
    it('replaces requestContext.authorizer with REDACTED when present', () => {
      logSafeEvent({
        requestContext: {
          authorizer: { claims: { email: 'user@example.com', sub: 'uuid-123' } },
          requestId: 'req-1',
        },
        path: '/api',
      });
      const result = logged();
      expect(result.requestContext).toEqual({ authorizer: '[REDACTED]', requestId: 'req-1' });
      expect(result.path).toBe('/api');
    });

    it('does not throw when requestContext is absent (e.g. SQS event)', () => {
      expect(() => logSafeEvent({ Records: [{ body: '{}' }] })).not.toThrow();
    });

    it('does not throw when requestContext.authorizer is absent', () => {
      expect(() => logSafeEvent({ requestContext: { requestId: 'req-1' } })).not.toThrow();
      expect(logged()).toEqual({ requestContext: { requestId: 'req-1' } });
    });

    it('does not throw for an empty event object', () => {
      expect(() => logSafeEvent({})).not.toThrow();
    });

    it('does not throw for a primitive event value', () => {
      expect(() => logSafeEvent('plain-string')).not.toThrow();
    });
  });
});
