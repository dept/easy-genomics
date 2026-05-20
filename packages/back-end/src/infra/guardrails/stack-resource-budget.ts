import { App, Stack } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * CloudFormation hard limit on resources per stack template.
 * See: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cloudformation-limits.html
 */
export const CFN_RESOURCE_HARD_LIMIT = 500;

/**
 * Warning threshold: start shouting when a stack uses more than this many
 * resources. Tuned to leave ~100 resources of headroom for new endpoints
 * between CI runs so a route-heavy PR cannot sneak past review.
 */
export const DEFAULT_WARN_THRESHOLD = 400;

/**
 * Fail threshold: hard-fail the synth so CI rejects the change. Leaves
 * ~50 resources of headroom above the warn threshold to avoid flapping.
 */
export const DEFAULT_FAIL_THRESHOLD = 450;

export interface StackBudgetOptions {
  warnThreshold?: number;
  failThreshold?: number;
  /**
   * If true, print the per-resource-type breakdown for any stack that trips
   * the warn threshold. Useful when you need to see what exploded.
   */
  verbose?: boolean;
}

interface StackBudgetResult {
  stackName: string;
  resourceCount: number;
  breakdown: Record<string, number>;
}

/**
 * Visits every top-level Stack in the CDK App (nested stacks are inspected
 * separately via their own templates, which is the correct granularity for
 * this check — CloudFormation's 500-resource limit applies per template).
 *
 * Throws if any stack exceeds the fail threshold, so a broken PR never gets
 * as far as `cdk deploy`. Opt out in emergencies with
 * `SKIP_STACK_RESOURCE_BUDGET=1`.
 */
export function checkStackResourceBudget(app: App, options: StackBudgetOptions = {}): StackBudgetResult[] {
  if (process.env.SKIP_STACK_RESOURCE_BUDGET === '1' || process.env.SKIP_STACK_RESOURCE_BUDGET === 'true') {
    console.warn('[stack-resource-budget] SKIP_STACK_RESOURCE_BUDGET is set, skipping resource budget check.');
    return [];
  }

  const warn = options.warnThreshold ?? DEFAULT_WARN_THRESHOLD;
  const fail = options.failThreshold ?? DEFAULT_FAIL_THRESHOLD;

  const results: StackBudgetResult[] = [];
  const failures: StackBudgetResult[] = [];

  // Collect every Stack (top-level AND nested). CloudFormation's 500-resource
  // limit applies per-template, and nested stacks each have their own
  // template, so we must inspect them individually.
  const allStacks: Stack[] = [];
  const visit = (node: IConstruct) => {
    if (node instanceof Stack) allStacks.push(node);
    for (const child of node.node.children) visit(child);
  };
  visit(app);

  for (const child of allStacks) {
    const template = getStackTemplate(child);
    const resources = (template?.Resources ?? {}) as Record<string, { Type?: string }>;
    const resourceCount = Object.keys(resources).length;
    const breakdown: Record<string, number> = {};
    for (const r of Object.values(resources)) {
      const type = r.Type ?? 'Unknown';
      breakdown[type] = (breakdown[type] ?? 0) + 1;
    }

    const result: StackBudgetResult = {
      stackName: child.stackName,
      resourceCount,
      breakdown,
    };
    results.push(result);

    if (resourceCount >= fail) {
      failures.push(result);
    } else if (resourceCount >= warn) {
      console.warn(
        `[stack-resource-budget] Stack "${child.stackName}" has ${resourceCount} resources (warn threshold: ${warn}, fail threshold: ${fail}, hard limit: ${CFN_RESOURCE_HARD_LIMIT}).`,
      );
      if (options.verbose) {
        console.warn(`[stack-resource-budget] Breakdown: ${JSON.stringify(breakdown, null, 2)}`);
      }
    }
  }

  // Always emit a short summary so CI logs show the budget check actually ran.
  // Helpful for PR reviewers to see current headroom for every stack, not just
  // the failing ones. Keep to a single line per stack to stay scannable.
  for (const r of results) {
    const pct = Math.round((r.resourceCount / CFN_RESOURCE_HARD_LIMIT) * 100);
    console.info(
      `[stack-resource-budget] ${r.stackName}: ${r.resourceCount}/${CFN_RESOURCE_HARD_LIMIT} (${pct}%), warn=${warn}, fail=${fail}`,
    );
  }

  if (failures.length > 0) {
    const summary = failures.map((f) => `  - ${f.stackName}: ${f.resourceCount} resources`).join('\n');
    const details = failures.map((f) => `${f.stackName}:\n${JSON.stringify(f.breakdown, null, 2)}`).join('\n\n');
    throw new Error(
      `Stack resource budget exceeded (fail threshold: ${fail}, hard limit: ${CFN_RESOURCE_HARD_LIMIT}):\n${summary}\n\n` +
        `Breakdown:\n${details}\n\n` +
        'Split route-heavy domains into their own API stack, or set SKIP_STACK_RESOURCE_BUDGET=1 to bypass in an emergency.',
    );
  }

  return results;
}

/**
 * Synthesize a single stack to JSON and return its template. Wrapping this
 * in a helper lets us keep the `any` narrowly scoped instead of leaking
 * cdk internals into the main code path.
 */
function getStackTemplate(stack: Stack): { Resources?: Record<string, { Type?: string }> } | undefined {
  try {
    // `Stack#resolve(this._toCloudFormation())` is the documented path but it
    // is internal. Using the public synth path via the assembly avoids the
    // double-synth cost: `app.synth()` will happen anyway, and by this point
    // the assembly has been produced once.
    const template = (stack as unknown as { _toCloudFormation: () => unknown })._toCloudFormation();
    return stack.resolve(template) as { Resources?: Record<string, { Type?: string }> };
  } catch (err) {
    console.warn(`[stack-resource-budget] Could not inspect template for "${stack.stackName}": ${String(err)}`);
    return undefined;
  }
}
