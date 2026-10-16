import { Readable } from 'stream';
import { s3BodyToString } from '../../../src/app/utils/s3-object-body';

describe('s3BodyToString', () => {
  it('returns an empty string for a missing body', async () => {
    await expect(s3BodyToString(undefined)).resolves.toBe('');
  });

  it('returns a string body as-is', async () => {
    await expect(s3BodyToString('{"Status":"PENDING"}')).resolves.toBe('{"Status":"PENDING"}');
  });

  it('decodes a Buffer body', async () => {
    await expect(s3BodyToString(Buffer.from('hello', 'utf-8'))).resolves.toBe('hello');
  });

  it('uses transformToString when present', async () => {
    await expect(s3BodyToString({ transformToString: async () => 'from-sdk' })).resolves.toBe('from-sdk');
  });

  it('concatenates a Node readable', async () => {
    const body = Readable.from([Buffer.from('ab'), Buffer.from('cd')]);
    await expect(s3BodyToString(body)).resolves.toBe('abcd');
  });
});
