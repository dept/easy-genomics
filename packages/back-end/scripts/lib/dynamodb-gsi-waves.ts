/**
 * DynamoDB / CloudFormation only allow one GSI create OR one GSI delete per
 * `UpdateTable` (see https://github.com/aws/aws-cdk/issues/12246). Adding two
 * new indexes to an existing table in a single `cdk deploy` therefore fails
 * with "Cannot perform more than one GSI creation or deletion in a single update".
 *
 * These helpers plan intermediate CloudFormation updates that apply at most
 * one GSI mutation per table, so the pre-synthesized `cdk.out` assembly can
 * still be reused (no extra 5-minute synth) while the final deploy lands the
 * full desired index set.
 */

export type CfnKeySchemaElement = {
  AttributeName: string;
  KeyType?: string;
};

export type CfnAttributeDefinition = {
  AttributeName: string;
  AttributeType?: string;
};

export type CfnGlobalSecondaryIndex = {
  IndexName: string;
  KeySchema?: CfnKeySchemaElement[];
  Projection?: unknown;
  [k: string]: unknown;
};

export type CfnTableProperties = {
  TableName?: string;
  AttributeDefinitions?: CfnAttributeDefinition[];
  KeySchema?: CfnKeySchemaElement[];
  GlobalSecondaryIndexes?: CfnGlobalSecondaryIndex[];
  LocalSecondaryIndexes?: Array<{ KeySchema?: CfnKeySchemaElement[]; [k: string]: unknown }>;
  [k: string]: unknown;
};

export type CfnTableResource = {
  Type: string;
  Properties?: CfnTableProperties;
  Metadata?: unknown;
  [k: string]: unknown;
};

export type CfnTemplate = {
  Resources?: Record<string, CfnTableResource>;
  [k: string]: unknown;
};

export type TableGsiSnapshot = {
  tableName: string;
  logicalId: string;
  gsis: CfnGlobalSecondaryIndex[];
};

export type TableWaveChange = {
  tableName: string;
  logicalId: string;
  from: string[];
  to: string[];
  add?: string;
  remove?: string;
};

const BACKUP_SUFFIX = '.gsi-wave.bak';

export function backupSuffix(): string {
  return BACKUP_SUFFIX;
}

export function gsiIndexNames(gsis: CfnGlobalSecondaryIndex[] | undefined): string[] {
  return (gsis ?? [])
    .map((gsi) => gsi.IndexName)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

export function gsiDiff(currentNames: string[], desiredNames: string[]): { toAdd: string[]; toRemove: string[] } {
  const currentSet = new Set(currentNames);
  const desiredSet = new Set(desiredNames);
  return {
    toAdd: desiredNames.filter((name) => !currentSet.has(name)),
    toRemove: currentNames.filter((name) => !desiredSet.has(name)),
  };
}

/**
 * Number of GSI create/delete operations CloudFormation would issue in one
 * table update. Create+delete both count; the DynamoDB API rejects a request
 * that does more than one of either, and also rejects create+delete together.
 */
export function gsiMutationCount(currentNames: string[], desiredNames: string[]): number {
  const { toAdd, toRemove } = gsiDiff(currentNames, desiredNames);
  return toAdd.length + toRemove.length;
}

/**
 * Next legal CloudFormation GSI list: keep currently-deployed index order and
 * apply at most one add (preferred) or one remove. Returns `currentNames` when
 * the table is already at the desired set.
 */
export function nextWaveIndexNames(currentNames: string[], desiredNames: string[]): string[] {
  const { toAdd, toRemove } = gsiDiff(currentNames, desiredNames);
  if (toAdd.length === 0 && toRemove.length === 0) {
    return [...currentNames];
  }
  if (toAdd.length > 0) {
    return [...currentNames, toAdd[0]];
  }
  const drop = toRemove[0];
  return currentNames.filter((name) => name !== drop);
}

export function selectGsisByName(
  currentGsis: CfnGlobalSecondaryIndex[],
  desiredGsis: CfnGlobalSecondaryIndex[],
  names: string[],
): CfnGlobalSecondaryIndex[] {
  const byName = new Map<string, CfnGlobalSecondaryIndex>();
  for (const gsi of currentGsis) {
    if (gsi.IndexName) {
      byName.set(gsi.IndexName, gsi);
    }
  }
  // Desired definitions win so newly added indexes use the synthesized schema.
  for (const gsi of desiredGsis) {
    if (gsi.IndexName) {
      byName.set(gsi.IndexName, gsi);
    }
  }
  return names.map((name) => {
    const gsi = byName.get(name);
    if (!gsi) {
      throw new Error(`GSI wave: no definition found for index "${name}"`);
    }
    return gsi;
  });
}

export function collectKeyAttributeNames(props: CfnTableProperties): Set<string> {
  const names = new Set<string>();
  const addFrom = (schema: CfnKeySchemaElement[] | undefined) => {
    for (const element of schema ?? []) {
      if (typeof element.AttributeName === 'string' && element.AttributeName.length > 0) {
        names.add(element.AttributeName);
      }
    }
  };
  addFrom(props.KeySchema);
  for (const lsi of props.LocalSecondaryIndexes ?? []) {
    addFrom(lsi.KeySchema);
  }
  for (const gsi of props.GlobalSecondaryIndexes ?? []) {
    addFrom(gsi.KeySchema);
  }
  return names;
}

/**
 * DynamoDB rejects AttributeDefinitions that are not used by the table key,
 * an LSI, or a GSI. Intermediate waves must drop attributes that only exist
 * to serve GSIs not yet being created.
 */
export function pruneAttributeDefinitions(props: CfnTableProperties): void {
  if (!Array.isArray(props.AttributeDefinitions)) {
    return;
  }
  const used = collectKeyAttributeNames(props);
  props.AttributeDefinitions = props.AttributeDefinitions.filter(
    (def) => typeof def.AttributeName === 'string' && used.has(def.AttributeName),
  );
}

export function listTableSnapshots(template: CfnTemplate): Array<TableGsiSnapshot & { resource: CfnTableResource }> {
  const snapshots: Array<TableGsiSnapshot & { resource: CfnTableResource }> = [];
  for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
    if (resource?.Type !== 'AWS::DynamoDB::Table') {
      continue;
    }
    const tableName = resource.Properties?.TableName;
    if (typeof tableName !== 'string' || tableName.length === 0) {
      continue;
    }
    const gsis = Array.isArray(resource.Properties?.GlobalSecondaryIndexes)
      ? resource.Properties.GlobalSecondaryIndexes
      : [];
    snapshots.push({ tableName, logicalId, gsis, resource });
  }
  return snapshots;
}

