import type { LaboratoryWorkflowAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { isWorkflowAccessAllowed } from '../../../src/app/utils/laboratory-workflow-access-utils';

describe('laboratory-workflow-access-utils', () => {
  const labStrict = { EnableNewWorkflowsByDefault: false as const };
  const labDefaultOn = { EnableNewWorkflowsByDefault: true as const };

  function allowRow(workflowId: string): LaboratoryWorkflowAccess {
    return {
      LaboratoryId: 'lab-1',
      WorkflowKey: `HEALTH_OMICS#${workflowId}`,
      OrganizationId: 'org-1',
    };
  }

  function denyRow(workflowId: string): LaboratoryWorkflowAccess {
    return {
      LaboratoryId: 'lab-1',
      WorkflowKey: `HEALTH_OMICS#${workflowId}`,
      OrganizationId: 'org-1',
      Effect: 'DENY',
    };
  }

  describe('isWorkflowAccessAllowed', () => {
    it('strict mode: requires an ALLOW row', () => {
      expect(isWorkflowAccessAllowed(labStrict, [], 'HEALTH_OMICS', 'wf-1')).toBe(false);
      expect(isWorkflowAccessAllowed(labStrict, [allowRow('wf-1')], 'HEALTH_OMICS', 'wf-1')).toBe(true);
    });

    it('strict mode: DENY row does not grant access', () => {
      expect(isWorkflowAccessAllowed(labStrict, [denyRow('wf-1')], 'HEALTH_OMICS', 'wf-1')).toBe(false);
    });

    it('default-on: empty rows imply allow', () => {
      expect(isWorkflowAccessAllowed(labDefaultOn, [], 'HEALTH_OMICS', 'wf-new')).toBe(true);
    });

    it('default-on: explicit DENY blocks', () => {
      expect(isWorkflowAccessAllowed(labDefaultOn, [denyRow('wf-1')], 'HEALTH_OMICS', 'wf-1')).toBe(false);
    });

    it('default-on: ALLOW row still allowed when not denied', () => {
      expect(isWorkflowAccessAllowed(labDefaultOn, [allowRow('wf-1')], 'HEALTH_OMICS', 'wf-1')).toBe(true);
    });

    it('treats missing EnableNewWorkflowsByDefault as strict', () => {
      expect(isWorkflowAccessAllowed({}, [], 'HEALTH_OMICS', 'wf-1')).toBe(false);
      expect(isWorkflowAccessAllowed({}, [allowRow('wf-1')], 'HEALTH_OMICS', 'wf-1')).toBe(true);
    });
  });
});
