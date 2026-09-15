<script setup lang="ts">
  import { UserSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/user';

  type OrgUserStatus = 'Active' | 'Inactive' | 'Invited';

  const props = withDefaults(
    defineProps<{
      status: OrgUserStatus;
    }>(),
    {
      status: 'Active',
    },
  );

  const baseConfig = {
    base: 'inline-flex items-center uppercase',
    rounded: 'rounded-xl text-md',
    size: {
      sm: 'text-xs px-4 py-1',
    },
    variant: {
      solid: 'bg-alert-success-muted text-alert-success-text',
    },
  };

  const label = computed(() => {
    switch (props.status) {
      case UserSchema.shape.Status.enum.Active:
        return 'Active';
      case UserSchema.shape.Status.enum.Inactive:
        return 'Inactive';
      case UserSchema.shape.Status.enum.Invited:
        return 'Invited';
      default:
        return props.status;
    }
  });

  const styleMap = {
    [UserSchema.shape.Status.enum.Active]: {
      solid: 'bg-alert-success-muted text-alert-success-text',
    },
    [UserSchema.shape.Status.enum.Inactive]: {
      solid: 'bg-background-light-grey text-body',
    },
    [UserSchema.shape.Status.enum.Invited]: {
      solid: 'bg-alert-caution-muted text-alert-caution',
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
  <UBadge :ui="getConfig" :aria-label="`Membership status: ${label}`">{{ label }}</UBadge>
</template>
