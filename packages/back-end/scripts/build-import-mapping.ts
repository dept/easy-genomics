/**
 * Build the `--resource-mapping` JSON file for `cdk import`.
 *
 * Purpose
 * -------
 * Phase 3.1 of the easy-genomics split-stack migration adopts the eight
 * existing easy-genomics DynamoDB tables into the new top-level
 * `*-easy-genomics-api-stack`. The CDK CLI's interactive `cdk import` flow
 * has two well-known footguns for this codebase:
 *
 *   1. It walks ALL importable resources in the stack (REST API, every API
 *      Gateway method/resource, every Lambda permission, etc.), prompting
 *      operators to either provide a physical ID or skip. Operators are
 *      faced with hundreds of irrelevant prompts and can easily either:
 *        a. Skip a table prompt by accident (pressing Enter through the
 *           noise), or
 *        b. Walk away thinking nothing was wrong because no table prompt
 *           appeared (this script's existence is a direct response to that
 *           failure mode encountered during the development-environment
 *           rehearsal).
 *
 *   2. The order of prompts is deterministic but not obvious — they're
 *      ordered by construct path, not resource type, so table prompts can
 *      land anywhere in the stream.
 *
 * This script resolves those problems by emitting a non-interactive
 * `--resource-mapping` JSON file. The file pre-declares the physical
 * `TableName` for each of the eight easy-genomics tables, so when
 * `cdk import` is run with `--resource-mapping <path>` it adopts those
 * tables directly and silently skips every other importable resource
 * (those will be created fresh in the subsequent `cdk deploy --all`).
 *
 * File format
 * -----------
 * The format expected by `cdk import` (see
 * `packages/back-end/node_modules/aws-cdk/lib/api/resource-import/importer.js`,
 * `loadResourceIdentifiers`) is a flat object keyed by CloudFormation
 * LogicalResourceId, with values describing the importable identifier:
 *
 *   {
 *     "<LogicalResourceId>": { "<PropertyName>": "<PhysicalIdentifier>" },
 *     ...
 *   }
 *
 * For DynamoDB, the importable property is `TableName` and the physical
 * identifier is the table's stable physical name (e.g.
 * `dev-demo-organization-table`). Logical IDs include CDK-generated hash
 * suffixes that vary by environment, so this script computes them per env
 * by reading the just-synthesized `cdk.out/<stack>.template.json`.
 *
 * Inputs
 * ------
 *  - `cdk.out/<namePrefix>-easy-genomics-api-stack.template.json`
 *      Produced by `pnpm cdk synth` (or any earlier step in the toolchain
 *      that writes the cloud assembly). The script does NOT run synth
 *      itself; it would slow down the migration runbook and the operator
 *      has already run synth at this point.
 *
 * Outputs
 * -------
 *  - Default: `cdk.out/<namePrefix>-easy-genomics-api-stack.import-mapping.json`
 *  - `--output <path>` to override (useful when staging the mapping file
 *    for review before running `cdk import`).
 *
 * Flags
 * -----
 *  - `--stack <name>`: override the synthesized stack name to read.
 *    Defaults to `${namePrefix}-easy-genomics-api-stack`.
 *  - `--cdk-out <path>`: override the cloud-assembly directory. Defaults
 *    to `<this package>/cdk.out`.
 *  - `--output <path>`: override the output file path.
 *  - `--print`: also dump the resulting JSON to stdout for review.
 *
 * Usage (typical)
 * ---------------
 *   pnpm cdk synth
 *   pnpm tsx scripts/build-import-mapping.ts
 *   pnpm cdk import "${NEW_STACK}" \\
 *     --resource-mapping "cdk.out/${NEW_STACK}.import-mapping.json" \\
 *     --require-approval any-change
 *
 * See `docs/EASY_GENOMICS_PROD_MIGRATION.md` Phase 3.1 for the full
 * runbook this script supports.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import { loadConfigurations } from '@easy-genomics/shared-lib/src/app/utils/configuration';

const EXPECTED_TABLE_SUFFIXES = [
  'organization-table',
  'laboratory-table',
  'user-table',
  'organization-user-table',
  'laboratory-user-table',
  'laboratory-run-table',
  'unique-reference-table',
  'laboratory-workflow-access-table',
  'laboratory-data-tagging-table',
] as const;

type DeployEnv = {
  envName: string;
  envType: string;
  namePrefix: string;
};

type CfnTemplateResource = {
  Type: string;
  Properties?: { TableName?: string; [k: string]: unknown };
  [k: string]: unknown;
};

type CfnTemplate = {
  Resources?: Record<string, CfnTemplateResource>;
};

type ImportMapping = Record<string, { TableName: string }>;

type Args = {
  stackName?: string;
  cdkOut?: string;
  output?: string;
  print: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { print: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--stack':
        args.stackName = argv[++i];
        break;
      case '--cdk-out':
        args.cdkOut = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--print':
        args.print = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`build-import-mapping: unknown argument "${arg}". Run with --help for usage.`);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: pnpm tsx scripts/build-import-mapping.ts [options]',
      '',
      'Builds the cdk import --resource-mapping JSON file for the eight',
      'easy-genomics DynamoDB tables in the new top-level api stack.',
      '',
      'Options:',
      '  --stack <name>       Stack name to read from cdk.out (defaults',
      '                       to "${namePrefix}-easy-genomics-api-stack").',
      '  --cdk-out <dir>      Cloud assembly directory (default: cdk.out).',
      '  --output <path>      Where to write the mapping JSON (default:',
      '                       cdk.out/${stack}.import-mapping.json).',
      '  --print              Also write the mapping JSON to stdout.',
      '  -h, --help           Show this help.',
      '',
    ].join('\n'),
  );
}

function resolveDeployEnv(): DeployEnv {
  // Mirror `packages/back-end/src/main.ts` and `preflight-deletion-protection.ts`
  // so this script targets exactly the deployment that `cdk synth` just
  // produced. We intentionally re-implement (rather than import) the resolve
  // logic so this script has no runtime dependency on AWS SDK clients.
  if (process.env.CI_CD === 'true') {
    const envName = process.env.ENV_NAME;
    const envType = process.env.ENV_TYPE;
    if (!envName || !envType) {
      throw new Error('build-import-mapping: CI_CD=true but ENV_NAME / ENV_TYPE are not set.');
    }
    return { envName, envType, namePrefix: `${envType}-${envName}` };
  }

  const configPath = join(__dirname, '../../../config/easy-genomics.yaml');
  const configurations: { [p: string]: ConfigurationSettings }[] = loadConfigurations(configPath);
  if (configurations.length !== 1) {
    throw new Error(
      `build-import-mapping: expected exactly one configuration collection in easy-genomics.yaml, found ${configurations.length}.`,
    );
  }
  const [configuration] = configurations;
  const envName = Object.keys(configuration)[0];
  const settings = Object.values(configuration)[0];
  const envType = settings['env-type'];
  if (!envName || !envType) {
    throw new Error('build-import-mapping: env-name / env-type missing from easy-genomics.yaml.');
  }
  return { envName, envType, namePrefix: `${envType}-${envName}` };
}

function readTemplate(templatePath: string): CfnTemplate {
  let raw: string;
  try {
    raw = readFileSync(templatePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `build-import-mapping: failed to read CloudFormation template at "${templatePath}". ` +
        `Did you run "pnpm cdk synth" first? Underlying error: ${(err as Error).message}`,
    );
  }
  try {
    return JSON.parse(raw) as CfnTemplate;
  } catch (err) {
    throw new Error(`build-import-mapping: template at "${templatePath}" is not valid JSON: ${(err as Error).message}`);
  }
}

function buildMapping(template: CfnTemplate, namePrefix: string): { mapping: ImportMapping; missing: string[] } {
  const mapping: ImportMapping = {};
  const seenTableNames = new Set<string>();

  for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
    if (resource.Type !== 'AWS::DynamoDB::Table') continue;
    const tableName = resource.Properties?.TableName;
    if (typeof tableName !== 'string' || tableName.length === 0) {
      // Defensive: a Table without a fixed `TableName` cannot be imported.
      // The easy-genomics tables all set a stable `tableName`, so reaching
      // this branch indicates either a future code change or a wrong stack.
      throw new Error(
        `build-import-mapping: resource "${logicalId}" is an AWS::DynamoDB::Table but has no fixed Properties.TableName. ` +
          'Fix the stack code so the table name is deterministic, or this resource is not safe to adopt via cdk import.',
      );
    }
    mapping[logicalId] = { TableName: tableName };
    seenTableNames.add(tableName);
  }

  const expected = EXPECTED_TABLE_SUFFIXES.map((suffix) => `${namePrefix}-${suffix}`);
  const missing = expected.filter((name) => !seenTableNames.has(name));

  return { mapping, missing };
}

function main(): void {
  const args = parseArgs(process.argv);
  const env = resolveDeployEnv();

  const stackName = args.stackName ?? `${env.namePrefix}-easy-genomics-api-stack`;
  const cdkOut = resolve(args.cdkOut ?? join(__dirname, '..', 'cdk.out'));
  const templatePath = join(cdkOut, `${stackName}.template.json`);
  const outputPath = resolve(args.output ?? join(cdkOut, `${stackName}.import-mapping.json`));

  console.error(`build-import-mapping: reading template from ${templatePath}`);
  const template = readTemplate(templatePath);

  const { mapping, missing } = buildMapping(template, env.namePrefix);
  const tableCount = Object.keys(mapping).length;

  if (missing.length > 0) {
    // Hard fail: an incomplete mapping would silently skip tables during
    // `cdk import`, leaving the operator in the exact "no table prompts
    // appeared" failure mode this script was written to prevent.
    throw new Error(
      [
        `build-import-mapping: synthesized template "${stackName}" is missing one or more expected easy-genomics tables.`,
        `Missing tables: ${missing.join(', ')}`,
        `Found ${tableCount} table(s) in the template; expected ${EXPECTED_TABLE_SUFFIXES.length}.`,
        '',
        'This usually means the stack code no longer creates these tables at the top-level api stack scope, or',
        'a different stack name was passed via --stack. Fix the source of truth before continuing the migration.',
      ].join('\n'),
    );
  }

  writeFileSync(outputPath, JSON.stringify(mapping, null, 2) + '\n', 'utf-8');

  console.error(`build-import-mapping: wrote ${tableCount} table mapping(s) to ${outputPath}`);
  for (const [logicalId, idProps] of Object.entries(mapping)) {
    console.error(`  ${logicalId}  =>  TableName=${idProps.TableName}`);
  }

  if (args.print) {
    process.stdout.write(JSON.stringify(mapping, null, 2) + '\n');
  }
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
