<script setup lang="ts">
  /**
   * Hover-triggered analysis history panel for a single file in the data collections explorer.
   * Card view: dot (+ count chip when N>1) only. Table view: dot + status text. Panel lists runs;
   * left opens run detail; right zone selects input files for that run.
   */
  import { format } from 'date-fns';
  import type { LaboratoryRunUsageSummary } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/data-collections';

  const props = defineProps<{
    labId: string;
    fileKey: string;
    fileName: string;
    /** Batch display name (resolved tag name) or empty when the file is unbatched. */
    batchName?: string;
    /** Standard tag names (excludes batch + workflow tags) — rendered in the subtitle. */
    standardTagNames: string[];
    /** Per-run usage history, sorted newest first by `RunCreatedAt`. */
    runUsages: LaboratoryRunUsageSummary[];
    /** Card = dot (+ count when N>1) only; table = dot + status label. */
    variant?: 'card' | 'table';
  }>();

  const emit = defineEmits<{
    selectRunFiles: [payload: { runId: string; inputFileKeys: string[] }];
    /** Mirrors `UPopover` — true while the analysis panel is open (hover or controlled). */
    'update:open': [open: boolean];
  }>();

  const STATUS_COLOR_NOT_ANALYZED = '#EF9F27';
  const STATUS_COLOR_ANALYZED = '#2DB48F';
  const STATUS_COLOR_MULTIPLE = '#5B4FD4';

  const runCount = computed(() => props.runUsages.length);

  const statusDescriptor = computed(() => {
    if (runCount.value === 0) {
      return { label: 'Not yet analyzed', color: STATUS_COLOR_NOT_ANALYZED };
    }
    if (runCount.value === 1) {
      return { label: 'Analyzed', color: STATUS_COLOR_ANALYZED };
    }
    return { label: `Analyzed ${runCount.value}x`, color: STATUS_COLOR_MULTIPLE };
  });

  const isCard = computed(() => props.variant === 'card');

  const triggerAriaLabel = computed(() => {
    if (isCard.value) {
      if (runCount.value === 0) return 'Not yet analyzed — show analysis history';
      if (runCount.value === 1) return 'Analyzed once — show analysis history';
      return `Analyzed ${runCount.value} times — show analysis history`;
    }
    return `File analysis history: ${statusDescriptor.value.label}`;
  });

  /** Subtitle string for the popover header: batch · standard tag names, joined by dots. */
  const subtitleParts = computed<string[]>(() => {
    const parts: string[] = [];
    if (props.batchName) parts.push(props.batchName);
    for (const tag of props.standardTagNames) parts.push(tag);
    return parts;
  });

  function formatRunDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return format(d, 'yyyy-MM-dd');
  }

  function runRowSubtitle(run: LaboratoryRunUsageSummary): string {
    const parts: string[] = [];
    if (run.WorkflowName?.trim()) parts.push(run.WorkflowName.trim());
    const date = formatRunDate(run.RunCreatedAt);
    if (date) parts.push(date);
    const sampleNoun = run.InputFileCount === 1 ? 'file' : 'files';
    parts.push(`${run.InputFileCount} ${sampleNoun}`);
    return parts.join(' \u00b7 ');
  }

  /** Open the laboratory run detail page in a new tab. */
  function openRunPage(run: LaboratoryRunUsageSummary): void {
    if (typeof window === 'undefined') return;
    window.open(`/labs/${props.labId}/run/${run.RunId}`, '_blank', 'noopener,noreferrer');
  }

  function onSelectRunSamples(run: LaboratoryRunUsageSummary, close: () => void): void {
    emit('selectRunFiles', { runId: run.RunId, inputFileKeys: [...run.InputFileKeys] });
    close();
  }

  /** Popover panel + container classes; parent lifts the active card/row while open so neighbors’ dots do not paint over the panel. */
  const popoverUi = computed(() => ({
    base: 'overflow-hidden',
    width: 'min-w-[22rem] max-w-[min(32rem,calc(100vw-2rem))] w-[min(28rem,calc(100vw-2rem))]',
    background: 'bg-white',
    shadow: 'shadow-lg',
    ring: 'ring-1 ring-gray-200',
    rounded: 'rounded-xl',
    container: 'z-[10050]',
    ...(props.variant === 'table'
      ? { trigger: 'inline-flex w-fit max-w-full items-center' }
      : { trigger: 'inline-flex w-fit items-center' }),
  }));
</script>

