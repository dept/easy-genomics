<script setup lang="ts">
  const $router = useRouter();
  const props = withDefaults(defineProps<{ label?: string; backAction?: () => void }>(), {
    label: 'Back',
    backAction: undefined,
  });

  function handleBack() {
    if (props.backAction) {
      props.backAction();
    } else {
      $router.push(useUiStore().previousPageRoute);
    }
  }
</script>

<template>
  <button
    type="button"
    @click="handleBack"
    class="text-primary focus-visible:outline-primary-500 flex w-min cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent p-0 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
  >
    <UIcon name="i-heroicons-arrow-left-solid" aria-hidden="true" />
    <span>{{ label }}</span>
  </button>
</template>
