<script setup lang="ts">
  import usePipeline from '@FE/composables/usePipeline';

  const props = withDefaults(
    defineProps<{
      url: string;
      labId: string;
      pipelineOrWorkflowName: string;
      platform: string;
      runName: string;
      labName: string;
      disabled?: boolean;
      displayLabel?: boolean;
      /** Action icons only — used when the parent already shows the S3 URI. */
      iconsOnly?: boolean;
    }>(),
    {
      url: '',
      labId: '',
      pipelineOrWorkflowName: '',
      platform: '',
      runName: '',
      labName: '',
      disabled: false,
      displayLabel: false,
      iconsOnly: false,
    },
  );

  const router = useRouter();
  const isClicked = ref(false);
  const clickedAction = ref();
  const { $api } = useNuxtApp();
  const { downloadSampleSheet } = usePipeline($api);

  const copy = async () => {
    if (!props.url) return;

    try {
      await navigator.clipboard.writeText(props.url);
      clickedAction.value = 'Copied';
      isClicked.value = true;
      setTimeout(() => {
        isClicked.value = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  };

  const open = () => {
    if (!props.url) return;

    const baseUrl = window.location.origin;
    const url = router.resolve({
      path: `/labs/${props.labId}/sample-sheet`,
      query: {
        url: props.url,
        pipelineOrWorkflowName: props.pipelineOrWorkflowName,
        platform: props.platform,
        runName: props.runName,
      },
    });

    clickedAction.value = 'Opening Sample Sheet';
    isClicked.value = true;
    setTimeout(() => {
      isClicked.value = false;
    }, 2000);
    window.open(baseUrl + url.href, '_blank');
  };

  function onCopyKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      copy();
    }
  }

  const download = () => {
    clickedAction.value = 'Downloading Sample Sheet';
    isClicked.value = true;
    setTimeout(() => {
      isClicked.value = false;
    }, 2000);

    downloadSampleSheet(props.labId, props.url);
  };
</script>

<template>
  <div class="sample-sheet-bar" :class="{ 'mb-0': iconsOnly }">
    <div v-if="props.displayLabel">
      <EGText v-if="url" tag="h5" class="mb-2">Sample Sheet:</EGText>
      <EGText v-else tag="h5" class="mb-2">Sample Sheet now generating, please wait...</EGText>
    </div>
    <div
      :class="[
        { 'pointer-events-none opacity-50': disabled },
        iconsOnly
          ? 'flex items-center justify-end gap-3'
          : 'border-r-1 bg-primary-muted mb-4 flex items-center justify-between rounded p-4',
      ]"
    >
      <div
        v-if="!iconsOnly"
        class="text-primary hover:text-primary-900 focus-visible:outline-primary-500 relative cursor-pointer text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        role="button"
        tabindex="0"
        :aria-label="url ? `Copy URL: ${url}` : 'Sample sheet URL loading'"
        :aria-disabled="!url || disabled"
        @click="url && !disabled && copy()"
        @keydown="onCopyKeydown"
      >
        <div v-if="url">{{ url }}</div>
        <div v-else class="flex flex-col">
          <USkeleton class="mb-2 h-2 w-[500px] rounded" />
          <USkeleton class="h-2 w-[400px] rounded" />
        </div>
        <div
          :class="{ copied: true, show: isClicked }"
          role="status"
          aria-live="polite"
          class="flex items-center gap-1"
        >
          {{ clickedAction }}
          <UIcon name="i-heroicons-check-20-solid" class="h-4 w-4 text-white" />
        </div>
      </div>

      <div
        class="flex items-center gap-3"
        :class="{ 'ml-2 gap-4': !iconsOnly }"
        role="group"
        aria-label="URL Actions"
      >
        <button
          type="button"
          class="focus-visible:outline-primary-500 text-primary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="{ 'opacity-50': !url }"
          aria-label="Copy sample sheet URL to clipboard"
          :disabled="isClicked || !url || disabled"
          @click="copy"
        >
          <UIcon name="i-heroicons-clipboard-document" class="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          type="button"
          class="focus-visible:outline-primary-500 text-primary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="{ 'opacity-50': !url }"
          aria-label="Open sample sheet in new tab"
          :disabled="isClicked || !url || disabled"
          @click="open"
        >
          <UIcon name="i-heroicons-arrow-top-right-on-square" class="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          type="button"
          class="focus-visible:outline-primary-500 text-primary cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="{ 'opacity-50': !url }"
          aria-label="Download sample sheet"
          :disabled="isClicked || !url || disabled"
          @click="download"
        >
          <UIcon name="i-heroicons-arrow-down-tray" class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .copied {
    position: absolute;
    top: -2rem;
    left: 50%;
    transform: translateX(-50%);
    background-color: #7c3aed; /* Violet */
    color: white;
    padding: 8px;
    border-radius: 4px;
    font-size: 1rem;
    text-align: center;
    opacity: 0;
    transition:
      opacity 0.3s ease,
      transform 0.3s ease;
  }

  .copied.show {
    opacity: 1;
    transform: translateX(-50%) translateY(-0.5rem);
  }
</style>
