import type { WorkflowListItem } from '@aws-sdk/client-omics';
import { ListSharesCommandInput, ListWorkflowsCommandInput } from '@aws-sdk/client-omics';
import { GetParameterCommandOutput, ParameterNotFound } from '@aws-sdk/client-ssm';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { RequiredIdNotFoundError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import {
  ListUnifiedWorkflowCatalogResponse,
  UnifiedWorkflowCatalogEntry,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { ListPipelinesResponse } from '@easy-genomics/shared-lib/src/app/types/nf-tower/nextflow-tower-api';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { OmicsService } from '@BE/services/omics-service';
import { SsmService } from '@BE/services/ssm-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';
import { workflowIdFromOmicsShare } from '@BE/utils/laboratory-workflow-access-utils';
import { getNextFlowApiQueryParameters, httpRequest, REST_API_METHOD } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const omicsService = new OmicsService();
const ssmService = new SsmService();

async function listAllPrivateWorkflows(): Promise<WorkflowListItem[]> {
  const items: WorkflowListItem[] = [];
  let nextToken: string | undefined;
  do {
    const page = await omicsService.listWorkflows(<ListWorkflowsCommandInput>{
      type: 'PRIVATE',
      maxResults: 100,
      startingToken: nextToken,
      status: undefined,
    });
    if (page.items?.length) {
      items.push(...page.items);
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}

async function listAllSharedWorkflowSummaries(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let nextToken: string | undefined;
  do {
    const page = await omicsService.listSharedWorkflows(<ListSharesCommandInput>{
      resourceOwner: 'OTHER',
      maxResults: 100,
      nextToken,
    });
    for (const share of page.shares ?? []) {
      const id = workflowIdFromOmicsShare(share);
      if (!id) {
        continue;
      }
      const name = share.shareName ?? id;
      out.push({ id, name });
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return out;
}

async function fetchSeqeraPipelinesForLab(laboratory: Laboratory): Promise<UnifiedWorkflowCatalogEntry[]> {
  if (!laboratory.NextFlowTowerEnabled) {
    return [];
  }

  const getParameterResponse: GetParameterCommandOutput | void = await ssmService
    .getParameter({
      Name: `/easy-genomics/organization/${laboratory.OrganizationId}/laboratory/${laboratory.LaboratoryId}/nf-access-token`,
      WithDecryption: true,
    })
    .catch((error: any) => {
      if (error instanceof ParameterNotFound) {
        return undefined;
      }
      throw error;
    });

  const accessToken: string | undefined = getParameterResponse ? getParameterResponse.Parameter?.Value : undefined;
  if (!accessToken) {
    return [];
  }

  const seqeraApiBaseUrl: string = laboratory.NextFlowTowerApiBaseUrl || process.env.SEQERA_API_BASE_URL!;
  const apiQueryParameters: string = getNextFlowApiQueryParameters(undefined, laboratory.NextFlowTowerWorkspaceId);
  const entries: UnifiedWorkflowCatalogEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const max = 100;

  for (;;) {
    const params = new URLSearchParams(apiQueryParameters);
    params.set('max', String(max));
    params.set('offset', String(offset));
    const response: ListPipelinesResponse = await httpRequest<ListPipelinesResponse>(
      `${seqeraApiBaseUrl}/pipelines?${params.toString()}`,
      REST_API_METHOD.GET,
      { Authorization: `Bearer ${accessToken}` },
    );
    const pipelines = response.pipelines ?? [];
    if (!pipelines.length) {
      break;
    }
    for (const p of pipelines) {
      const pid = p.pipelineId;
      if (pid == null) {
        continue;
      }
      const id = String(pid);
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      entries.push({
        platform: 'Seqera',
        workflowId: id,
        name: p.name ?? id,
      });
    }
    offset += pipelines.length;
    if (pipelines.length < max || (response.totalSize != null && offset >= response.totalSize)) {
      break;
    }
  }
  return entries;
}

/**
 * GET /easy-genomics/organization/workflow-access/list-workflow-catalog?organizationId=
 *
 * Unified HealthOmics + Seqera workflows for admin assignment UI (full catalog).
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const organizationId: string = event.queryStringParameters?.organizationId || '';
    if (organizationId === '') throw new RequiredIdNotFoundError('organizationId');

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const laboratories: Laboratory[] = await laboratoryService.queryByOrganizationId(organizationId);

    const workflows: UnifiedWorkflowCatalogEntry[] = [];
    const seenKeys = new Set<string>();

    const anyOmics = laboratories.some((l) => l.AwsHealthOmicsEnabled);
    if (anyOmics) {
      const [privateWf, sharedSummaries] = await Promise.all([
        listAllPrivateWorkflows(),
        listAllSharedWorkflowSummaries(),
      ]);
      for (const w of privateWf) {
        if (!w.id) {
          continue;
        }
        const key = `HealthOmics:${w.id}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        workflows.push({
          platform: 'HealthOmics',
          workflowId: w.id,
          name: w.name ?? w.id,
        });
      }
      for (const s of sharedSummaries) {
        /*
         * Omics `ListWorkflows` also returns shared workflows for some accounts; shares are listed
         * separately here. De-dupe by id.
         */
        const key = `HealthOmics:${s.id}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        workflows.push({
          platform: 'HealthOmics',
          workflowId: s.id,
          name: s.name,
        });
      }
    }

    const seqeraLabs = laboratories.filter((l) => l.NextFlowTowerEnabled);
    for (const lab of seqeraLabs) {
      const rows = await fetchSeqeraPipelinesForLab(lab);
      for (const row of rows) {
        const key = `Seqera:${row.workflowId}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        workflows.push(row);
      }
    }

    workflows.sort((a, b) => {
      const pn = a.name.localeCompare(b.name);
      if (pn !== 0) {
        return pn;
      }
      return `${a.platform}:${a.workflowId}`.localeCompare(`${b.platform}:${b.workflowId}`);
    });

    const body: ListUnifiedWorkflowCatalogResponse = { workflows };
    return buildResponse(200, JSON.stringify(body), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
