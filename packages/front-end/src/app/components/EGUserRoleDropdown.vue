<script setup lang="ts">
  import { LaboratoryUserDetails } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user-details';
  import { LaboratoryRolesEnum, LaboratoryRolesEnumSchema } from '@FE/types/roles';

  interface LaboratoryUserDetailsWithRoles extends LaboratoryUserDetails {
    assignedRole: LaboratoryRolesEnumSchema;
  }

  const props = withDefaults(
    defineProps<{
      user: LaboratoryUserDetailsWithRoles;
      disabled?: boolean;
      showRemoveFromLab?: boolean;
    }>(),
    {
      disabled: false,
      showRemoveFromLab: false,
    },
  );

  const { PreferredName, FirstName, LastName, UserId, UserEmail } = props.user;
  const displayName = useUser().displayName({
    preferredName: PreferredName,
    firstName: FirstName,
    lastName: LastName,
    email: UserEmail,
  });
  const emit = defineEmits(['remove-user-from-lab', 'assign-role']);
  const roles = Object.values(LaboratoryRolesEnumSchema.enum);
  const isOpen = ref(false);

  const items: Array<Array<Object>> = roles
    // don't allow setting to Unknown, it's just for if the api sends us something strange
    .filter((role) => role !== 'Unknown')
    .map((role: LaboratoryRolesEnum) => {
      return [
        {
          label: role,
          click: () => {
            handleUpdateRole(role);
          },
        },
      ];
    });

  if (props.showRemoveFromLab) {
    items.push([
      {
        label: 'Remove From Lab',
        class: 'text-alert-danger-dark',
        isHighlighted: true,
        click: () => {
          emit('remove-user-from-lab', { UserId, displayName });
        },
      },
    ]);
  }

  function handleUpdateRole(role) {
    const LabManager = role === LaboratoryRolesEnumSchema.enum.LabManager;
    const LabTechnician = role === LaboratoryRolesEnumSchema.enum.LabTechnician;
    const { ...cleanUser } = props.user;
    const labUser = { ...cleanUser, LabManager, LabTechnician };

    emit('assign-role', { labUser, displayName });
  }

  const menuLabel = computed(() => `Lab role for ${displayName}, currently ${props.user.assignedRole}`);
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
        :aria-label="menuLabel"
        :aria-expanded="isOpen"
        aria-haspopup="menu"
      >
        {{ props.user.assignedRole }}
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