<template>
  <UPopover
    mode="hover"
    :open-delay="150"
    :close-delay="150"
    :popper="{ placement: 'right-start', strategy: 'fixed', offsetDistance: 12 }"
    :ui="popoverUi"
    @update:open="emit('update:open', $event)"
  >
    <!-- Card: circle (+ count when N>1); hover flush to card top-left (parent is absolute left-0 top-0 on card). -->
    <span
      v-if="isCard"
      class="inline-flex cursor-default items-center gap-1 rounded-tl-xl pb-1.5 pl-2 pr-1.5 pt-2 transition-colors hover:bg-gray-100 focus:outline-none"
      :aria-label="triggerAriaLabel"
      @mousedown.stop
      @click.stop
    >
      <span
        class="inline-block h-2 w-2 shrink-0 rounded-full"
        :style="{ backgroundColor: statusDescriptor.color }"
        aria-hidden="true"
      />
      <span
        v-if="runCount > 1"
        class="min-w-[1.125rem] rounded px-1 py-0.5 text-center text-[10px] font-semibold tabular-nums leading-none"
        :style="{
          backgroundColor: `${STATUS_COLOR_MULTIPLE}26`,
          color: STATUS_COLOR_MULTIPLE,
        }"
      >
        {{ runCount }}
      </span>
    </span>

    <!-- Table: dot + status text, no chip outline -->
    <span
      v-else
      class="inline-flex max-w-full cursor-default items-center gap-1.5 text-[11px] font-medium leading-none focus:outline-none"
      :aria-label="triggerAriaLabel"
      @mousedown.stop
      @click.stop
    >
      <span
        class="inline-block h-2 w-2 shrink-0 rounded-full"
        :style="{ backgroundColor: statusDescriptor.color }"
        aria-hidden="true"
      />
      <span :style="{ color: statusDescriptor.color }">{{ statusDescriptor.label }}</span>
    </span>

    <template #panel="{ close }">
      <div class="flex flex-col" @mousedown.stop @click.stop>
        <div class="border-b border-gray-200 px-4 py-3">
          <div class="break-words text-sm font-semibold leading-snug text-gray-900">{{ fileName }}</div>
          <div v-if="subtitleParts.length" class="text-muted mt-0.5 break-words text-xs leading-snug">
            {{ subtitleParts.join(' \u00b7 ') }}
          </div>
        </div>

        <!-- Run list: section title inset from tooltip edge; rows keep tight right edge vs check column -->
        <div class="max-h-[360px] overflow-y-auto py-3 pl-0 pr-4">
          <div class="pl-4 text-xs font-semibold uppercase tracking-wide text-gray-700">
            Analysis History ({{ runCount }})
          </div>

          <p v-if="runCount === 0" class="text-muted mt-2 pl-4 pr-0 text-xs italic">
            This sample hasn't been analyzed yet.
          </p>

          <ul v-else class="mt-2 space-y-1">
            <li
              v-for="run in runUsages"
              :key="run.RunId"
              class="flex min-h-[44px] items-stretch overflow-hidden rounded-lg border border-gray-100 bg-white"
            >
              <!-- Left: open run (divider before the select zone); pl-2 gives the play control breathing room -->
              <div
                class="flex min-w-0 flex-1 items-center gap-2 border-r border-gray-200 py-1.5 pl-2 pr-2 hover:bg-gray-50"
              >
                <button
                  type="button"
                  class="bg-primary/10 text-primary hover:bg-primary/20 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition"
                  aria-hidden="true"
                  tabindex="-1"
                  @click.stop="openRunPage(run)"
                >
                  <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                    <path
                      d="M5.5 4.2a.6.6 0 0 1 .91-.51l5.34 3.3a.6.6 0 0 1 0 1.02l-5.34 3.3a.6.6 0 0 1-.91-.51V4.2Z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="flex min-w-0 flex-1 flex-col items-start py-0.5 text-left"
                  @click.stop="openRunPage(run)"
                >
                  <span class="w-full break-words text-sm font-medium leading-snug text-gray-900 hover:underline">
                    {{ run.RunName || run.RunId }}
                  </span>
                  <span class="text-muted w-full break-words text-[11px] leading-snug">{{ runRowSubtitle(run) }}</span>
                </button>
              </div>

              <!-- Right: full-height select zone (hover + entire area clickable) -->
              <button
                type="button"
                class="text-primary hover:bg-primary/10 flex w-12 shrink-0 flex-col items-center justify-center border-l border-gray-200 bg-gray-50/40 transition"
                :aria-label="`Select ${run.InputFileCount} file(s) used in ${run.RunName || run.RunId}`"
                @click.stop="onSelectRunSamples(run, close)"
              >
                <span class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                  <UIcon name="i-lucide-square-dashed" class="absolute inset-0 h-5 w-5" />
                  <UIcon name="i-lucide-check" class="relative h-3 w-3" />
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div v-if="runCount > 0" class="text-muted border-t border-gray-200 px-4 py-2 text-[11px]">
          Click name to view results &middot; Click right side to select samples
        </div>
      </div>
    </template>
  </UPopover>
</template>