export function planTableWave(
  currentGsis: CfnGlobalSecondaryIndex[] | undefined,
  desiredGsis: CfnGlobalSecondaryIndex[],
): { gsis: CfnGlobalSecondaryIndex[]; change?: TableWaveChange; skip: boolean } {
  const currentNames = gsiIndexNames(currentGsis);
  const desiredNames = gsiIndexNames(desiredGsis);
  const mutations = gsiMutationCount(currentNames, desiredNames);

  // CREATE (no current snapshot) can include every GSI at once.
  // A single remaining mutation is left for the final unpatched deploy.
  if (currentGsis === undefined || mutations <= 1) {
    return { gsis: desiredGsis, skip: true };
  }

  const nextNames = nextWaveIndexNames(currentNames, desiredNames);
  const gsis = selectGsisByName(currentGsis, desiredGsis, nextNames);
  const { toAdd, toRemove } = gsiDiff(currentNames, nextNames);
  return {
    gsis,
    skip: false,
    change: {
      tableName: '',
      logicalId: '',
      from: currentNames,
      to: nextNames,
      add: toAdd[0],
      remove: toRemove[0],
    },
  };
}

export type DesiredTableSchema = {
  gsis: CfnGlobalSecondaryIndex[];
  attributeDefinitions: CfnAttributeDefinition[];
};

/**
 * After setting a new GSI list on an existing table, copy any AttributeDefinitions
 * the new keys need from the desired (cdk.out) schema. Current CFN templates
 * will not yet list PollStatus / WorkflowExternalId / etc.
 */
export function mergeUsedAttributeDefinitions(
  props: CfnTableProperties,
  sourceDefs: CfnAttributeDefinition[] | undefined,
): void {
  const used = collectKeyAttributeNames(props);
  const byName = new Map<string, CfnAttributeDefinition>();
  for (const def of props.AttributeDefinitions ?? []) {
    if (typeof def.AttributeName === 'string') {
      byName.set(def.AttributeName, def);
    }
  }
  for (const def of sourceDefs ?? []) {
    if (typeof def.AttributeName === 'string' && used.has(def.AttributeName)) {
      byName.set(def.AttributeName, def);
    }
  }
  props.AttributeDefinitions = [...byName.values()].filter(
    (def) => typeof def.AttributeName === 'string' && used.has(def.AttributeName),
  );
}

