import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';

export const MICROREACT_SCHEMA_URL = 'https://microreact.org/schema/v1.json';

const METADATA_FILE_ID = 'metadata-file';
const LATITUDE_HEADERS = ['latitude', 'lat'];
const LONGITUDE_HEADERS = ['longitude', 'long', 'lon', 'lng'];

export function microreactAccessTokenParameterName(organizationId: string, laboratoryId: string): string {
  return `/easy-genomics/organization/${organizationId}/laboratory/${laboratoryId}/microreact-access-token`;
}

export type MicroreactSourceFile = {
  fileName: string;
  content: string;
};

export type MicroreactProjectInput = {
  name: string;
  metadata: MicroreactSourceFile;
  trees: MicroreactSourceFile[];
};

type MicroreactFile = {
  id: string;
  name: string;
  format: 'text/csv' | 'text/x-nh';
  type: 'data' | 'tree';
  blob: string;
};

/** The `.microreact` document accepted by `POST /api/projects/create`. */
export type MicroreactProject = {
  schema: string;
  meta: { name: string };
  files: Record<string, MicroreactFile>;
  datasets: Record<string, { id: string; file: string; idFieldName: string }>;
  tables: Record<string, { title: string; file: string; columns: Array<{ field: string }> }>;
  trees: Record<string, Record<string, unknown>>;
  maps: Record<string, Record<string, unknown>>;
};

function quoteCsvField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

function parseCsvHeader(line: string): string[] {
  const headers: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      headers.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim());
  return headers;
}

/**
 * Microreact reads metadata as CSV. TSV fields cannot contain tabs, so a TSV
 * converts by splitting on tabs and quoting each field.
 */
export function metadataToCsv(fileName: string, content: string): { csv: string; headers: string[] } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new InvalidRequestError(`Metadata file ${fileName} needs a header row and at least one sample row`);
  }

  if (/\.csv$/i.test(fileName)) {
    return { csv: content, headers: parseCsvHeader(lines[0]) };
  }

  const rows = lines.map((line) => line.split('\t').map((field) => field.trim()));
  const csv = rows.map((row) => row.map(quoteCsvField).join(',')).join('\n') + '\n';
  return { csv, headers: rows[0] };
}

function toDataUrl(content: string): string {
  return `data:application/octet-stream;base64,${Buffer.from(content, 'utf-8').toString('base64')}`;
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  return headers.find((header) => candidates.includes(header.toLowerCase()));
}

export function buildMicroreactProject(input: MicroreactProjectInput): MicroreactProject {
  const { csv, headers } = metadataToCsv(input.metadata.fileName, input.metadata.content);
  const idField = headers[0];
  if (!idField) {
    throw new InvalidRequestError(`Metadata file ${input.metadata.fileName} has no ID column`);
  }

  const project: MicroreactProject = {
    schema: MICROREACT_SCHEMA_URL,
    meta: { name: input.name },
    files: {
      [METADATA_FILE_ID]: {
        id: METADATA_FILE_ID,
        name: input.metadata.fileName.replace(/\.[^.]+$/, '') + '.csv',
        format: 'text/csv',
        type: 'data',
        blob: toDataUrl(csv),
      },
    },
    datasets: { 'dataset-1': { id: 'dataset-1', file: METADATA_FILE_ID, idFieldName: idField } },
    tables: {
      'table-1': { title: 'Metadata', file: METADATA_FILE_ID, columns: headers.map((field) => ({ field })) },
    },
    trees: {},
    maps: {},
  };

  input.trees.forEach((tree, index) => {
    if (!tree.content.trim()) {
      throw new InvalidRequestError(`Tree file ${tree.fileName} is empty`);
    }
    const fileId = `tree-file-${index + 1}`;
    project.files[fileId] = {
      id: fileId,
      name: tree.fileName,
      format: 'text/x-nh',
      type: 'tree',
      blob: toDataUrl(tree.content),
    };
    project.trees[`tree-${index + 1}`] = {
      type: 'rc',
      title: tree.fileName,
      file: fileId,
      labelField: idField,
      showLabels: true,
      showLeafLabels: true,
    };
  });

  const latitudeField = findHeader(headers, LATITUDE_HEADERS);
  const longitudeField = findHeader(headers, LONGITUDE_HEADERS);
  if (latitudeField && longitudeField) {
    project.maps['map-1'] = {
      title: 'Map',
      dataType: 'geographic-coordinates',
      latitudeField,
      longitudeField,
    };
  }

  return project;
}
