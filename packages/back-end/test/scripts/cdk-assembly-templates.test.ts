import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectCdkTemplatePaths, nestedAssetPathsFromTemplate } from '../../scripts/lib/cdk-assembly-templates';
import { CfnTemplate } from '../../scripts/lib/dynamodb-gsi-waves';
import { loadDesiredTableSchemas } from '../../scripts/lib/gsi-wave-orchestrator';

describe('collectCdkTemplatePaths', () => {
  it('includes top-level stack artifacts and nested.template.json files', () => {
    const cdkOut = mkdtempSync(join(tmpdir(), 'cdk-out-'));
    writeFileSync(
      join(cdkOut, 'manifest.json'),
      JSON.stringify({
        artifacts: {
          'pre-prod-quality-easy-genomics-api-stack': {
            type: 'aws:cloudformation:stack',
            properties: { templateFile: 'pre-prod-quality-easy-genomics-api-stack.template.json' },
          },
        },
      }),
    );
    writeFileSync(
      join(cdkOut, 'pre-prod-quality-easy-genomics-api-stack.template.json'),
      JSON.stringify({ Resources: {} }),
    );
    writeFileSync(join(cdkOut, 'auth.nested.template.json'), JSON.stringify({ Resources: {} }));

    const paths = collectCdkTemplatePaths(cdkOut).map((p) => p.replace(cdkOut, ''));
    expect(paths.some((p) => p.endsWith('easy-genomics-api-stack.template.json'))).toBe(true);
    expect(paths.some((p) => p.endsWith('auth.nested.template.json'))).toBe(true);
  });

  it('walks nested cloud-assembly directories from the manifest', () => {
    const cdkOut = mkdtempSync(join(tmpdir(), 'cdk-out-'));
    const nestedDir = join(cdkOut, 'nested-assembly');
    mkdirSync(nestedDir);
    writeFileSync(
      join(cdkOut, 'manifest.json'),
      JSON.stringify({
        artifacts: {
          nested: { type: 'cdk:cloud-assembly', properties: { directoryName: 'nested-assembly' } },
        },
      }),
    );
    writeFileSync(
      join(nestedDir, 'manifest.json'),
      JSON.stringify({
        artifacts: {
          auth: {
            type: 'aws:cloudformation:stack',
            properties: { templateFile: 'auth.template.json' },
          },
        },
      }),
    );
    writeFileSync(join(nestedDir, 'auth.template.json'), JSON.stringify({ Resources: {} }));

    const paths = collectCdkTemplatePaths(cdkOut);
    expect(paths.some((p) => p.endsWith(join('nested-assembly', 'auth.template.json')))).toBe(true);
  });
});

describe('nestedAssetPathsFromTemplate / loadDesiredTableSchemas', () => {
  it('discovers a table that only exists in a nested-stack asset', () => {
    const cdkOut = mkdtempSync(join(tmpdir(), 'cdk-out-'));
    const nestedName = 'qualityauthnestedstack.nested.template.json';
    const parent: CfnTemplate = {
      Resources: {
        AuthNested: {
          Type: 'AWS::CloudFormation::Stack',
          Metadata: { 'aws:asset:path': nestedName },
        },
      },
    };
    writeFileSync(join(cdkOut, 'manifest.json'), JSON.stringify({ artifacts: {} }));
    writeFileSync(join(cdkOut, 'parent.template.json'), JSON.stringify(parent));
    writeFileSync(
      join(cdkOut, nestedName),
      JSON.stringify({
        Resources: {
          AuthLog: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              TableName: 'pre-prod-quality-authentication-log-table',
              GlobalSecondaryIndexes: [{ IndexName: 'UserName_Index', KeySchema: [{ AttributeName: 'UserName' }] }],
            },
          },
        },
      }),
    );

    expect(nestedAssetPathsFromTemplate(cdkOut, parent)[0]).toContain(nestedName);

    const desired = loadDesiredTableSchemas(cdkOut);
    expect(desired.get('pre-prod-quality-authentication-log-table')?.gsis.map((g) => g.IndexName)).toEqual([
      'UserName_Index',
    ]);
  });
});
