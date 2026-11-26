import { RunLimitEventsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-limit-events';
import {
  RunLimitEvent,
  RunLimitEventsResponse,
  RunLimitEventView,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { resolveRunCostsPeriods } from '@BE/services/easy-genomics/run-costs-report-service';
import { RunLimitEventService } from '@BE/services/easy-genomics/run-limit-event-service';
import { UserService } from '@BE/services/easy-genomics/user-service';

const BATCH_GET_ITEM_MAX_KEYS = 100;
const UNKNOWN_USER = 'Unknown user';

function displayNameOf(event: RunLimitEvent, user: User | undefined): string {
  const fullName = [user?.FirstName, user?.LastName].filter(Boolean).join(' ');
  return user?.PreferredName || fullName || event.UserEmail || UNKNOWN_USER;
}

export class RunLimitEventsReportService {
  private readonly runLimitEventService = new RunLimitEventService();
  private readonly userService = new UserService();

  /** `today` is passed in so the rolling periods are deterministic in tests. */
  public list = async (query: RunLimitEventsQuery, today: Date): Promise<RunLimitEventsResponse> => {
    const { Start, End } = resolveRunCostsPeriods(query, today).Period;
    const { events, truncated } = await this.runLimitEventService.listForPeriod(
      query.organizationId,
      Start,
      End,
      query.kind,
    );
    const usersById = await this.findUsers([...new Set(events.map((event) => event.UserId))]);

    const views: RunLimitEventView[] = events.map((event) => {
      const view: Partial<RunLimitEvent> = { ...event };
      delete view.ExpiresAt;
      return {
        ...(view as Omit<RunLimitEvent, 'ExpiresAt'>),
        UserDisplayName: displayNameOf(event, usersById.get(event.UserId)),
      };
    });
    return { Events: views, Truncated: truncated };
  };

  /** A user who has left or been deleted is simply absent, and their events fall back to the stored email. */
  private findUsers = async (userIds: string[]): Promise<Map<string, User>> => {
    const users = new Map<string, User>();
    for (let start = 0; start < userIds.length; start += BATCH_GET_ITEM_MAX_KEYS) {
      const batch = await this.userService.listUsers(userIds.slice(start, start + BATCH_GET_ITEM_MAX_KEYS));
      batch.forEach((user) => users.set(user.UserId, user));
    }
    return users;
  };
}
