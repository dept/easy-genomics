import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CfnTemplate } from './dynamodb-gsi-waves';

type CdkStackArtifact = {
  type?: string;
  properties?: {
    templateFile?: string;
    stackName?: string;
    directoryName?: string;
  };
};

type CdkManifest = {
  artifacts?: Record<string, CdkStackArtifact>;
};

/**
 * Collect every CloudFormation template in a CDK cloud assembly, including
 * nested-stack templates. Nested stacks are often *not* `aws:cloudformation:stack`
 * artifacts in `manifest.json` — CDK writes them as `*.nested.template.json`
 * assets and references them from the parent via `aws:asset:path`.
 */
export function collectCdkTemplatePaths(cdkOut: string): string[] {
  const paths = new Set<string>();
  const manifestPath = join(cdkOut, 'manifest.json');
  if (existsSync(manifestPath)) {
    collectFromManifest(cdkOut, readJson(manifestPath), paths);
  }
  walkTemplateFiles(cdkOut, paths);
  return [...paths].filter((p) => existsSync(p));
}

export function nestedAssetPathsFromTemplate(cdkOut: string, template: CfnTemplate): string[] {
  const paths: string[] = [];
  for (const resource of Object.values(template.Resources ?? {})) {
    if (resource?.Type !== 'AWS::CloudFormation::Stack') {
      continue;
    }
    const metadata = resource.Metadata;
    if (!metadata || typeof metadata !== 'object') {
      continue;
    }
    const assetPath = (metadata as Record<string, unknown>)['aws:asset:path'];
    if (typeof assetPath === 'string' && assetPath.length > 0) {
      paths.push(join(cdkOut, assetPath));
    }
  }
  return paths;
}

function collectFromManifest(root: string, manifest: CdkManifest, paths: Set<string>): void {
  for (const artifact of Object.values(manifest.artifacts ?? {})) {
    if (artifact.type === 'aws:cloudformation:stack' && artifact.properties?.templateFile) {
      paths.add(join(root, artifact.properties.templateFile));
    }
    if (artifact.type === 'cdk:cloud-assembly' && artifact.properties?.directoryName) {
      const nestedRoot = join(root, artifact.properties.directoryName);
      const nestedManifest = join(nestedRoot, 'manifest.json');
      if (existsSync(nestedManifest)) {
        collectFromManifest(nestedRoot, readJson(nestedManifest), paths);
      }
    }
  }
}

function walkTemplateFiles(dir: string, paths: Set<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') {
      continue;
    }
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTemplateFiles(full, paths);
      continue;
    }
    if (name.endsWith('.nested.template.json') || name.endsWith('.template.json')) {
      paths.add(full);
    }
  }
}

function readJson(path: string): CdkManifest {
  return JSON.parse(readFileSync(path, 'utf-8')) as CdkManifest;
}
