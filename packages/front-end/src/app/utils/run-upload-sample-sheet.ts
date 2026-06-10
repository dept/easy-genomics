import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import type { GenerateDataCollectionSampleSheetResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
import { v4 as uuidv4 } from 'uuid';
import { useRunStore } from '@FE/stores';
import { buildSampleSheetFileName } from '@FE/utils/sample-sheet-utils';

export type SeedRunFromSampleSheetParams = {
  lab: Laboratory;
  labId: string;
  runName: string;
  platform: RunType;
  workflowExternalId: string;
  sampleSheetResult:
    | GenerateDataCollectionSampleSheetResponse
    | {
        SampleSheetS3Url: string;
        InputFileKeys: string[];
      };
  transactionId?: string;
};

export function seedWipRunFromSampleSheet(params: SeedRunFromSampleSheetParams): string {
  const runStore = useRunStore();
  const tempId = params.transactionId ?? uuidv4();
  const sampleSheetS3Url = params.sampleSheetResult.SampleSheetS3Url;
  const sampleSheetResponse = params.sampleSheetResult as GenerateDataCollectionSampleSheetResponse & {
    SampleSheetInfo?: { S3Url: string; Bucket: string; Path: string };
  };

  let s3Bucket = params.lab.S3Bucket!;
  let s3Path: string;
  if (sampleSheetResponse.SampleSheetInfo) {
    s3Bucket = sampleSheetResponse.SampleSheetInfo.Bucket;
    s3Path = sampleSheetResponse.SampleSheetInfo.Path;
  } else {
    const platformFolder = params.platform === 'AWS HealthOmics' ? 'aws-healthomics' : 'seqera-platform';
    s3Path = `${params.lab.OrganizationId}/${params.lab.LaboratoryId}/${platformFolder}/${tempId}`;
  }

  const wipSeed = {
    transactionId: tempId,
    runName: params.runName,
    sampleSheetS3Url,
    s3Bucket,
    s3Path,
    inputFileKeys: params.sampleSheetResult.InputFileKeys,
    paramsRequired: [] as string[],
  };
  const paramSeed = {
    input: sampleSheetS3Url,
    outdir: `s3://${s3Bucket}/${s3Path}/results`,
  };

  if (params.platform === 'AWS HealthOmics') {
    runStore.updateWipOmicsRun(tempId, wipSeed);
    runStore.updateWipOmicsRunParams(tempId, paramSeed);
  } else {
    runStore.updateWipSeqeraRun(tempId, wipSeed);
    runStore.updateWipSeqeraRunParams(tempId, paramSeed);
  }

  return tempId;
}

export function buildRunWizardUrl(
  labId: string,
  platform: RunType,
  workflowExternalId: string,
  runTempId: string,
): string {
  const from = 'data-collections';
  if (platform === 'AWS HealthOmics') {
    return `/labs/${labId}/run-workflow/${encodeURIComponent(workflowExternalId)}?omicsRunTempId=${runTempId}&from=${from}`;
  }
  return `/labs/${labId}/run-pipeline/${encodeURIComponent(workflowExternalId)}?seqeraRunTempId=${runTempId}&from=${from}`;
}

export function defaultSampleSheetName(runName: string): string {
  return buildSampleSheetFileName(runName);
}
