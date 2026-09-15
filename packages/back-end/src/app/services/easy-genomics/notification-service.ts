import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { OrganizationService } from '@BE/services/easy-genomics/organization-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { SesService } from '@BE/services/ses-service';

const laboratoryService = new LaboratoryService();
const laboratoryUserService = new LaboratoryUserService();
const organizationService = new OrganizationService();
const userService = new UserService();
const sesService = new SesService({
  accountId: process.env.ACCOUNT_ID!,
  region: process.env.REGION!,
  domainName: process.env.DOMAIN_NAME!,
  envType: process.env.ENV_TYPE!,
  envName: process.env.ENV_NAME!,
});

function passesEventFilter(user: User, status: string): boolean {
  if (user.NotificationEventFilter === 'failures_only') {
    return status.toUpperCase() === 'FAILED';
  }
  if (user.NotificationEventFilter === 'successes_only') {
    return status.toUpperCase() !== 'FAILED';
  }
  return true;
}

export class NotificationService {
  /**
   * Resolves who should be emailed for this run's terminal state (owner if opted in, plus lab
   * members who opted into all lab runs) and sends one templated email per recipient. A single
   * recipient's send failure is caught and logged, not fatal to the batch — see docstring on
   * the caller (`process-notify-laboratory-run-completion.lambda.ts`) for the DLQ rationale.
   */
  public async notifyRunCompletion(run: LaboratoryRun): Promise<{ sent: number }> {
    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(run.LaboratoryId);
    if (laboratory.NotificationsEnabled === false) {
      console.log(`notifyRunCompletion: NotificationsEnabled=false for LaboratoryId=${run.LaboratoryId}, skipping`);
      return { sent: 0 };
    }

    const organization = await organizationService.get(laboratory.OrganizationId);

    const recipientEmails = new Set<string>();

    const owner: User = await userService.get(run.UserId);
    if (owner.NotifyOnOwnRuns && passesEventFilter(owner, run.Status)) {
      recipientEmails.add(owner.Email);
    }

    const labMembers: LaboratoryUser[] = await laboratoryUserService.queryByLaboratoryId(run.LaboratoryId);
    const optedInMembers = labMembers.filter((m) => m.NotifyOnLabRuns);
    if (optedInMembers.length > 0) {
      const members: User[] = await userService.listUsers(optedInMembers.map((m) => m.UserId));
      const membersById = new Map(members.map((member) => [member.UserId, member]));
      for (const labMember of optedInMembers) {
        const member = membersById.get(labMember.UserId);
        if (!member || !passesEventFilter(member, run.Status)) continue;
        recipientEmails.add(member.Email);
        // CC addresses ride on the owning member's own opt-in and event filter — they're
        // not independently configurable, so no separate filter check applies to them.
        for (const ccEmail of labMember.NotifyOnLabRunsAdditionalEmails ?? []) {
          recipientEmails.add(ccEmail);
        }
      }
    }

    let sent = 0;
    for (const email of recipientEmails) {
      try {
        await sesService.sendRunCompletionEmail(email, {
          runName: run.RunName,
          status: run.Status,
          laboratoryName: laboratory.Name,
          workflowName: run.WorkflowName,
          runDurationSeconds: run.RunDurationSeconds,
          runId: run.RunId,
          laboratoryId: run.LaboratoryId,
          logoUrl: organization.EmailBrandingLogoUrl,
        });
        sent++;
      } catch (err) {
        console.error(`notifyRunCompletion: failed to email ${email} for RunId=${run.RunId}:`, err);
      }
    }
    return { sent };
  }
}
