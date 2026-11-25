import type {
  Laboratory,
  LaboratoryWorkflowCostRow,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { AMOUNT_NOT_POSITIVE } from '../../../src/app/utils/usage-limits-form';
import {
  draftToWorkflowRequest,
  isWorkflowDraftChanged,
  labAmountPlaceholder,
  typicalCostText,
  typicalCostTooltip,
  workflowDraftError,
  workflowLimitsToDraft,
  workflowsWithLimitsText,
} from '../../../src/app/utils/workflow-limits-form';

const row: LaboratoryWorkflowCostRow = {
  Platform: 'HEALTH_OMICS',
  WorkflowId: '5734690',
  WorkflowName: 'nf-core/rnaseq',
  LatestVersionName: '3.14',
  CountedRunCount: 5,
  TypicalRunCostUsd: 140,
};

const labWithWorkflowLimits = (count: number): Laboratory =>
  ({
    LaboratoryId: 'lab-1',
    WorkflowRunLimits: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`HEALTH_OMICS#${index}`, { WorkflowName: `wf-${index}` }]),
    ),
  }) as unknown as Laboratory;

describe('workflowDraftError', () => {
  it("rejects a blank-block draft that would warn above the lab's block amount, with the server's message", () => {
    expect(
      workflowDraftError(
        { CostWarnAboveUsd: '500', CostBlockAboveUsd: '' },
        { CostBlockAboveUsd: 400 },
        'nf-core/rnaseq',
      ),
    ).toBe(
      "For nf-core/rnaseq, block above (US$400, the lab's) must be higher than warn above (US$500, the workflow's) for estimated cost per run.",
    );
  });

  it("accepts amounts above the lab's", () => {
    expect(
      workflowDraftError(
        { CostWarnAboveUsd: '300', CostBlockAboveUsd: '800' },
        { CostWarnAboveUsd: 150, CostBlockAboveUsd: 400 },
        'x',
      ),
    ).toBeNull();
  });

  it('rejects zero and negative amounts', () => {
    expect(workflowDraftError({ CostWarnAboveUsd: '0', CostBlockAboveUsd: '' }, undefined, 'x')).toBe(
      AMOUNT_NOT_POSITIVE,
    );
    expect(workflowDraftError({ CostWarnAboveUsd: '', CostBlockAboveUsd: '-5' }, undefined, 'x')).toBe(
      AMOUNT_NOT_POSITIVE,
    );
  });

  it('rejects a value that is not a number', () => {
    expect(workflowDraftError({ CostWarnAboveUsd: 'abc', CostBlockAboveUsd: '' }, undefined, 'x')).toBe(
      AMOUNT_NOT_POSITIVE,
    );
  });
});

describe('draftToWorkflowRequest', () => {
  it('sends no amounts when both are blank, which clears the workflow', () => {
    expect(draftToWorkflowRequest(row, { CostWarnAboveUsd: ' ', CostBlockAboveUsd: '' })).toEqual({
      Platform: 'HEALTH_OMICS',
      WorkflowId: '5734690',
      WorkflowName: 'nf-core/rnaseq',
    });
  });

  it('sends the amounts that are filled in', () => {
    expect(draftToWorkflowRequest(row, { CostWarnAboveUsd: '', CostBlockAboveUsd: ' 200000 ' })).toEqual({
      Platform: 'HEALTH_OMICS',
      WorkflowId: '5734690',
      WorkflowName: 'nf-core/rnaseq',
      CostBlockAboveUsd: 200000,
    });
  });
});

describe('typicalCostText', () => {
  it('shows the typical cost or says there are not enough runs, never US$0', () => {
    expect(typicalCostText(row)).toBe('Typical run ≈ US$140');
    expect(typicalCostText({ ...row, TypicalRunCostUsd: undefined, CountedRunCount: 2 })).toBe('Not enough runs yet');
    expect(typicalCostText({ ...row, TypicalRunCostUsd: 22.5 })).toBe('Typical run ≈ US$22.50');
  });
});

describe('typicalCostTooltip', () => {
  it('explains the figure, and when a limit starts to apply', () => {
    expect(typicalCostTooltip(row)).toBe(
      "Median of the last 5 successful runs of this workflow in this lab. A run's estimate grows with its sample count, so a large run can cost well above this.",
    );
    expect(typicalCostTooltip({ ...row, TypicalRunCostUsd: undefined, CountedRunCount: 1 })).toBe(
      'This workflow has 1 successful run in this lab. A cost limit applies once it has 3.',
    );
    expect(typicalCostTooltip({ ...row, TypicalRunCostUsd: undefined, CountedRunCount: 2 })).toBe(
      'This workflow has 2 successful runs in this lab. A cost limit applies once it has 3.',
    );
  });
});

describe('labAmountPlaceholder', () => {
  it("shows the lab's amount as the placeholder", () => {
    expect(labAmountPlaceholder(150)).toBe("Lab's US$150");
    expect(labAmountPlaceholder(undefined)).toBe("Lab's: not set");
  });
});

describe('workflowsWithLimitsText', () => {
  it('counts workflows with their own limits', () => {
    expect(workflowsWithLimitsText(labWithWorkflowLimits(0))).toBeNull();
    expect(workflowsWithLimitsText({ LaboratoryId: 'lab-1' } as Laboratory)).toBeNull();
    expect(workflowsWithLimitsText(labWithWorkflowLimits(1))).toBe('1 workflow with its own limits');
    expect(workflowsWithLimitsText(labWithWorkflowLimits(2))).toBe('2 workflows with their own limits');
  });
});

describe('isWorkflowDraftChanged', () => {
  it('knows when a draft differs from the saved amounts', () => {
    const saved = { ...row, CostWarnAboveUsd: 150 };
    expect(isWorkflowDraftChanged(saved, workflowLimitsToDraft(saved))).toBe(false);
    expect(isWorkflowDraftChanged(saved, { CostWarnAboveUsd: ' 150 ', CostBlockAboveUsd: '' })).toBe(false);
    expect(isWorkflowDraftChanged(row, { CostWarnAboveUsd: '300', CostBlockAboveUsd: '' })).toBe(true);
  });
});

describe('workflowLimitsToDraft', () => {
  it("holds the workflow's own amounts, blank when unset", () => {
    expect(workflowLimitsToDraft({ ...row, CostBlockAboveUsd: 400 })).toEqual({
      CostWarnAboveUsd: '',
      CostBlockAboveUsd: '400',
    });
  });
});
