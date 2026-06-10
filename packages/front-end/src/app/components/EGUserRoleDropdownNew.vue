<script setup lang="ts">
  import {
    LaboratoryRolesEnumSchema,
    LaboratoryRolesEnum,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/roles';
  import { LabUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user-unified';

  const props = withDefaults(
    defineProps<{
      user: LabUser;
      disabled?: boolean;
      showRemoveFromLab?: boolean;
    }>(),
    {
      disabled: false,
      showRemoveFromLab: false,
    },
  );

  const emit = defineEmits(['remove-user-from-lab', 'assign-lab-role']);

  const { assignedRole, displayName } = props.user;
  const roles = Object.values(LaboratoryRolesEnumSchema.enum).map((role) => role);
  const isOpen = ref(false);

  const items: Array<Array<Object>> = roles.map((role: LaboratoryRolesEnum) => {
    return [
      {
        label: role,
        click: () => emit('assign-lab-role', { user: props.user, role }),
      },
    ];
  });

  if (props.showRemoveFromLab) {
    items.push([
      {
        label: 'Remove From Lab',
        class: 'text-alert-danger-dark',
        isHighlighted: true,
        click: () => emit('remove-user-from-lab', { user: props.user }),
      },
    ]);
  }

  const menuLabel = computed(() => `Lab role for ${displayName}, currently ${assignedRole}`);
</script>

<template>
  <div class="flex w-full justify-end">
    <UDropdown v-model:open="isOpen" class="UDropdown" :items="items">
      <UButton
        :disabled="disabled"
        variant="ghost"
        color="gray"
        icon="i-heroicons-chevron-down"
        trailing
        class="focus-visible:outline-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        :aria-label="menuLabel"
        :aria-expanded="isOpen"
        aria-haspopup="menu"
      >
        {{ assignedRole }}
      </UButton>
      <template #item="{ item }">
        <span class="flex items-center gap-2 truncate" :class="{ 'is-highlighted': item.isHighlighted }">
          <UIcon
            v-if="item.isHighlighted"
            name="i-heroicons-exclamation-triangle"
            class="h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          {{ item.label }}
        </span>
      </template>
    </UDropdown>
  </div>
</template>

<style lang="scss">
  .UDropdown {
    .p-1 {
      padding: 8px 12px;
    }

    .is-highlighted {
      color: #ef5c45;
      font-weight: 500;
    }

    .active {
      border-radius: 100px;
      background-color: #c2c2c2;
    }
  }
</style>
