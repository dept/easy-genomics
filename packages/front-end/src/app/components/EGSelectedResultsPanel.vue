<script setup lang="ts">
  import type {
    RunWorkflowKeyOutput,
    RunWorkflowKeyOutputsResponse,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { formatFileSize } from '@FE/utils/file-size';

  const props = defineProps<{
    labId: string;
    matches: RunWorkflowKeyOutputsResponse;
    workflowName?: string | null;
    workflowId?: string | null;
    canEdit?: boolean;
  }>();

  const emit = defineEmits<{
    markMore: [];
    rename: [];
  }>();

  const $router = useRouter();
  const {
    downloadingKey,
    isFolderZipInProgress,
    uniqueMatchedKeys,
    isExpanded,
    toggleExpanded,
    fileName,
    isRoleTruncated,
    isHtmlFile,
    isFolderPattern,
    downloadFile,
    openHtml,
    downloadRole: downloadRoleShared,
    zipAll: zipAllShared,
    uiStore,
  } = useRunKeyOutputMatches(
    () => props.labId,
    () => props.matches,
  );

  const downloadAllLabel = computed(() => {
    const sizeLabel = formatFileSize(props.matches.MatchedSizeBytes);
    return sizeLabel ? `Download all · ${sizeLabel}` : 'Download all';
  });

  function countLabel(role: RunWorkflowKeyOutput): string {
    if (role.Matches.length === 0) return 'No matches';
    if (isFolderPattern(role.Pattern)) {
      return `Folder · ${role.MatchCount.toLocaleString()} ${role.MatchCount === 1 ? 'file' : 'files'}`;
    }
    return role.MatchCount === 1 ? '1 file' : `${role.MatchCount.toLocaleString()} files`;
  }

  function roleSizeLabel(role: RunWorkflowKeyOutput): string {
    if (role.MatchCount === 1 && role.Matches[0]) {
      return formatFileSize(role.Matches[0].Size) || '—';
    }
    return formatFileSize(role.MatchSizeBytes) || '—';
  }

  function canExpand(role: RunWorkflowKeyOutput): boolean {
    return role.MatchCount > 1 && role.Matches.length > 0;
  }

  function downloadRole(role: RunWorkflowKeyOutput): void {
    downloadRoleShared(role, 'selected-results');
  }

  function zipAll(): void {
    zipAllShared(
      'selected-results',
      'all-selected-results',
      'Too many matching files to zip all selected results. Download a single result or individual files.',
    );
  }

  function goRename(): void {
    if (props.workflowId) {
      void $router.push({
        path: `/labs/${props.labId}/deliver-key-outputs/${encodeURIComponent(props.workflowId)}`,
        query: {
          tab: 'selected-results',
          ...(props.workflowName ? { workflowName: props.workflowName } : {}),
        },
      });
      return;
    }
    emit('rename');
  }
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <p class="text-muted max-w-2xl text-sm">
        Selected output files marked for {{ workflowName || 'this workflow' }}. They show on every run of this workflow.
        <button
          v-if="canEdit"
          type="button"
          class="text-primary hover:text-primary-dark font-medium hover:underline"
          @click="goRename"
        >
          Rename or remove
        </button>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <EGButton
          v-if="canEdit"
          :size="ButtonSizeEnum.enum.sm"
          :variant="ButtonVariantEnum.enum.secondary"
          icon="i-heroicons-flag"
          :icon-right="false"
          label="Mark more in All files"
          @click="emit('markMore')"
        />
        <EGButton
          v-if="uniqueMatchedKeys.length > 0"
          :size="ButtonSizeEnum.enum.sm"
          :variant="ButtonVariantEnum.enum.primary"
          icon="i-heroicons-arrow-down-tray"
          :icon-right="false"
          :label="downloadAllLabel"
          :loading="downloadingKey === 'all-selected-results'"
          :disabled="isFolderZipInProgress && downloadingKey !== 'all-selected-results'"
          @click="zipAll"
        />
      </div>
    </header>

    <div class="stroke-light overflow-hidden rounded-2xl border border-solid bg-white">
      <table class="w-full border-collapse text-left" aria-label="Selected results">
        <tbody>
          <template v-for="role in matches.KeyOutputs" :key="role.KeyOutputId">
            <tr class="border-stroke-light border-b last:border-b-0">
              <td class="w-full px-5 py-5 align-middle">
                <div class="flex min-w-0 items-center gap-4">
                  <div
                    class="bg-primary-muted text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    aria-hidden="true"
                  >
                    <UIcon
                      :name="isFolderPattern(role.Pattern) ? 'i-heroicons-folder' : 'i-heroicons-document-text'"
                      class="h-5 w-5"
                    />
                  </div>
                  <div class="min-w-0">
                    <p class="text-base font-semibold text-black">{{ role.Label }}</p>
                    <p v-if="role.Description" class="text-muted mt-0.5 text-sm">{{ role.Description }}</p>
                    <p class="text-muted mt-1 break-all font-mono text-xs">{{ role.Pattern }}</p>
                  </div>
                </div>
              </td>

              <td class="whitespace-nowrap px-3 py-5 align-middle">
                <button
                  v-if="canExpand(role)"
                  type="button"
                  class="text-muted hover:text-text-body inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium"
                  :aria-expanded="isExpanded(role.KeyOutputId)"
                  @click="toggleExpanded(role.KeyOutputId)"
                >
                  {{ countLabel(role) }}
                  <UIcon
                    :name="isExpanded(role.KeyOutputId) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
                <span v-else class="text-muted text-sm font-medium">{{ countLabel(role) }}</span>
              </td>

              <td class="whitespace-nowrap px-3 py-5 text-right align-middle">
                <span class="text-muted text-sm tabular-nums">{{ roleSizeLabel(role) }}</span>
              </td>

              <td class="whitespace-nowrap py-5 pl-2 pr-5 text-right align-middle">
                <div class="inline-flex items-center gap-1">
                  <button
                    v-if="role.MatchCount === 1 && role.Matches[0] && isHtmlFile(role.Matches[0])"
                    type="button"
                    class="text-muted hover:bg-background-light-grey hover:text-text-body inline-flex h-9 w-9 items-center justify-center rounded-md"
                    :aria-label="`Open ${role.Label}`"
                    :disabled="uiStore.isRequestPending(`openKeyOutput-${role.Matches[0].Key}`)"
                    @click="openHtml(role.Matches[0])"
                  >
                    <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="text-muted hover:bg-background-light-grey hover:text-text-body inline-flex h-9 w-9 items-center justify-center rounded-md disabled:opacity-50"
                    :aria-label="`Download ${role.Label}`"
                    :disabled="
                      role.Matches.length === 0 ||
                      downloadingKey === role.KeyOutputId ||
                      (role.Matches[0] && downloadingKey === role.Matches[0].Key) ||
                      (role.MatchCount > 1 && isFolderZipInProgress)
                    "
                    @click="downloadRole(role)"
                  >
                    <UIcon
                      :name="
                        downloadingKey === role.KeyOutputId ||
                        (role.Matches[0] && downloadingKey === role.Matches[0].Key)
                          ? 'i-heroicons-arrow-path'
                          : 'i-heroicons-arrow-down-tray'
                      "
                      class="h-5 w-5"
                      :class="{
                        'animate-spin':
                          downloadingKey === role.KeyOutputId ||
                          (role.Matches[0] && downloadingKey === role.Matches[0].Key),
                      }"
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="isExpanded(role.KeyOutputId) && canExpand(role)">
              <td colspan="4" class="bg-background-light-grey/40 px-5 py-3">
                <ul class="ml-14 list-none space-y-2" role="list">
                  <li
                    v-for="file in role.Matches"
                    :key="file.Key"
                    class="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <div class="min-w-0">
                      <p class="truncate text-black">{{ fileName(file) }}</p>
                      <p class="text-muted truncate font-mono text-xs">{{ file.RelativePath }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-muted text-sm tabular-nums">{{ formatFileSize(file.Size) }}</span>
                      <button
                        v-if="isHtmlFile(file)"
                        type="button"
                        class="text-muted hover:bg-background-light-grey hover:text-text-body inline-flex h-9 w-9 items-center justify-center rounded-md"
                        :aria-label="`Open ${fileName(file)}`"
                        :disabled="uiStore.isRequestPending(`openKeyOutput-${file.Key}`)"
                        @click="openHtml(file)"
                      >
                        <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-5 w-5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        class="text-muted hover:bg-background-light-grey hover:text-text-body inline-flex h-9 w-9 items-center justify-center rounded-md"
                        :aria-label="`Download ${fileName(file)}`"
                        :disabled="downloadingKey === file.Key"
                        @click="downloadFile(file)"
                      >
                        <UIcon
                          :name="downloadingKey === file.Key ? 'i-heroicons-arrow-path' : 'i-heroicons-arrow-down-tray'"
                          class="h-5 w-5"
                          :class="{ 'animate-spin': downloadingKey === file.Key }"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </li>
                  <li v-if="isRoleTruncated(role)" class="text-muted text-xs">
                    Showing the first {{ role.Matches.length.toLocaleString() }} matches. Narrow the pattern to see the
                    rest.
                  </li>
                </ul>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
