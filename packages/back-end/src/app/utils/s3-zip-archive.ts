import { PassThrough, type Readable } from 'stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import archiver from 'archiver';
import { S3Service } from '@BE/services/s3-service';

const MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

export type S3ZipArchiveEntry = {
  sourceBucket: string;
  sourceKey: string;
  archivePath: string;
};

/**
 * Streams listed S3 objects into a ZIP uploaded with multipart PutObject.
 * The upload promise is settled even if listing/getObject fails mid-loop so
 * the caller can still write a FAILED job status.
 */
export async function zipS3ObjectsToArchive(params: {
  s3: S3Service;
  destinationBucket: string;
  destinationKey: string;
  entries: S3ZipArchiveEntry[];
}): Promise<void> {
  const uploadStream = new PassThrough();
  uploadStream.on('error', () => undefined);
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(uploadStream);
  let archiveError: Error | undefined;

  const uploadPromise = uploadZipMultipart(params.s3, params.destinationBucket, params.destinationKey, uploadStream);
  const uploadSettled = uploadPromise.then(
    () => undefined,
    () => undefined,
  );

  archive.on('warning', (warning: unknown) => {
    console.warn('Zip warning: ', warning);
  });
  archive.on('error', (err: unknown) => {
    archiveError = err instanceof Error ? err : new Error(String(err));
    uploadStream.destroy();
  });

  try {
    for (const entry of params.entries) {
      const object = await params.s3.getObject({
        Bucket: entry.sourceBucket,
        Key: entry.sourceKey,
      });
      if (!object.Body) continue;
      archive.append(object.Body as unknown as Readable, { name: entry.archivePath });
    }

    await archive.finalize();
    await uploadPromise;
    if (archiveError) {
      throw archiveError;
    }
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error(String(error));
    uploadStream.destroy();
    await uploadSettled;
    throw safeError;
  }
}

const uploadZipMultipart = async (
  s3: S3Service,
  bucket: string,
  key: string,
  zipStream: PassThrough,
): Promise<void> => {
  const s3Client: S3Client = s3.getClient();
  const uploader = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: zipStream,
      ContentType: 'application/zip',
    },
    partSize: MULTIPART_PART_SIZE_BYTES,
    leavePartsOnError: false,
  });
  await uploader.done();
};
