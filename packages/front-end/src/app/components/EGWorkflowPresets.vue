<script setup lang="ts">
  import type {
    WorkflowRunPreset,
    WorkflowRunPresetParams,
    WorkflowRunPresetScope,
  } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
  import { useToastStore, useUiStore, useWorkflowRunPresetsStore } from '@FE/stores';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';

  const props = defineProps<{
    labId: string;
    workflowId: string;
    /** Parameter values currently in the form, already stripped of run-specific fields. */
    currentParams: WorkflowRunPresetParams;
    /** True while the user still has pre-preset saved defaults for this workflow. */
    hasLegacyDefaults?: boolean;
  }>();

  const emit = defineEmits<{
    apply: [params: WorkflowRunPresetParams];
    'legacy-adopted': [];
  }>();

  const presetsStore = useWorkflowRunPresetsStore();
  const uiStore = useUiStore();
  useInitialPendingRequests('loadWorkflowRunPresets');
  const toast = useToastStore();

  const appliedPresetId = ref<string | null>(null);
  const modalOpen = ref<boolean>(false);
  const modalMode = ref<'create' | 'rename'>('create');
  const renameTarget = ref<WorkflowRunPreset | null>(null);
  const presetPendingDeletion = ref<WorkflowRunPreset | null>(null);

  const presets = computed<WorkflowRunPreset[]>(() => presetsStore.presetsFor(props.labId, props.workflowId));
  const userPresets = computed<WorkflowRunPreset[]>(() => presets.value.filter((preset) => preset.Scope === 'USER'));
  const labPresets = computed<WorkflowRunPreset[]>(() => presets.value.filter((preset) => preset.Scope === 'LAB'));

  /** Lab presets lead: a shared lab standard is the value most runs should start from. */
  const presetGroups = computed(() =>
    [
      { scope: 'LAB', label: 'Shared with this lab', icon: 'i-heroicons-user-group', items: labPresets.value },
      { scope: 'USER', label: 'Only you', icon: 'i-heroicons-user', items: userPresets.value },
    ].filter((group) => group.items.length > 0),
  );

  const deleteDialogTitle = computed<string>(() =>
    presetPendingDeletion.value ? `Delete the “${presetPendingDeletion.value.Name}” preset?` : '',
  );

  const deleteDialogMessage = computed<string>(() =>
    presetPendingDeletion.value?.Scope === 'LAB'
      ? 'This preset is shared, so it will be removed for everyone in this laboratory.'
      : 'This only removes the saved preset — the values in the form are left untouched.',
  );

  const loading = computed<boolean>(() => uiStore.isRequestPending('loadWorkflowRunPresets'));
  const saving = computed<boolean>(() => uiStore.isRequestPending('saveWorkflowRunPreset'));

  const canSaveNewPreset = computed<boolean>(
    () =>
      presetsStore.canCreatePreset(props.labId, props.workflowId, 'USER') ||
      presetsStore.canCreatePreset(props.labId, props.workflowId, 'LAB'),
  );

  const appliedPreset = computed<WorkflowRunPreset | null>(
    () => presets.value.find((preset) => preset.PresetId === appliedPresetId.value) ?? null,
  );

  /** True once the form has drifted from the preset that was applied, so we can offer to update it. */
  const appliedPresetIsModified = computed<boolean>(() => {
    if (!appliedPreset.value) return false;
    return !paramsMatch(appliedPreset.value.Params, props.currentParams);
  });

  function paramsMatch(a: WorkflowRunPresetParams, b: WorkflowRunPresetParams): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (String(a[key] ?? '') !== String(b[key] ?? '')) return false;
    }
    return true;
  }

  onMounted(() => presetsStore.loadPresets(props.labId, props.workflowId));

  function applyPreset(preset: WorkflowRunPreset): void {
    appliedPresetId.value = preset.PresetId;
    emit('apply', preset.Params);
    toast.success(`Applied "${preset.Name}".`);
  }

  function openSaveModal(): void {
    modalMode.value = 'create';
    renameTarget.value = null;
    modalOpen.value = true;
  }

  function openRenameModal(preset: WorkflowRunPreset): void {
    modalMode.value = 'rename';
    renameTarget.value = preset;
    modalOpen.value = true;
  }

  async function onModalSubmit({ name, scope }: { name: string; scope: WorkflowRunPresetScope }): Promise<void> {
    if (modalMode.value === 'rename' && renameTarget.value) {
      const updated = await presetsStore.updatePreset(renameTarget.value, { Name: name });
      if (!updated) return;
      toast.success('Preset renamed.');
    } else {
      const created = await presetsStore.createPreset(props.labId, props.workflowId, scope, name, props.currentParams);
      if (!created) return;
      appliedPresetId.value = created.PresetId;
      toast.success(`Saved "${created.Name}".`);
    }
    modalOpen.value = false;
  }

  /** Overwrites a preset with whatever is in the form now. */
  async function overwritePreset(preset: WorkflowRunPreset): Promise<void> {
    const updated = await presetsStore.updatePreset(preset, { Params: props.currentParams });
    if (updated) {
      toast.success(`Updated "${preset.Name}" with the current values.`);
    }
  }

  async function confirmDelete(): Promise<void> {
    const preset = presetPendingDeletion.value;
    if (!preset) return;

    const deleted = await presetsStore.deletePreset(preset);
    presetPendingDeletion.value = null;
    if (!deleted) return;

    if (appliedPresetId.value === preset.PresetId) {
      appliedPresetId.value = null;
    }
    toast.success(`Deleted "${preset.Name}".`);
  }

  /**
   * Turns the user's legacy `OmicsWorkflowDefaultParams` entry into a named preset so the
   * old single-slot field can retire without a data migration.
   */
  async function adoptLegacyDefaults(): Promise<void> {
    const created = await presetsStore.adoptLegacyDefaults(props.labId, props.workflowId, props.currentParams);
    if (!created) return;
    appliedPresetId.value = created.PresetId;
    emit('legacy-adopted');
    toast.success(`Your saved defaults are now the "${created.Name}" preset.`);
  }

  function menuItemsFor(preset: WorkflowRunPreset) {
    return [
      [
        {
          label: 'Update with current values',
          icon: 'i-heroicons-arrow-path',
          click: () => overwritePreset(preset),
        },
        {
          label: 'Rename',
          icon: 'i-heroicons-pencil-square',
          click: () => openRenameModal(preset),
        },
      ],
      [
        {
          label: 'Delete',
          icon: 'i-heroicons-trash',
          click: () => (presetPendingDeletion.value = preset),
        },
      ],
    ];
  }
