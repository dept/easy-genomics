import type { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import type {
  SampleSheetResponse,
  UploadedFilePairInfo,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/upload/s3-file-upload-sample-sheet';
import {
  buildUploadedFilePairsFromKeys,
  type PairingValidationResult,
} from '@FE/utils/data-collections-to-sample-sheet';
import { buildSampleSheetFileName } from '@FE/utils/sample-sheet-utils';

export type RunInputSource = 'upload' | 'library';

export type RegenerateSampleSheetParams = {
  labId: string;
  transactionId: string;
  platform: RunType;
  runName: string;
  s3Bucket: string;
  keys: string[];
  sampleIdSplitPattern?: string | null;
  getSampleSheetCsv: (pairs: UploadedFilePairInfo[], sampleSheetName: string) => Promise<SampleSheetResponse>;
};

export type RegenerateSampleSheetResult =
  | {
      ok: true;
      sampleSheet: SampleSheetResponse;
      pairs: UploadedFilePairInfo[];
      inputFileKeys: string[];
    }
  | { ok: false; pairing: PairingValidationResult };

export async function regenerateSampleSheetFromKeys(
  params: RegenerateSampleSheetParams,
): Promise<RegenerateSampleSheetResult> {
  const pairing = buildUploadedFilePairsFromKeys(
    params.keys,
    params.s3Bucket,
    undefined,
    params.sampleIdSplitPattern ?? null,
  );

  if (!pairing.ok) {
    return { ok: false, pairing };
  }

  const sampleSheetName = buildSampleSheetFileName(params.runName);
  const sampleSheet = await params.getSampleSheetCsv(pairing.pairs, sampleSheetName);

  const inputFileKeys = pairing.pairs
    .flatMap((pair) => [pair.R1?.Key, pair.R2?.Key])
    .filter((k): k is string => typeof k === 'string' && k.length > 0);

  return { ok: true, sampleSheet, pairs: pairing.pairs, inputFileKeys };
}
