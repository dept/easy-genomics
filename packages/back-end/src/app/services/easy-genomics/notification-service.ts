import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '@BE/services/easy-genomics/laboratory-user-service';
import { UserService } from '@BE/services/easy-genomics/user-service';
import { SesService } from '@BE/services/ses-service';

const laboratoryService = new LaboratoryService();
const laboratoryUserService = new LaboratoryUserService();
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

    const recipients = new Map<string, User>();

    const owner: User = await userService.get(run.UserId);
    if (owner.NotifyOnOwnRuns && passesEventFilter(owner, run.Status)) {
      recipients.set(owner.UserId, owner);
    }

    const labMembers: LaboratoryUser[] = await laboratoryUserService.queryByLaboratoryId(run.LaboratoryId);
    const optedInMemberIds = labMembers.filter((m) => m.NotifyOnLabRuns).map((m) => m.UserId);
    if (optedInMemberIds.length > 0) {
      const members: User[] = await userService.listUsers(optedInMemberIds);
      for (const member of members) {
        if (!recipients.has(member.UserId) && passesEventFilter(member, run.Status)) {
          recipients.set(member.UserId, member);
        }
      }
    }

    let sent = 0;
    for (const recipient of recipients.values()) {
      try {
        await sesService.sendRunCompletionEmail(recipient.Email, {
          runName: run.RunName,
          status: run.Status,
          laboratoryName: laboratory.Name,
          workflowName: run.WorkflowName,
          runDurationSeconds: run.RunDurationSeconds,
          runId: run.RunId,
          laboratoryId: run.LaboratoryId,
        });
        sent++;
      } catch (err) {
        console.error(`notifyRunCompletion: failed to email ${recipient.Email} for RunId=${run.RunId}:`, err);
      }
    }
    return { sent };
  }
}
