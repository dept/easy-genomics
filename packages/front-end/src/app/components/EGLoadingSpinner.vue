<template>
  <div :class="['spinner-container', sizeClass]" role="status" aria-live="polite">
    <span class="sr-only">{{ label }}</span>
    <svg class="spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle opacity="0.25" cx="12" cy="12" r="9" :stroke="spinnerColor" stroke-width="3" />
      <path
        d="M5.63604 18.364C4.37737 17.1053 3.5202 15.5016 3.17294 13.7558C2.82567 12.01 3.0039 10.2004 3.68509 8.55585C4.36628 6.91131 5.51983 5.50571 6.99987 4.51677C8.47991 3.52784 10.22 3 12 3"
        :stroke="spinnerColor"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
  type SpinnerVariant = 'default' | 'dark';

  const props = withDefaults(
    defineProps<{
      sizeClass?: string;
      variant?: SpinnerVariant;
      label?: string;
    }>(),
    {
      sizeClass: 'w-8 h-8',
      variant: 'default',
      label: 'Loading',
    },
  );

  const spinnerColor = computed(() => {
    switch (props.variant) {
      case 'dark':
        return '#323840';
      case 'default':
      default:
        return '#5524e0';
    }
  });
</script>

<style scoped>
  .spinner {
    animation: spin 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
</style>
