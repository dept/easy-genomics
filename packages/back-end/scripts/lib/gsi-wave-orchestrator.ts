import { existsSync, readFileSync } from 'fs';
import { collectCdkTemplatePaths, nestedAssetPathsFromTemplate } from './cdk-assembly-templates';
import {
  advanceCurrentNames,
  applyWaveToCurrentTemplates,
  CfnTemplate,
  DesiredTableSchema,
  formatWaveChange,
  gsiIndexNames,
  listTableSnapshots,
  maxRemainingMutations,
  TableWaveChange,
} from './dynamodb-gsi-waves';

export const MAX_GSI_WAVES = 20;

export type GsiWaveDeps = {
  loadCurrentStacks: () => Promise<Map<string, CfnTemplate>>;
  /**
   * Apply the patched *currently deployed* template for one stack. Must not
   * deploy cdk.out (that would ship new Lambda code while later GSIs are still
   * missing). Throws on failure; the orchestrator then does not advance state.
   */
  updateStack: (stackName: string, template: CfnTemplate) => Promise<void>;
  log?: (message: string) => void;
};

export type GsiWaveResult = {
  wavesRun: number;
  remaining: number;
  skippedReason?: string;
  changes: TableWaveChange[][];
};

function readJsonTemplate(path: string): CfnTemplate {
  return JSON.parse(readFileSync(path, 'utf-8')) as CfnTemplate;
}

export function loadDesiredTableSchemas(cdkOut: string): Map<string, DesiredTableSchema> {
  const desired = new Map<string, DesiredTableSchema>();
  const pending = [...collectCdkTemplatePaths(cdkOut)];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path) || !existsSync(path)) {
      continue;
    }
    seen.add(path);
    const template = readJsonTemplate(path);
    for (const snapshot of listTableSnapshots(template)) {
      desired.set(snapshot.tableName, {
        gsis: snapshot.gsis,
        attributeDefinitions: snapshot.resource.Properties?.AttributeDefinitions ?? [],
      });
    }
    pending.push(...nestedAssetPathsFromTemplate(cdkOut, template));
  }

  return desired;
}

export function desiredNamesByTable(desired: Map<string, DesiredTableSchema>): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const [tableName, schema] of desired) {
    names.set(tableName, gsiIndexNames(schema.gsis));
  }
  return names;
}

export function currentNamesFromStacks(stacks: Map<string, CfnTemplate>): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const template of stacks.values()) {
    for (const snapshot of listTableSnapshots(template)) {
      names.set(snapshot.tableName, gsiIndexNames(snapshot.gsis));
    }
  }
  return names;
}

function cloneStacks(stacks: Map<string, CfnTemplate>): Map<string, CfnTemplate> {
  const clone = new Map<string, CfnTemplate>();
  for (const [name, template] of stacks) {
    clone.set(name, JSON.parse(JSON.stringify(template)) as CfnTemplate);
  }
  return clone;
}

export async function runGsiWaves(options: {
  cdkOut: string;
  dryRun: boolean;
  deps: GsiWaveDeps;
  maxWaves?: number;
}): Promise<GsiWaveResult> {
  const log = options.deps.log ?? ((message: string) => console.log(message));
  const maxWaves = options.maxWaves ?? MAX_GSI_WAVES;
  const desired = loadDesiredTableSchemas(options.cdkOut);
  const desiredNames = desiredNamesByTable(desired);

  if (desired.size === 0) {
    log('GSI waves: no DynamoDB tables in cdk.out; nothing to do.');
    return { wavesRun: 0, remaining: 0, skippedReason: 'no-desired-tables', changes: [] };
  }

  const currentStacks = await options.deps.loadCurrentStacks();
  let currentNames = currentNamesFromStacks(currentStacks);

  if (currentStacks.size === 0) {
    log('GSI waves: no deployed DynamoDB tables found (fresh environment); skipping intermediate waves.');
    return { wavesRun: 0, remaining: 0, skippedReason: 'fresh-environment', changes: [] };
  }

  let remaining = maxRemainingMutations(desiredNames, currentNames);
  if (remaining <= 1) {
    log(
      remaining === 0
        ? 'GSI waves: deployed index sets already match cdk.out; skipping intermediate waves.'
        : 'GSI waves: at most one GSI mutation per table remains; the final cdk deploy can apply it.',
    );
    return {
      wavesRun: 0,
      remaining,
      skippedReason: remaining === 0 ? 'already-matched' : 'single-mutation',
      changes: [],
    };
  }

  log(
    `GSI waves: ${remaining} GSI mutation(s) needed on at least one existing table. ` +
      'Intermediate updates patch the currently deployed templates only (no new Lambda code).',
  );

  const totalIntermediate = remaining - 1;
  const allChanges: TableWaveChange[][] = [];
  let wave = 0;

  while (remaining > 1) {
    wave += 1;
    if (wave > maxWaves) {
      throw new Error(`GSI waves: exceeded ${maxWaves} intermediate updates; aborting to avoid a loop.`);
    }

    const patched = cloneStacks(currentStacks);
    const changes = applyWaveToCurrentTemplates(patched, desired);
    if (changes.length === 0) {
      log('GSI waves: planner produced no patches; stopping.');
      break;
    }

    log(`GSI waves: intermediate update ${wave}/${totalIntermediate}`);
    for (const change of changes) {
      log(`  - ${formatWaveChange(change)}`);
    }

    if (!options.dryRun) {
      const stacksToUpdate = new Set<string>();
      for (const [stackName, template] of patched) {
        if (JSON.stringify(template) !== JSON.stringify(currentStacks.get(stackName))) {
          stacksToUpdate.add(stackName);
        }
      }
      for (const stackName of stacksToUpdate) {
        await options.deps.updateStack(stackName, patched.get(stackName)!);
      }
    }

    for (const [stackName, template] of patched) {
      currentStacks.set(stackName, template);
    }
    currentNames = advanceCurrentNames(currentNames, changes);
    allChanges.push(changes);
    remaining = maxRemainingMutations(desiredNames, currentNames);
  }

  if (options.dryRun) {
    log(
      remaining <= 1
        ? 'GSI waves: dry-run complete. The final unpatched cdk deploy would finish the remaining index(es).'
        : `GSI waves: dry-run stopped with ${remaining} mutation(s) still pending.`,
    );
  } else {
    log('GSI waves: intermediate updates complete. The final cdk deploy will apply the remaining index (if any).');
  }

  return { wavesRun: allChanges.length, remaining, changes: allChanges };
}