/**
 * Patch currently-deployed stack templates so each existing table takes at
 * most one GSI step toward `desiredByTable`. Other resources are left
 * untouched so an intermediate CloudFormation update does not ship new
 * Lambda code. Tables that only exist in cdk.out (creates) are ignored.
 */
export function applyWaveToCurrentTemplates(
  currentTemplates: Map<string, CfnTemplate>,
  desiredByTable: Map<string, DesiredTableSchema>,
): TableWaveChange[] {
  const changes: TableWaveChange[] = [];

  for (const template of currentTemplates.values()) {
    for (const snapshot of listTableSnapshots(template)) {
      const desired = desiredByTable.get(snapshot.tableName);
      if (!desired || !snapshot.resource.Properties) {
        continue;
      }
      const plan = planTableWave(snapshot.gsis, desired.gsis);
      if (plan.skip) {
        continue;
      }

      snapshot.resource.Properties.GlobalSecondaryIndexes = plan.gsis;
      mergeUsedAttributeDefinitions(snapshot.resource.Properties, desired.attributeDefinitions);

      const change = plan.change!;
      change.tableName = snapshot.tableName;
      change.logicalId = snapshot.logicalId;
      changes.push(change);
    }
  }

  return changes;
}

/**
 * Mutate synthesized (desired) templates so each existing table takes at most
 * one GSI step. Kept for tests and for comparing cdk.out against live GSIs.
 */
export function applyWaveToTemplates(
  desiredTemplates: Map<string, CfnTemplate>,
  currentByTableName: Map<string, CfnGlobalSecondaryIndex[]>,
): TableWaveChange[] {
  const changes: TableWaveChange[] = [];

  for (const template of desiredTemplates.values()) {
    for (const snapshot of listTableSnapshots(template)) {
      const currentGsis = currentByTableName.get(snapshot.tableName);
      const desiredGsis = snapshot.gsis;
      const plan = planTableWave(currentGsis, desiredGsis);
      if (plan.skip || !snapshot.resource.Properties) {
        continue;
      }

      snapshot.resource.Properties.GlobalSecondaryIndexes = plan.gsis;
      pruneAttributeDefinitions(snapshot.resource.Properties);

      const change = plan.change!;
      change.tableName = snapshot.tableName;
      change.logicalId = snapshot.logicalId;
      changes.push(change);
    }
  }

  return changes;
}

export function maxRemainingMutations(
  desiredByTableName: Map<string, string[]>,
  currentByTableName: Map<string, string[]>,
): number {
  let max = 0;
  for (const [tableName, desiredNames] of desiredByTableName) {
    const currentNames = currentByTableName.get(tableName);
    if (currentNames === undefined) {
      continue;
    }
    max = Math.max(max, gsiMutationCount(currentNames, desiredNames));
  }
  return max;
}

export function advanceCurrentNames(
  currentByTableName: Map<string, string[]>,
  changes: TableWaveChange[],
): Map<string, string[]> {
  const next = new Map(currentByTableName);
  for (const change of changes) {
    next.set(change.tableName, [...change.to]);
  }
  return next;
}

/**
 * After a wave is planned against a patched copy of cdk.out, copy that copy's
 * GSI lists back into the "current" map so the next wave starts from the
 * indexes CloudFormation will have just deployed.
 */
export function syncCurrentGsisFromTemplates(
  currentGsis: Map<string, CfnGlobalSecondaryIndex[]>,
  templates: Map<string, CfnTemplate>,
  changes: TableWaveChange[],
): void {
  const byTable = new Map<string, CfnGlobalSecondaryIndex[]>();
  for (const template of templates.values()) {
    for (const snapshot of listTableSnapshots(template)) {
      byTable.set(snapshot.tableName, snapshot.gsis);
    }
  }
  for (const change of changes) {
    const gsis = byTable.get(change.tableName);
    if (gsis) {
      currentGsis.set(change.tableName, gsis);
    }
  }
}

export function formatWaveChange(change: TableWaveChange): string {
  if (change.add) {
    return `${change.tableName}: add ${change.add} (${change.from.length} → ${change.to.length} GSIs)`;
  }
  if (change.remove) {
    return `${change.tableName}: remove ${change.remove} (${change.from.length} → ${change.to.length} GSIs)`;
  }
  return `${change.tableName}: ${change.from.join(',')} → ${change.to.join(',')}`;
}
