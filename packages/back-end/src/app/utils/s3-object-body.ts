import { Readable } from 'stream';

/**
 * Reads an S3 GetObject Body into a UTF-8 string. SDK v3 may return a
 * transformToString() helper or a Node readable.
 */
export async function s3BodyToString(body: unknown): Promise<string> {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf-8');

  const bodyWithTransform = body as { transformToString?: () => Promise<string> };
  if (typeof bodyWithTransform.transformToString === 'function') {
    return bodyWithTransform.transformToString();
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
