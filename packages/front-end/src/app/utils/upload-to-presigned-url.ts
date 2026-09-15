export async function uploadToPresignedUrl(url: string, file: File): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });

  if (!response.ok) {
    throw new Error(`Upload to presigned URL failed with status ${response.status}`);
  }
}
