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
  <div class="sample-sheet-bar">
    <div v-if="props.displayLabel">
      <EGText v-if="url" tag="h5" class="mb-2">Sample Sheet:</EGText>
      <EGText v-else tag="h5" class="mb-2">Sample Sheet now generating, please wait...</EGText>
    </div>
    <div
      :class="[{ 'pointer-events-none opacity-50': disabled }]"
      class="border-r-1 bg-primary-muted mb-4 flex items-center justify-between rounded p-4"
    >
      <div
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

      <div class="ml-2 flex items-center gap-4" role="group" aria-label="URL Actions">
        <button
          type="button"
          @click="open"
          class="focus-visible:outline-primary-500 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="{ 'opacity-50': !url }"
          aria-label="Open sample sheet in new tab"
          :disabled="isClicked || !url || disabled"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="25" viewBox="0 0 24 25" fill="none">
            <path
              d="M20.2916 12.5C19.9004 12.5 19.5833 12.8171 19.5833 13.2084V19.5833H5.41674V5.41674H11.7916C12.1829 5.41674 12.5 5.09959 12.5 4.70837C12.5 4.31715 12.1829 4 11.7916 4H5.41674C4.63771 4 4 4.6375 4 5.41674V19.5835C4 20.3623 4.63771 21 5.41674 21H19.5833C20.3623 21 21 20.3623 21 19.5833V13.2084C21 12.8171 20.6829 12.5 20.2916 12.5Z"
              fill="#5524E0"
            />
            <path
              d="M20.2915 9.66663C20.6828 9.66669 21 9.34949 20.9999 8.95822L20.9994 4.70805C21 4.31726 20.6825 4 20.2917 4H16.0414C15.6503 4 15.3333 4.31705 15.3333 4.70816C15.3333 5.09926 15.6503 5.41631 16.0414 5.41631H18.5809L13.0008 10.9972C12.7242 11.2738 12.7242 11.7223 13.0008 11.999C13.2775 12.2757 13.726 12.2757 14.0027 11.9991L19.5833 6.41931V8.95831C19.5833 9.34946 19.9003 9.66657 20.2915 9.66663Z"
              fill="#5524E0"
            />
          </svg>
        </button>

        <button
          type="button"
          @click="copy"
          class="focus-visible:outline-primary-500 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="{ 'opacity-50': !url }"
          aria-label="Copy sample sheet URL to clipboard"
          :disabled="isClicked || !url || disabled"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="25" viewBox="0 0 24 25" fill="none">
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M20 17.6207C20 18.047 19.6559 18.3923 19.2301 18.3923C18.8044 18.3923 18.4603 18.047 18.4603 17.6207V5.04317H8.94491C8.51915 5.04317 8.17504 4.69787 8.17504 4.27158C8.17504 3.84606 8.51915 3.5 8.94491 3.5H19.2301C19.6558 3.5 19.9999 3.8453 19.9999 4.27158L20 17.6207ZM8.17508 9.24168L6.63 10.7887H8.17508V9.24168ZM4.22967 11.0095C4.08317 11.1538 4 11.3509 4 11.5603V20.7284C4 21.1547 4.34411 21.5 4.76986 21.5H15.6221C16.0478 21.5 16.3934 21.1547 16.3934 20.7284V7.37916C16.3934 6.95288 16.0478 6.60758 15.6221 6.60758H8.94498C8.73516 6.60758 8.54136 6.69161 8.39639 6.83829L4.23045 11.0086L4.22967 11.0095ZM9.71485 8.1508V11.5604C9.71485 11.9867 9.37074 12.332 8.94498 12.332H5.53965V19.9569H14.8521V8.15086L9.71485 8.1508Z"
              fill="#5524E0"
            />
          </svg>
        </button>

        <button
          type="button"
          @click="download"
          class="focus-visible:outline-primary-500 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="{ 'opacity-50': !url }"
          aria-label="Download sample sheet"
          :disabled="isClicked || !url || disabled"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" />
            <path
              d="M-1584 -4223C-1584 -4224.1 -1583.1 -4225 -1582 -4225H1954C1955.1 -4225 1956 -4224.1 1956 -4223V2977C1956 2978.1 1955.1 2979 1954 2979H-1582C-1583.1 2979 -1584 2978.1 -1584 2977V-4223Z"
            />
            <path
              d="M-1582 -4224H1954V-4226H-1582V-4224ZM1955 -4223V2977H1957V-4223H1955ZM1954 2978H-1582V2980H1954V2978ZM-1583 2977V-4223H-1585V2977H-1583ZM-1582 2978C-1582.55 2978 -1583 2977.55 -1583 2977H-1585C-1585 2978.66 -1583.66 2980 -1582 2980V2978ZM1955 2977C1955 2977.55 1954.55 2978 1954 2978V2980C1955.66 2980 1957 2978.66 1957 2977H1955ZM1954 -4224C1954.55 -4224 1955 -4223.55 1955 -4223H1957C1957 -4224.66 1955.66 -4226 1954 -4226V-4224ZM-1582 -4226C-1583.66 -4226 -1585 -4224.66 -1585 -4223H-1583C-1583 -4223.55 -1582.55 -4224 -1582 -4224V-4226Z"
              fill="#5524E0"
              fill-opacity="0.1"
            />
            <rect width="1200" height="2703" transform="translate(-72 -731)" />
            <path
              d="M3 16.5V18.75C3 19.3467 3.23705 19.919 3.65901 20.341C4.08097 20.7629 4.65326 21 5.25 21H18.75C19.3467 21 19.919 20.7629 20.341 20.341C20.7629 19.919 21 19.3467 21 18.75V16.5M16.5 12L12 16.5M12 16.5L7.5 12M12 16.5V3"
              stroke="#5524E0"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
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
