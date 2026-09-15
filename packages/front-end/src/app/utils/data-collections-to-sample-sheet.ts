import type {
  UploadedFileInfo,
  UploadedFilePairInfo,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/easy-genomics-api';

/** Placeholder region; sample-sheet generation validates objects by bucket/key on the server. */
export const DEFAULT_S3_REGION = 'us-east-1';

export function getFileNameWithoutExt(fileName: string): string {
  return fileName.replace(/\.f(ast)?q.*$/i, '');
}

export function getReadDirection(fileName: string, sampleIdSplitPattern?: string | null): 'R1' | 'R2' | null {
  const nameWithoutExt = getFileNameWithoutExt(fileName);

  if (/_R1(?:_|$)/i.test(nameWithoutExt)) return 'R1';
  if (/_R2(?:_|$)/i.test(nameWithoutExt)) return 'R2';

  const pattern = sampleIdSplitPattern?.trim();
  if (!pattern) return null;

  const patternIndex = nameWithoutExt.indexOf(pattern);
  if (patternIndex === -1) return null;

  const suffixAfterPattern = nameWithoutExt.substring(patternIndex + pattern.length);
  const readNumberMatch = suffixAfterPattern.match(/^([12])(?:_|$)/);
  if (!readNumberMatch) return null;

  return readNumberMatch[1] === '1' ? 'R1' : 'R2';
}

export function getSampleIdFromRFileName(fileName: string, sampleIdSplitPattern?: string | null): string | null {
  const pattern = sampleIdSplitPattern?.trim();
  if (pattern) {
    const idx = fileName.indexOf(pattern);
    return idx !== -1 ? fileName.substring(0, idx) || null : null;
  }
  return fileName.substring(0, fileName.lastIndexOf('_R')) || null;
}

function getSharedSampleIdFromPair(
  r1Name?: string,
  r2Name?: string,
  sampleIdSplitPattern?: string | null,
): string | null {
  const r1SampleId = getSampleIdFromRFileName(r1Name || '', sampleIdSplitPattern);
  const r2SampleId = getSampleIdFromRFileName(r2Name || '', sampleIdSplitPattern);
  return r1SampleId || r2SampleId;
}

export type PairingValidationResult = { ok: true; pairs: UploadedFilePairInfo[] } | { ok: false; message: string };

/**
 * Build UploadedFilePairInfo from laboratory S3 object keys (same pairing rules as EGRunFormUploadData).
 */
export function buildUploadedFilePairsFromKeys(
  keys: string[],
  bucket: string,
  region: string = DEFAULT_S3_REGION,
  sampleIdSplitPattern?: string | null,
): PairingValidationResult {
  if (!keys.length) {
    return { ok: false, message: 'No files selected.' };
  }

  const uploadedFilePairs: UploadedFilePairInfo[] = [];

  for (const key of keys) {
    const name = key.split('/').pop() || key;
    const uploadFileInfo: UploadedFileInfo = { Bucket: bucket, Key: key, Region: region };

    const sampleId = getSampleIdFromRFileName(name, sampleIdSplitPattern);
    const readDirection = getReadDirection(name, sampleIdSplitPattern);
    const fileName = getFileNameWithoutExt(name);

    if (!sampleId || !readDirection) {
      uploadedFilePairs.push({
        SampleId: fileName,
        R1: uploadFileInfo,
      });
      continue;
    }

    const existingFilePair = uploadedFilePairs.find(
      (filePair) =>
        getSharedSampleIdFromPair(
          filePair.R1?.Key?.split('/').at(-1),
          filePair.R2?.Key?.split('/').at(-1),
          sampleIdSplitPattern,
        ) === sampleId,
    );

    if (existingFilePair) {
      if (readDirection === 'R1') {
        existingFilePair.R1 = uploadFileInfo;
      } else if (readDirection === 'R2') {
        existingFilePair.R2 = uploadFileInfo;
      }

      if (!existingFilePair.R1 || !existingFilePair.R2) {
        existingFilePair.SampleId = fileName;
      } else {
        existingFilePair.SampleId = sampleId;
      }
    } else {
      uploadedFilePairs.push({
        SampleId: fileName,
        R1: readDirection === 'R1' ? uploadFileInfo : undefined,
        R2: readDirection === 'R2' ? uploadFileInfo : undefined,
      });
    }
  }

  return validateUploadedFilePairs(uploadedFilePairs);
}

export function validateUploadedFilePairs(pairs: UploadedFilePairInfo[]): PairingValidationResult {
  const areAllPairsComplete = pairs.every((pair) => pair.R1);
  if (!areAllPairsComplete) {
    return { ok: false, message: 'There is an R2 file with no matching R1 file.' };
  }

  const haveMatchedFiles = pairs.some((pair) => pair.R1 && pair.R2);
  const haveUnmatchedFiles = pairs.some((pair) => !pair.R1 || !pair.R2);

  if (haveMatchedFiles && haveUnmatchedFiles) {
    return {
      ok: false,
      message: 'There is a mix of single files and pair files. Files must be all single files or all pair files.',
    };
  }

  return { ok: true, pairs };
}
