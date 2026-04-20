import { App, CfnResource, Stack } from 'aws-cdk-lib';
import { checkStackResourceBudget } from '../../../src/infra/guardrails/stack-resource-budget';

/**
 * Helpers to synthesize a minimal Stack with a known number of trivial
 * resources so we can assert the budget check's pass/warn/fail behaviour
 * without depending on the real application stacks.
 */
function addDummyResources(stack: Stack, count: number) {
  for (let i = 0; i < count; i++) {
    new CfnResource(stack, `Dummy${i}`, {
      type: 'AWS::SQS::Queue',
      properties: {},
    });
  }
}

describe('checkStackResourceBudget', () => {
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.SKIP_STACK_RESOURCE_BUDGET;
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('passes silently when every stack is below the warn threshold', () => {
    const app = new App();
    const stack = new Stack(app, 'small-stack');
    addDummyResources(stack, 5);

    expect(() => checkStackResourceBudget(app, { warnThreshold: 50, failThreshold: 80 })).not.toThrow();
    // We still emit an info summary line per stack for CI visibility.
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns but does not throw when a stack crosses warn but not fail', () => {
    const app = new App();
    const stack = new Stack(app, 'warn-stack');
    addDummyResources(stack, 12);

    expect(() => checkStackResourceBudget(app, { warnThreshold: 10, failThreshold: 20 })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('warn-stack'));
  });

  it('throws when a stack crosses the fail threshold', () => {
    const app = new App();
    const stack = new Stack(app, 'fail-stack');
    addDummyResources(stack, 25);

    expect(() => checkStackResourceBudget(app, { warnThreshold: 10, failThreshold: 20 })).toThrow(
      /Stack resource budget exceeded/,
    );
  });

  it('honours SKIP_STACK_RESOURCE_BUDGET=1 to bypass in emergencies', () => {
    const app = new App();
    const stack = new Stack(app, 'skip-stack');
    addDummyResources(stack, 1000);

    process.env.SKIP_STACK_RESOURCE_BUDGET = '1';
    expect(() => checkStackResourceBudget(app, { warnThreshold: 10, failThreshold: 20 })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SKIP_STACK_RESOURCE_BUDGET is set'));
  });
});
