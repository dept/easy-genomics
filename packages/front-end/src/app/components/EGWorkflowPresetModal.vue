<script setup lang="ts">
  import {
    WORKFLOW_RUN_PRESET_LIMIT,
    WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH,
    type WorkflowRunPresetScope,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';

  const props = defineProps<{
    modelValue: boolean;
    /** `create` collects a name and a tier; `rename` only renames an existing preset in place. */
    mode: 'create' | 'rename';
    initialName?: string;
    initialScope?: WorkflowRunPresetScope;
    /** How many presets each tier already holds, used to disable a tier that is full. */
    userPresetCount: number;
    labPresetCount: number;
    /** Names already taken in each tier, so a clash is caught before the request. */
    takenUserNames: string[];
    takenLabNames: string[];
    saving?: boolean;
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    submit: [payload: { name: string; scope: WorkflowRunPresetScope }];
  }>();

  const titleId = useId();
  const name = ref<string>('');
  const scope = ref<WorkflowRunPresetScope>('USER');

  const tiers = computed(() => [
    {
      value: 'USER' as WorkflowRunPresetScope,
      label: 'Only me',
      description: 'A private preset visible just to you.',
      icon: 'i-heroicons-user',
    },
    {
      value: 'LAB' as WorkflowRunPresetScope,
      label: 'Everyone in this lab',
      description: 'A shared standard any lab member can apply or edit.',
      icon: 'i-heroicons-user-group',
    },
  ]);

  function tierIsFull(tier: WorkflowRunPresetScope): boolean {
    return (tier === 'LAB' ? props.labPresetCount : props.userPresetCount) >= WORKFLOW_RUN_PRESET_LIMIT;
  }

  const trimmedName = computed<string>(() => name.value.trim());

  /**
   * The name handed over by the last submit. The preset list refreshes before the modal has
   * finished closing, so without this the name just saved would read back as already taken.
   */
  const submittedName = ref<string | null>(null);
  // Sync so an edit always clears this before a same-tick submit records the new name.
  watch(name, () => (submittedName.value = null), { flush: 'sync' });

  const nameError = computed<string | null>(() => {
    if (trimmedName.value.length === 0) return null;
    if (trimmedName.value.length > WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH) {
      return `Use ${WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH} characters or fewer.`;
    }
    if (trimmedName.value === submittedName.value) return null;
    const taken = scope.value === 'LAB' ? props.takenLabNames : props.takenUserNames;
    if (taken.some((existing) => existing.toLowerCase() === trimmedName.value.toLowerCase())) {
      return 'A preset with this name already exists here.';
    }
    return null;
  });

  // A full tier only blocks adding a preset; renaming one that is already there is always allowed.
  const canSubmit = computed<boolean>(
    () =>
      trimmedName.value.length > 0 &&
      !nameError.value &&
      !props.saving &&
      !(props.mode === 'create' && tierIsFull(scope.value)),
  );

  // Reset to the caller's starting values each time the modal opens.
  watch(
    () => props.modelValue,
    (open) => {
      if (!open) return;
      name.value = props.initialName ?? '';
      scope.value = props.initialScope ?? (tierIsFull('USER') && !tierIsFull('LAB') ? 'LAB' : 'USER');
      submittedName.value = null;
    },
    { immediate: true },
  );

  function close(): void {
    emit('update:modelValue', false);
  }

  function submit(): void {
    if (!canSubmit.value) return;
    submittedName.value = trimmedName.value;
    emit('submit', { name: trimmedName.value, scope: scope.value });
  }
</script>

<template>
  <UModal
    :model-value="modelValue"
    @update:model-value="(value: boolean) => emit('update:modelValue', value)"
    :ui="{
      overlay: { base: 'fixed inset-0 transition-opacity backdrop-blur-[5px]', background: 'bg-gray-800/30' },
      rounded: 'rounded-3xl',
      width: 'sm:max-w-lg',
    }"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
  >
    <UCard :ui="{ base: 'p-8', rounded: 'rounded-3xl' }">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 :id="titleId" class="text-heading font-serif text-lg font-semibold">
            {{ mode === 'create' ? 'Save parameter preset' : 'Rename preset' }}
          </h2>
          <p v-if="mode === 'create'" class="text-muted mt-1 text-sm">
            Save the parameter values currently in the form so you can reuse them on future runs.
          </p>
        </div>
        <UButton
          @click="close"
          icon="i-heroicons-x-mark"
          class="hover:bg-background-dark-grey focus-visible:outline-primary-500 shrink-0"
          color="black"
          variant="ghost"
          :ui="{ rounded: 'rounded-full' }"
          :disabled="saving"
          aria-label="Close dialog"
        />
      </div>

      <div class="mt-6">
        <label for="preset-name" class="text-heading mb-1.5 block text-sm font-medium">Preset name</label>
        <UInput
          id="preset-name"
          v-model="name"
          placeholder="e.g. Strict QC — nasal swabs"
          :maxlength="WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH"
          :color="nameError ? 'red' : undefined"
          autofocus
          @keyup.enter="submit"
        />
        <p v-if="nameError" class="text-alert-danger-dark mt-1.5 text-xs">{{ nameError }}</p>
      </div>

      <fieldset v-if="mode === 'create'" class="mt-6">
        <legend class="text-heading mb-2 text-sm font-medium">Who can use it</legend>
        <div class="space-y-2">
          <label
            v-for="tier in tiers"
            :key="tier.value"
            class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
            :class="[
              scope === tier.value
                ? 'border-primary-500 bg-primary-muted'
                : 'hover:bg-background-light-grey border-neutral-200',
              tierIsFull(tier.value) ? 'cursor-not-allowed opacity-50' : '',
            ]"
          >
            <input
              v-model="scope"
              type="radio"
              :value="tier.value"
              :disabled="tierIsFull(tier.value)"
              class="text-primary focus:ring-primary mt-0.5 h-4 w-4 border-gray-300 focus:ring-2"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <UIcon :name="tier.icon" class="text-muted h-4 w-4" />
                <span class="text-heading text-sm font-medium">{{ tier.label }}</span>
              </div>
              <p class="text-muted mt-0.5 text-xs">
                {{ tierIsFull(tier.value) ? 'Limit reached — delete a preset here first.' : tier.description }}
              </p>
            </div>
          </label>
        </div>
      </fieldset>

      <div class="mt-8 flex justify-end gap-3">
        <EGButton
          :size="ButtonSizeEnum.enum.sm"
          :variant="ButtonVariantEnum.enum.secondary"
          label="Cancel"
          :disabled="saving"
          @click="close"
        />
        <EGButton
          :size="ButtonSizeEnum.enum.sm"
          :label="mode === 'create' ? 'Save preset' : 'Save name'"
          :disabled="!canSubmit"
          :loading="saving"
          @click="submit"
        />
      </div>
    </UCard>
  </UModal>
</template>