</script>

<template>
  <div>
    <div class="mb-4">
      <div class="flex items-center gap-1.5">
        <UIcon name="i-heroicons-bookmark-square" class="text-primary-500 h-4 w-4 shrink-0" />
        <h3 class="text-heading text-sm font-semibold">Parameter presets</h3>
        <span v-if="loading" class="text-muted text-xs">Loading…</span>
      </div>
      <p class="text-muted mt-2 text-xs leading-relaxed">
        Apply a saved set of values, or save the current ones to reuse on future runs of this workflow.
      </p>
      <EGButton
        class="mt-4 w-full"
        :size="ButtonSizeEnum.enum.xs"
        :variant="ButtonVariantEnum.enum.secondary"
        icon="i-heroicons-plus-20-solid"
        :icon-right="false"
        label="Save current values"
        :disabled="saving || !canSaveNewPreset"
        @click="openSaveModal"
      />
    </div>

    <!-- Offer to convert pre-preset saved defaults instead of migrating them server-side. -->
    <div v-if="hasLegacyDefaults" class="bg-primary-muted mb-4 rounded-lg p-3">
      <p class="text-body mb-2.5 text-xs leading-relaxed">
        You have older saved defaults for this workflow. Name them to manage them alongside your presets.
      </p>
      <EGButton
        :size="ButtonSizeEnum.enum.xs"
        :variant="ButtonVariantEnum.enum.secondary"
        label="Save as preset"
        :disabled="saving"
        @click="adoptLegacyDefaults"
      />
    </div>

    <div v-if="presets.length" class="space-y-4">
      <div v-for="group in presetGroups" :key="group.scope">
        <div class="mb-2 flex items-center gap-1.5">
          <UIcon :name="group.icon" class="text-muted h-3.5 w-3.5" />
          <span class="text-muted text-[11px] font-semibold uppercase tracking-wide">{{ group.label }}</span>
        </div>

        <ul class="space-y-1.5">
          <li
            v-for="preset in group.items"
            :key="preset.PresetId"
            class="flex items-center rounded-lg border transition-colors"
            :class="
              appliedPresetId === preset.PresetId
                ? 'border-primary-500 bg-primary-muted'
                : 'hover:border-primary-500 hover:bg-background-light-grey border-neutral-200 bg-white'
            "
          >
            <button
              type="button"
              class="focus-visible:outline-primary-500 flex min-w-0 flex-1 items-center gap-1.5 rounded-l-lg px-2.5 py-2 text-left text-xs focus-visible:outline focus-visible:outline-2"
              :class="appliedPresetId === preset.PresetId ? 'text-primary-dark font-medium' : 'text-body'"
              :aria-pressed="appliedPresetId === preset.PresetId"
              :disabled="saving"
              @click="applyPreset(preset)"
            >
              <UIcon
                v-if="appliedPresetId === preset.PresetId"
                name="i-heroicons-check-circle-20-solid"
                class="text-primary-500 h-3.5 w-3.5 shrink-0"
              />
              <span class="truncate">{{ preset.Name }}</span>
              <span
                v-if="appliedPresetId === preset.PresetId && appliedPresetIsModified"
                class="text-muted shrink-0 text-[10px] italic"
              >
                modified
              </span>
            </button>

            <UDropdown :items="menuItemsFor(preset)" :popper="{ placement: 'bottom-end' }">
              <UButton
                color="gray"
                variant="ghost"
                size="2xs"
                icon="i-heroicons-ellipsis-vertical-20-solid"
                class="rounded-r-lg"
                :disabled="saving"
                :aria-label="`Manage preset ${preset.Name}`"
              />
            </UDropdown>
          </li>
        </ul>
      </div>
    </div>

    <p v-else-if="!loading" class="text-muted mt-1 text-xs leading-relaxed">
      No presets saved for this workflow yet. Fill in the parameters, then save them as a preset.
    </p>
  </div>

  <EGWorkflowPresetModal
    v-model="modalOpen"
    :mode="modalMode"
    :initial-name="renameTarget?.Name"
    :initial-scope="renameTarget?.Scope"
    :user-preset-count="userPresets.length"
    :lab-preset-count="labPresets.length"
    :taken-user-names="userPresets.filter((p) => p.PresetId !== renameTarget?.PresetId).map((p) => p.Name)"
    :taken-lab-names="labPresets.filter((p) => p.PresetId !== renameTarget?.PresetId).map((p) => p.Name)"
    :saving="saving"
    @submit="onModalSubmit"
  />

  <EGDialog
    :model-value="!!presetPendingDeletion"
    @update:model-value="presetPendingDeletion = null"
    :primary-message="deleteDialogTitle"
    :secondary-message="deleteDialogMessage"
    action-label="Delete preset"
    :action-variant="ButtonVariantEnum.enum.destructive"
    cancel-label="Cancel"
    :loading="saving"
    @action-triggered="confirmDelete"
  />
</template>
