import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { LaboratoryRunSchema } from '@easy-genomics/shared-lib/lib/app/schema/easy-genomics/laboratory-run';
import {
  ListLaboratoryRunsPaginatedResponse,
  ReadLaboratoryRun,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { getFilterResults, getFilters } from '@BE/utils/rest-api-utils';

const laboratoryService = new LaboratoryService();
const laboratoryRunService = new LaboratoryRunService();

const SERVER_PAGE_DEFAULT_LIMIT = 25;
const SERVER_PAGE_MAX_LIMIT = 100;
const SERVER_MODE_TRUE = 'true';
const MOCK_RUNS_COUNT = 150;
const LOCAL_STAGE = 'local';

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get mandatory query parameter(s)
    const laboratoryId: string | undefined = event.queryStringParameters?.LaboratoryId;
    if (!laboratoryId) {
      throw new InvalidRequestError();
    }

    // Check if laboratory exists and use it for permissions check
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) {
      throw new LaboratoryNotFoundError();
    }

    // Only available for Org Admins or Laboratory Managers and Technicians
    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const isServerMode = event.queryStringParameters?.serverMode === SERVER_MODE_TRUE;

    if (isServerMode) {
      const limit = parseLimit(event.queryStringParameters?.limit);
      const sortBy = parseSortBy(event.queryStringParameters?.sortBy);
      const sortDirection = parseSortDirection(event.queryStringParameters?.sortDirection);
      const filters = parseServerFilters(event.queryStringParameters ?? undefined);
      const nextToken = event.queryStringParameters?.nextToken;

      if (shouldUseMockRuns(event)) {
        const persistedRuns: LaboratoryRun[] = await laboratoryRunService.queryByLaboratoryId(laboratoryId);
        const mockRuns = buildMockRuns(laboratoryId, laboratory.OrganizationId);
        const mergedRuns = [...persistedRuns, ...mockRuns];
        const filteredRuns = applyServerModeFilters(mergedRuns, filters);
        const sortedRuns = sortRuns(filteredRuns, sortBy, sortDirection);
        const offset = decodeMockOffsetToken(nextToken);
        const pagedRuns = sortedRuns.slice(offset, offset + limit);
        const nextOffset = offset + pagedRuns.length;
        const hasMore = nextOffset < sortedRuns.length;

        const payload: ListLaboratoryRunsPaginatedResponse = {
          items: pagedRuns.map((laboratoryRun: LaboratoryRun) => ({
            ...laboratoryRun,
            Settings: JSON.parse(laboratoryRun.Settings || '{}'),
          })),
          hasMore,
          nextToken: hasMore ? encodeMockOffsetToken(nextOffset) : undefined,
        };

        return buildResponse(200, JSON.stringify(payload), event);
      }

      const response = await laboratoryRunService.queryByLaboratoryIdPaginated({
        laboratoryId,
        limit,
        sortBy,
        sortDirection,
        filters,
        exclusiveStartKey: decodeToken(nextToken),
      });

      const results: ReadLaboratoryRun[] = response.items.map((laboratoryRun: LaboratoryRun) => ({
        ...laboratoryRun,
        Settings: JSON.parse(laboratoryRun.Settings || '{}'),
      }));

      const payload: ListLaboratoryRunsPaginatedResponse = {
        items: results,
        hasMore: !!response.lastEvaluatedKey,
        nextToken: response.lastEvaluatedKey ? encodeToken(response.lastEvaluatedKey) : undefined,
      };

      return buildResponse(200, JSON.stringify(payload), event);
    }

    const laboratoryRuns: LaboratoryRun[] = await laboratoryRunService.queryByLaboratoryId(laboratoryId);

    // Get optional query parameter(s)
    const params = event.queryStringParameters ?? {};
    const queryParameters: [string, string][] = Object.entries(params).filter(
      (entry): entry is [string, string] => entry[0] !== 'LaboratoryId' && entry[1] !== undefined,
    );
    // Sanitize query parameters to the LaboratoryRun object's properties
    const filters: [string, string][] = getFilters(Object.keys(LaboratoryRunSchema.shape), queryParameters);

    const laboratoryRunsFiltered: LaboratoryRun[] = filters.length
      ? getFilterResults<LaboratoryRun>(laboratoryRuns, filters)
      : laboratoryRuns;

    const results: ReadLaboratoryRun[] = laboratoryRunsFiltered.map((laboratoryRun: LaboratoryRun) => {
      const readLaboratoryRun: ReadLaboratoryRun = {
        ...laboratoryRun,
        Settings: JSON.parse(laboratoryRun.Settings || '{}'),
      };
      return readLaboratoryRun;
    });

    return buildResponse(200, JSON.stringify(results), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};

function parseLimit(limit?: string): number {
  if (!limit) {
    return SERVER_PAGE_DEFAULT_LIMIT;
  }

  const parsedLimit = parseInt(limit, 10);
  if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
    throw new InvalidRequestError();
  }

  return Math.min(parsedLimit, SERVER_PAGE_MAX_LIMIT);
}

function parseSortBy(sortBy?: string): 'CreatedAt' | 'ModifiedAt' {
  if (!sortBy || sortBy === 'CreatedAt') {
    return 'CreatedAt';
  }
  if (sortBy === 'lastUpdated' || sortBy === 'ModifiedAt') {
    return 'ModifiedAt';
  }

  throw new InvalidRequestError();
}

