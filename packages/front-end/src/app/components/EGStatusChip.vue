<script setup lang="ts">
  import { Status, StatusEnum } from '@/types/status';

  const props = withDefaults(
    defineProps<{
      status: Status;
    }>(),
    {
      status: StatusEnum.enum.UNKNOWN,
    },
  );

  const baseConfig = {
    base: 'inline-flex items-center uppercase',
    rounded: 'rounded-xl text-md',
    size: {
      sm: 'text-xs px-4 py-1',
    },
    variant: {
      solid: 'bg-alert-danger-muted text-alert-danger',
    },
  };

  // translate api enum to UI label
  const label = computed(() => {
    switch (props.status) {
      case StatusEnum.enum.CANCELLED:
        return 'Cancelled';
      case StatusEnum.enum.FAILED:
        return 'Failed';
      case StatusEnum.enum.SUCCEEDED:
        return 'Succeeded';
      case StatusEnum.enum.RUNNING:
        return 'Running';
      case StatusEnum.enum.SUBMITTED:
        return 'Submitted';
      case StatusEnum.enum.UNKNOWN:
        return 'Unknown';
      default:
        return props.status;
    }
  });

  const styleMap = {
    [StatusEnum.enum.COMPLETED]: {
      solid: 'bg-alert-success-muted text-alert-success-text',
    },
    [StatusEnum.enum.SUCCEEDED]: {
      solid: 'bg-alert-success-muted text-alert-success-text',
    },
    [StatusEnum.enum.FAILED]: {
      solid: 'bg-alert-danger-muted text-alert-danger',
    },
    [StatusEnum.enum.CANCELLED]: {
      solid: 'bg-background-light-grey text-body',
    },
    [StatusEnum.enum.RUNNING]: {
      solid: 'bg-primary-muted text-primary',
    },
    [StatusEnum.enum.SUBMITTED]: {
      solid: 'bg-background-dark-grey text-body',
    },
    [StatusEnum.enum.UNKNOWN]: {
      solid: 'bg-background-dark-grey text-body',
    },
  };

  const getConfig = computed(() => {
    return {
      ...baseConfig,
      variant: styleMap[props.status] || { solid: 'bg-background-dark-grey text-body' },
    };
  });
</script>

<template>
  <UBadge :ui="getConfig" :aria-label="`Run status: ${label}`">{{ label }}</UBadge>
</template>
