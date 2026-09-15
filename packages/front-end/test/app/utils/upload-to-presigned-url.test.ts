import { uploadToPresignedUrl } from '../../../src/app/utils/upload-to-presigned-url';

describe('uploadToPresignedUrl', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('PUTs the file to the given URL with its content type', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = mockFetch as any;
    const file = new File(['fake-image-bytes'], 'logo.png', { type: 'image/png' });

    await uploadToPresignedUrl('https://signed-url.example', file);

    expect(mockFetch).toHaveBeenCalledWith('https://signed-url.example', {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'image/png' },
    });
  });

  it('throws when the upload response is not ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 }) as any;
    const file = new File(['fake-image-bytes'], 'logo.png', { type: 'image/png' });

    await expect(uploadToPresignedUrl('https://signed-url.example', file)).rejects.toThrow(
      'Upload to presigned URL failed with status 403',
    );
  });
});