function parseSortDirection(sortDirection?: string): 'asc' | 'desc' {
  if (!sortDirection || sortDirection.toLowerCase() === 'desc') {
    return 'desc';
  }
  if (sortDirection.toLowerCase() === 'asc') {
    return 'asc';
  }

  throw new InvalidRequestError();
}

function parseServerFilters(queryStringParameters?: Record<string, string | undefined>): {
  UserId?: string;
  Status?: string;
} {
  const filters: { UserId?: string; Status?: string } = {};

  if (queryStringParameters?.UserId) {
    filters.UserId = queryStringParameters.UserId;
  }

  if (queryStringParameters?.search) {
    const parsed = parseStructuredSearch(queryStringParameters.search);
    if (parsed.field === 'status') {
      filters.Status = parsed.value.toUpperCase();
    } else {
      throw new InvalidRequestError();
    }
  }

  return filters;
}

function parseStructuredSearch(search: string): { field: string; value: string } {
  const normalized = search.trim();
  const equalsIndex = normalized.indexOf('=');
  if (equalsIndex <= 0) {
    throw new InvalidRequestError();
  }

  const fieldRaw = normalized
    .slice(0, equalsIndex)
    .replace(/^"+|"+$/g, '')
    .trim()
    .toLowerCase();
  const valueRaw = normalized
    .slice(equalsIndex + 1)
    .replace(/^"+|"+$/g, '')
    .trim();
  if (!fieldRaw || !valueRaw) {
    throw new InvalidRequestError();
  }

  return {
    field: fieldRaw,
    value: valueRaw,
  };
}

function encodeToken(lastEvaluatedKey: Record<string, AttributeValue>): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

function decodeToken(token?: string): Record<string, AttributeValue> | undefined {
  if (!token) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch (_err) {
    throw new InvalidRequestError();
  }
}

function shouldUseMockRuns(event: APIGatewayProxyWithCognitoAuthorizerEvent): boolean {
  const envType = (process.env.ENV_TYPE || '').toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const stage = (event.requestContext?.stage || '').toLowerCase();

  return (
    envType === 'dev' ||
    envType === 'development' ||
    envType === 'local' ||
    nodeEnv === 'development' ||
    stage === LOCAL_STAGE
  );
}

function buildMockRuns(laboratoryId: string, organizationId: string): LaboratoryRun[] {
  const statuses = ['SUBMITTED', 'STARTING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
  const platforms: ('AWS HealthOmics' | 'Seqera Cloud')[] = ['AWS HealthOmics', 'Seqera Cloud'];
  const now = new Date();

  return Array.from({ length: MOCK_RUNS_COUNT }, (_value, idx) => {
    const runNumber = idx + 1;
    const createdAt = new Date(now.getTime() - runNumber * 60 * 60 * 1000);
    const modifiedAt = new Date(createdAt.getTime() + (runNumber % 5) * 10 * 60 * 1000);

    return {
      LaboratoryId: laboratoryId,
      OrganizationId: organizationId,
      RunId: makeDeterministicUuid(`run-${runNumber}`),
      UserId: makeDeterministicUuid(`user-${(runNumber % 8) + 1}`),
      RunName: `Mock Run ${String(runNumber).padStart(3, '0')}`,
      Platform: platforms[runNumber % platforms.length],
      Status: statuses[runNumber % statuses.length],
      Owner: `mock-user-${(runNumber % 8) + 1}@example.com`,
      WorkflowName: `Workflow ${(runNumber % 12) + 1}`,
      ExternalRunId: `mock-external-run-${runNumber}`,
      CreatedAt: createdAt.toISOString(),
      ModifiedAt: modifiedAt.toISOString(),
      Settings: JSON.stringify({ mock: true, runNumber }),
    };
  });
}

function makeDeterministicUuid(seed: string): string {
  const hex = Buffer.from(seed).toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function applyServerModeFilters(runs: LaboratoryRun[], filters: { UserId?: string; Status?: string }): LaboratoryRun[] {
  return runs.filter((run) => {
    if (filters.UserId && run.UserId !== filters.UserId) {
      return false;
    }
    if (filters.Status && run.Status !== filters.Status) {
      return false;
    }
    return true;
  });
}

function sortRuns(
  runs: LaboratoryRun[],
  sortBy: 'CreatedAt' | 'ModifiedAt',
  sortDirection: 'asc' | 'desc',
): LaboratoryRun[] {
  const sortedRuns = [...runs].sort((a, b) => {
    const left = (a[sortBy] || '').toString();
    const right = (b[sortBy] || '').toString();
    return left.localeCompare(right);
  });
  return sortDirection === 'asc' ? sortedRuns : sortedRuns.reverse();
}

function encodeMockOffsetToken(offset: number): string {
  return Buffer.from(JSON.stringify({ type: 'mock-offset', offset })).toString('base64');
}

function decodeMockOffsetToken(token?: string): number {
  if (!token) {
    return 0;
  }

  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
    if (parsed?.type !== 'mock-offset' || typeof parsed.offset !== 'number' || parsed.offset < 0) {
      throw new InvalidRequestError();
    }
    return parsed.offset;
  } catch (_err) {
    throw new InvalidRequestError();
  }
}
