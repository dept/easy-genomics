import type { WorkflowListItem } from '@aws-sdk/client-omics';
import type { OmicsService } from '@BE/services/omics-service';

export type PrivateWorkflowListItem = WorkflowListItem & {
  tags?: Record<string, string>;
};

type TagLookupClient = Pick<OmicsService, 'listTagsForResource'>;

/**
 * ListWorkflows items do not include tags. Managers/admins need UserId to gate Delete,
 * so attach ListTagsForResource results. Failures leave tags unset (UI fails closed).
 */
export async function attachPrivateWorkflowTags(
  omicsService: TagLookupClient,
  items: WorkflowListItem[],
): Promise<PrivateWorkflowListItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (!item.arn) {
        return item;
      }
      try {
        const { tags } = await omicsService.listTagsForResource({ resourceArn: item.arn });
        if (!tags) {
          return item;
        }
        return { ...item, tags };
      } catch (error) {
        console.warn(`Failed to list tags for workflow ${item.arn}`, error);
        return item;
      }
    }),
  );
}
