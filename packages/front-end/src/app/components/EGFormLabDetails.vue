<script setup lang="ts">
  import {
    LabDetails,
    LabNameSchema,
    LabDescriptionSchema,
    NextFlowTowerApiBaseUrlSchema,
    NextFlowTowerAccessTokenSchema,
    NextFlowTowerWorkspaceIdSchema,
    RunRetentionMonthsSchema,
    LabDetailsFormModeEnum,
    LabDetailsFormMode,
  } from '@FE/types/labs';
  import { AutoCompleteOptionsEnum } from '@FE/types/forms';
  import { FormError } from '#ui/types';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { maybeAddFieldValidationErrors } from '@FE/utils/form-utils';
  import {
    CreateLaboratory,
    CreateLaboratorySchema,
    ReadLaboratorySchema,
    UpdateLaboratory,
    UpdateLaboratorySchema,
  } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
  import { ERROR_CODES } from '@easy-genomics/shared-lib/src/app/constants/errorMessages';

  const props = withDefaults(
    defineProps<{
      formMode?: LabDetailsFormMode;
    }>(),
    {
      formMode: LabDetailsFormModeEnum.enum.ReadOnly,
    },
  );

  const emit = defineEmits<{
    (event: 'updated'): void;
  }>();

  const { $api } = useNuxtApp();
  const $route = useRoute();
  const router = useRouter();

  const orgsStore = useOrgsStore();
  const userStore = useUserStore();

  const labId: string = $route.params.labId as string;

  const formMode = ref(props.formMode);
  const s3Directories = ref([]);
  const isLoadingBuckets = ref(false);
  const isLoadingFormData = ref(false);
  const canSubmit = ref(false);

  const isEditing = computed<boolean>(() => formMode.value !== LabDetailsFormModeEnum.enum.ReadOnly);

  const defaultState: LabDetails = {
    Name: '',
    Description: '',
    S3Bucket: '',
    RunRetentionMonths: 6,
    NextFlowTowerEnabled: false,
    NextFlowTowerAccessToken: '',
    NextFlowTowerWorkspaceId: '',
    NextFlowTowerApiBaseUrl: orgsStore.orgs[userStore.currentOrgId || ''].NextFlowTowerApiBaseUrl || '',
    AwsHealthOmicsEnabled: false,
  };

  const state = ref({ ...defaultState } as Laboratory);

  /**
   * Edit Mode and Next Flow Tower Access Token Field
   *
   * Custom logic is required for managing the possible states of the Next Flow Tower Access Token field
   * when in Edit Mode.
   *
   * This is due to the value from the database being the encrypted token. The user should not be able
   * to toggle the password visibility of the field unless they have made a change to the field. This is
   * because they user will not be able to compare the encrypted value with the value previously set.
   */

  // Edit Mode
  // Store the lab details from the server to support the cancel button in Edit mode
  const uneditedLabDetails: Ref<Laboratory | undefined> = ref(undefined);

  // Edit Mode
  // Determine if the NextFlowTowerAccessToken field is being edited to assist with
  // the password field display state
  const isEditingNextFlowTowerAccessToken = ref(false);

  /**
   * Switches the form input fields disabled/hidden states based on the form mode.
   */
  function switchToFormMode(newFormMode: LabDetailsFormMode) {
    formMode.value = newFormMode;
  }

  onMounted(async () => {
    await getS3Buckets();

    if (formMode.value !== LabDetailsFormModeEnum.enum.Create) {
      await getLabDetails();
    }
    switchToFormMode(formMode.value);
  });

  /**
   * Stores the currently selected S3 bucket.
   *
   * - The getter checks if there are any S3 directories available.
   *   - If no directories are available, it returns 'No S3 Buckets found'.
   *   - Otherwise, it returns a matched bucket; if none found, a call to action
   *     is displayed.
   *
   * - The setter updates the application's state with the new S3 bucket value.
   */
  const selectedS3Bucket = computed({
    get() {
      if (isLoadingBuckets.value) {
        return 'Retrieving S3 Buckets...';
      } else if (!s3Directories.value.length && !isLoadingBuckets.value) {
        return 'No S3 Buckets found';
      }
      const matchedBucket = s3Directories.value.find((dir) => dir === state.value.S3Bucket);
      return matchedBucket || undefined;
    },
    set(newValue) {
      state.value.S3Bucket = newValue;
    },
  });

  /**
   * Submit requires a usable S3 directory for org admins. The bucket must appear in the infra list,
   * OR in edit mode we allow the existing persisted bucket when the list does not include it (stale API, rename, permissions).
   */
  const isS3BucketValidForSubmit = computed(() => {
    if (!useUserStore().isOrgAdmin()) {
      return true;
    }

    const bucket = state.value.S3Bucket;
    if (bucket == null || String(bucket).trim() === '') {
      return false;
    }
    if (isLoadingBuckets.value) {
      return false;
    }

    if (s3Directories.value.some((dir) => dir === bucket)) {
      return true;
    }

    return (
      formMode.value !== LabDetailsFormModeEnum.enum.Create &&
      uneditedLabDetails.value != null &&
      uneditedLabDetails.value.S3Bucket === bucket
    );
  });

  async function getS3Buckets() {
    try {
      isLoadingBuckets.value = true;
      s3Directories.value = await $api.infra.s3Buckets().then((res) => res.map((bucket) => bucket.Name));
    } catch (error) {
      useToastStore().error('Failed to retrieve S3 buckets');
    } finally {
      isLoadingBuckets.value = false;
    }
  }

  const hasEditPermission = computed<boolean>(() => useUserStore().canEditLabDetails());

  /**
   * Retrieves the lab details from the server and sets the form state.
   */
  async function getLabDetails(options?: { showLoader?: boolean }) {
    const showLoader = options?.showLoader !== false;
    try {
      if (showLoader) {
        isLoadingFormData.value = true;
      }
      const res = await $api.labs.labDetails(labId);
      const parseResult = ReadLaboratorySchema.safeParse(res);

      if (parseResult.success) {
        const labDetails = parseResult.data as Laboratory;
        const withRetentionDefault = {
          ...labDetails,
          // ?? only: RunRetentionMonths 0 (never delete) must not become 6.
          RunRetentionMonths: labDetails.RunRetentionMonths ?? 6,
        };
        state.value = { ...state.value, ...withRetentionDefault };
        // Store the unedited lab details to support the cancel button in Edit mode
        uneditedLabDetails.value = { ...withRetentionDefault };
      } else {
        throw new Error('Failed to parse lab details');
      }
    } catch (error) {
      useToastStore().error(`Failed to retrieve lab details for lab: ${state.value.Name}`);
    } finally {
      if (showLoader) {
        isLoadingFormData.value = false;
      }
    }
  }

  /**
   * Cancel current edit operation.
   *
   * It resets the state value to the original unedited lab details,  turns off the editing mode for the Nextflow Tower
   * access token, disables the submit button, and switches the form mode to read-only.
   *
   * @return {void}
   */
  function handleCancelEdit() {
    state.value = { ...uneditedLabDetails.value! };
    isEditingNextFlowTowerAccessToken.value = false;
    canSubmit.value = false;
    retentionPreviewCacheMonths.value = null;
    retentionPreviewCounts.value = null;
    switchToFormMode(LabDetailsFormModeEnum.enum.ReadOnly);
  }

  const isSubmittingFormData = computed(
    () => useUiStore().isRequestPending('createLab') || useUiStore().isRequestPending('updateLab'),
  );
  const isLoadingRetentionPreview = ref(false);
  const isSaveRetentionChangeDialogOpen = ref(false);
  const retentionPreviewCacheMonths = ref<number | null>(null);
  const retentionPreviewCounts = ref<{ immediate: number; updated: number } | null>(null);
  const retentionMonthsForDialog = computed<number>(
    () =>
      // ?? only so 0 stays “never delete” for the confirmation modal.
      state.value.RunRetentionMonths ?? 6,
  );
  const retentionPolicyDescription = computed<string>(() =>
    retentionMonthsForDialog.value === 0
      ? 'never delete run records'
      : `${retentionMonthsForDialog.value} month${Number(retentionMonthsForDialog.value) === 1 ? '' : 's'}`,
  );

  const retentionSaveDialogSecondaryMessage = computed(() => {
    const counts = retentionPreviewCounts.value;
    const policyLine = `New run retention policy after save: ${retentionPolicyDescription.value}.`;
    if (!counts) return policyLine;
    return `${policyLine}\n\n${counts.immediate} run${counts.immediate === 1 ? '' : 's'} will be deleted immediately (new expiry is in the past).\n${counts.updated} run${counts.updated === 1 ? '' : 's'} will have their expiration date updated.`;
  });

  function retentionMonthsKey(): number {
    return state.value.RunRetentionMonths ?? 6;
  }

  async function ensureRetentionChangePreviewLoaded(): Promise<boolean> {
    const months = retentionMonthsKey();
    if (retentionPreviewCacheMonths.value === months && retentionPreviewCounts.value != null) {
      return true;
    }
    try {
      isLoadingRetentionPreview.value = true;
      const result = await $api.labs.applyRunRetentionPolicy(labId, months, { dryRun: true });
      retentionPreviewCacheMonths.value = months;
      retentionPreviewCounts.value = {
        immediate: result.RunsExpireImmediately ?? 0,
        updated: result.RunsExpirationDateUpdated ?? 0,
      };
      return true;
    } catch {
      useToastStore().error('Failed to load retention change preview');
      return false;
    } finally {
      isLoadingRetentionPreview.value = false;
    }
  }

  function runRetentionMonthsChanged(): boolean {
    if (formMode.value !== LabDetailsFormModeEnum.enum.Edit || uneditedLabDetails.value == null) {
      return false;
    }
    const prev = uneditedLabDetails.value.RunRetentionMonths;
    const next = state.value.RunRetentionMonths;
    const key = (v: number | undefined) => (v === undefined ? '_unset_' : String(Math.floor(Number(v))));
    return key(prev) !== key(next);
  }

  async function runSubmitAfterValidation() {
    try {
      if (formMode.value === LabDetailsFormModeEnum.enum.Create) {
        await handleCreateLab();
      } else if (formMode.value === LabDetailsFormModeEnum.enum.Edit) {
        await handleUpdateLabDetails();
      }
    } catch (error: any) {
      if (error.message === `Request error: ${ERROR_CODES['EG-304']}`) {
        useToastStore().error('Laboratory name already taken. Please try again.');
      } else if (error.message === `Request error: ${ERROR_CODES['EG-308']}`) {
        useToastStore().error('Invalid Workspace ID or Personal Access Token. Please try again.');
      } else {
        useToastStore().error('An unknown error occurred. Please refresh the page and try again.');
      }
    } finally {
      useUiStore().setRequestComplete('createLab');
      useUiStore().setRequestComplete('updateLab');
    }
  }

  /**
   * Handles form submission for various lab detail modes such as Create and Edit.
   *
   * This method will not perform any actions if the form mode is set to ReadOnly.
   * It manages the process state and triggers appropriate form handlers based on the current form mode.
   *
   * @return {Promise<void>} A promise that resolves when the form submission process is complete.
   */
  async function onSubmit() {
    if (formMode.value === LabDetailsFormModeEnum.enum.ReadOnly) return;

    if (formMode.value === LabDetailsFormModeEnum.enum.Edit && runRetentionMonthsChanged()) {
      const ok = await ensureRetentionChangePreviewLoaded();
      if (ok) isSaveRetentionChangeDialogOpen.value = true;
      return;
    }

    await runSubmitAfterValidation();
  }

  async function handleConfirmSaveRetentionPolicyChange() {
    useUiStore().setRequestPending('updateLab');
    try {
      const parseResult = UpdateLaboratorySchema.safeParse(state.value);
      if (!parseResult.success) {
        const message = 'Update lab failed to parse lab details';
        console.error(`${message}; parseResult: `, parseResult);
        throw new Error(message);
      }

      const lab = parseResult.data as UpdateLaboratory;
      const res = await $api.labs.update(labId, lab);

      if (!res) {
        useToastStore().error(`Failed to verify details for ${state.value.Name}`);
        return;
      }

      const retentionMonths = state.value.RunRetentionMonths ?? 6;
      try {
        await $api.labs.applyRunRetentionPolicy(labId, retentionMonths);
      } catch {
        useToastStore().error(
          'Laboratory was saved, but applying the new retention policy to existing runs failed. Try saving again or contact support.',
        );
        await getLabDetails({ showLoader: false });
        return;
      }

      emit('updated');
      isEditingNextFlowTowerAccessToken.value = false;
      switchToFormMode(LabDetailsFormModeEnum.enum.ReadOnly);
      retentionPreviewCacheMonths.value = null;
      retentionPreviewCounts.value = null;
      await getLabDetails();

      useToastStore().success(`${lab.Name} successfully updated`);
    } catch (error: any) {
      if (error.message === `Request error: ${ERROR_CODES['EG-304']}`) {
        useToastStore().error('Laboratory name already taken. Please try again.');
      } else if (error.message === `Request error: ${ERROR_CODES['EG-308']}`) {
        useToastStore().error('Invalid Workspace ID or Personal Access Token. Please try again.');
      } else {
        useToastStore().error('An unknown error occurred. Please refresh the page and try again.');
      }
    } finally {
      useUiStore().setRequestComplete('updateLab');
      isSaveRetentionChangeDialogOpen.value = false;
    }
  }

  async function handleCreateLab() {
    useUiStore().setRequestPending('createLab');

    const lab: CreateLaboratory = {
      ...state.value,
      OrganizationId: useUserStore().currentOrgId,
      Status: 'Active',
    };

    const parseResult = CreateLaboratorySchema.safeParse(lab);
    if (!parseResult.success) {
      const message = 'Create lab failed to parse lab details';
      console.error(`${message}; parseResult: `, parseResult);
      throw new Error(message);
    }

    const newLab = parseResult.data as CreateLaboratory;

    const res = await $api.labs.create(newLab);
    if (!res) {
      useToastStore().error(`Failed to verify details for ${state.value.Name}`);
    }

    useToastStore().success(`Successfully created lab: ${newLab.Name}`);
    router.push({ path: '/labs' });
  }

  // Submits the values from state instead of the form event values to align create
  // and edit data types with those expected by and validated in the backend. The
  // types can have more properties than the form fields.
  // e.g, LaboratoryId or CreatedAt
  async function handleUpdateLabDetails() {
    useUiStore().setRequestPending('updateLab');
    const parseResult = UpdateLaboratorySchema.safeParse(state.value);

    if (!parseResult.success) {
      const message = 'Update lab failed to parse lab details';
      console.error(`${message}; parseResult: `, parseResult);
      throw new Error(message);
    }

    const lab: UpdateLaboratory = parseResult.data;
    const res = await $api.labs.update(labId, lab);

    if (!res) {
      useToastStore().error(`Failed to verify details for ${state.value.Name}`);
    }

    emit('updated');

    isEditingNextFlowTowerAccessToken.value = false;
    switchToFormMode(LabDetailsFormModeEnum.enum.ReadOnly);
    await getLabDetails();

    useToastStore().success(`${lab.Name} successfully updated`);
  }

  const validate = (state: LabDetails): FormError[] => {
    const errors: FormError[] = [];

    maybeAddFieldValidationErrors(errors, LabNameSchema, 'Name', state.Name);
    maybeAddFieldValidationErrors(errors, LabDescriptionSchema, 'Description', state.Description);
    maybeAddFieldValidationErrors(errors, RunRetentionMonthsSchema, 'RunRetentionMonths', state.RunRetentionMonths);

    // Next Flow fields only required if Next Flow enabled
    if (state.NextFlowTowerEnabled) {
      maybeAddFieldValidationErrors(
        errors,
        NextFlowTowerApiBaseUrlSchema,
        'NextFlowTowerApiBaseUrl',
        state.NextFlowTowerApiBaseUrl,
      );

      maybeAddFieldValidationErrors(
        errors,
        NextFlowTowerWorkspaceIdSchema,
        'NextFlowTowerWorkspaceId',
        state.NextFlowTowerWorkspaceId,
      );

      // Access Token only required if creating lab
      if (formMode.value === LabDetailsFormModeEnum.enum.Create) {
        maybeAddFieldValidationErrors(
          errors,
          NextFlowTowerAccessTokenSchema,
          'NextFlowTowerAccessToken',
          state.NextFlowTowerAccessToken,
        );
      }
    }

    checkCanSubmitFormData(errors.length);

    return errors;
  };

  /**
   * Checks if the form can be submitted based on the number of validation errors.
   * @param validationErrorCount
   */
  function checkCanSubmitFormData(validationErrorCount: number = 0) {
    const noValidationErrors = validationErrorCount === 0;
    if (formMode.value === LabDetailsFormModeEnum.enum.Create) {
      // In Create mode, the form can be submitted if there are no validation errors
      canSubmit.value = noValidationErrors;
    } else if (formMode.value === LabDetailsFormModeEnum.enum.Edit) {
      // In Edit mode, the form can be submitted if there are no validation errors and the form data has changed
      const dataChanged = formDataChanged();
      canSubmit.value = noValidationErrors && dataChanged;
    }
  }

  /** Fields users can change on this form; avoids comparing full Laboratory/server-only keys and fixes retention coercion issues. */
  const LAB_DETAILS_EDIT_COMPARE_KEYS = [
    'Name',
    'Description',
    'RunRetentionMonths',
    'S3Bucket',
    'AwsHealthOmicsEnabled',
    'NextFlowTowerEnabled',
    'NextFlowTowerApiBaseUrl',
    'NextFlowTowerWorkspaceId',
    'NextFlowTowerAccessToken',
  ] as const;

  type LabEditCompareKey = (typeof LAB_DETAILS_EDIT_COMPARE_KEYS)[number];

  function valuesDifferForLabEdit(key: LabEditCompareKey, a: unknown, b: unknown): boolean {
    if (key === 'RunRetentionMonths') {
      const norm = (v: unknown) => {
        if (v === undefined || v === null || v === '') return '_unset_';
        const n = Number(v);
        return Number.isFinite(n) ? String(Math.floor(n)) : '_invalid_';
      };
      return norm(a) !== norm(b);
    }
    if (key === 'NextFlowTowerAccessToken' || key === 'Description') {
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '' : v);
      return norm(a) !== norm(b);
    }
    return a !== b;
  }

  /**
   * Determines if the form data has changed from the original lab details.
   * @returns {boolean} True if the form data has changed, otherwise false.
   */
  function formDataChanged(): boolean {
    if (formMode.value !== LabDetailsFormModeEnum.enum.Edit || uneditedLabDetails.value == null) {
      return false;
    }
    const baseline = uneditedLabDetails.value as unknown as Record<string, unknown>;
    const current = state.value as unknown as Record<string, unknown>;
    for (const key of LAB_DETAILS_EDIT_COMPARE_KEYS) {
      if (valuesDifferForLabEdit(key, current[key], baseline[key])) {
        if (key === 'NextFlowTowerAccessToken') {
          isEditingNextFlowTowerAccessToken.value = true;
        }
        return true;
      }
    }
    return false;
  }

  watch(
    state,
    (newState) => {
      validate(newState);
    },
    { deep: true },
  );
</script>

<template>
  <USkeleton v-if="isLoadingFormData" class="min-h-96 w-full" />
  <UForm v-else :validate="validate" :state="state" @submit="onSubmit">
    <EGCard>
      <!-- Lab Name -->
      <EGFormGroup label="Lab Name" name="Name" eager-validation required>
        <EGInput
          v-model="state.Name"
          :disabled="!isEditing || isSubmittingFormData"
          placeholder="Enter lab name (required and must be unique)"
          autofocus
        />
      </EGFormGroup>

      <!-- Lab Description -->
      <EGFormGroup label="Lab Description" name="Description" eager-validation>
        <EGTextArea
          v-model="state.Description"
          :disabled="!isEditing || isSubmittingFormData"
          placeholder="Describe your lab and what runs should be launched by Lab users."
        />
      </EGFormGroup>

      <EGFormGroup label="Run retention (months)" name="RunRetentionMonths" eager-validation>
        <EGInput
          v-model.number="state.RunRetentionMonths"
          type="number"
          min="0"
          max="120"
          step="1"
          :disabled="!isEditing || isSubmittingFormData"
          placeholder="Enter number of months (0 for never)"
        />
        <p class="text-muted mt-1 text-xs">0 = never delete run records</p>
      </EGFormGroup>

      <EGFormGroup v-if="useUserStore().isOrgAdmin()" label="Default S3 bucket directory" name="S3Bucket" required>
        <EGSelect
          :options="s3Directories"
          v-model="selectedS3Bucket"
          :disabled="!isEditing || isSubmittingFormData"
          placeholder="Please select an S3 bucket from the list below"
          searchable-placeholder="Search existing S3 buckets..."
        />
      </EGFormGroup>

      <hr class="mb-6" />

      <!-- Next Flow Tower: Toggle -->
      <EGFormGroup
        label="Enable Seqera Integration"
        name="NextFlowTowerEnable"
        eager-validation
        class="flex justify-between"
      >
        <UToggle class="ml-2" v-model="state.NextFlowTowerEnabled" :disabled="!isEditing || isSubmittingFormData" />
      </EGFormGroup>

      <!-- Next Flow Tower: Endpoint -->
      <EGFormGroup
        v-if="state.NextFlowTowerEnabled"
        label="Seqera Endpoint URL"
        name="NextFlowTowerApiBaseUrl"
        eager-validation
        required
      >
        <EGInput v-model="state.NextFlowTowerApiBaseUrl" :disabled="!isEditing || isSubmittingFormData" />
      </EGFormGroup>

      <!-- Next Flow Tower: Workspace ID -->
      <EGFormGroup
        v-if="state.NextFlowTowerEnabled"
        label="Workspace ID"
        name="NextFlowTowerWorkspaceId"
        eager-validation
      >
        <EGInput
          v-model="state.NextFlowTowerWorkspaceId"
          placeholder="Defaults to the Next Flow Tower personal workspace if not specified."
          :disabled="!isEditing || isSubmittingFormData"
        />
      </EGFormGroup>

      <!-- Next Flow Tower: Access Token -->
      <EGFormGroup
        v-if="isEditing && state.NextFlowTowerEnabled"
        label="Personal Access Token"
        name="NextFlowTowerAccessToken"
        eager-validation
        :required="formMode === LabDetailsFormModeEnum.enum.Create"
      >
        <!-- Next Flow Tower: Access Token: Create  Mode -->
        <EGPasswordInput
          v-if="formMode === LabDetailsFormModeEnum.enum.Create"
          v-model="state.NextFlowTowerAccessToken"
          :password="true"
          :autocomplete="AutoCompleteOptionsEnum.enum.NewPassword"
          :disabled="!isEditing || isSubmittingFormData"
        />
        <!-- Next Flow Tower: Access Token: Edit  Mode -->
        <EGPasswordInput
          v-if="formMode === LabDetailsFormModeEnum.enum.Edit"
          v-model="state.NextFlowTowerAccessToken"
          :select-on-focus="true"
          :password="true"
          placeholder="Add or update the Next Flow Tower personal access token. Note: A previously set token will never be shown."
          :show-toggle-password-button="isEditingNextFlowTowerAccessToken"
          :autocomplete="AutoCompleteOptionsEnum.enum.Off"
          eager-validation
          :disabled="!isEditing || isSubmittingFormData"
        />
      </EGFormGroup>

      <hr class="mb-6" />

      <!-- HealthOmics Toggle -->
      <EGFormGroup
        label="Enable HealthOmics Integration"
        name="HealthOmicsEnable"
        eager-validation
        class="flex justify-between"
      >
        <UToggle class="ml-2" v-model="state.AwsHealthOmicsEnabled" :disabled="!isEditing || isSubmittingFormData" />
      </EGFormGroup>
    </EGCard>

    <!-- Form Buttons: Create Mode -->
    <div v-if="formMode === LabDetailsFormModeEnum.enum.Create" class="mt-6 flex space-x-2">
      <EGButton
        :disabled="!canSubmit || !isS3BucketValidForSubmit"
        :loading="isSubmittingFormData"
        :size="ButtonSizeEnum.enum.sm"
        type="submit"
        label="Create Lab"
      />
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        :disabled="useUiStore().anyRequestPending(['createLab', 'updateLab'])"
        label="Cancel"
        name="cancel"
        @click="$router.push(useUiStore().previousPageRoute)"
      />
    </div>

    <!-- Form Buttons: Read Mode -->
    <div v-if="formMode === LabDetailsFormModeEnum.enum.ReadOnly" class="mt-6 flex space-x-2">
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        type="submit"
        label="Edit"
        :disabled="useUserStore().isSuperuser || !hasEditPermission"
        @click="switchToFormMode(LabDetailsFormModeEnum.enum.Edit)"
      />
    </div>

    <!-- Form Buttons: Edit Mode -->
    <div v-if="formMode === LabDetailsFormModeEnum.enum.Edit" class="mt-6 flex space-x-2">
      <EGButton
        :disabled="!canSubmit || !isS3BucketValidForSubmit || isLoadingRetentionPreview"
        :loading="isSubmittingFormData || isLoadingRetentionPreview"
        :size="ButtonSizeEnum.enum.sm"
        type="submit"
        label="Save Changes"
      />
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        :disabled="isSubmittingFormData"
        label="Cancel"
        name="cancel"
        @click="handleCancelEdit"
      />
    </div>
  </UForm>

  <EGDialog
    action-label="Save Changes"
    :action-variant="ButtonVariantEnum.enum.primary"
    cancel-label="Cancel"
    :cancel-variant="ButtonVariantEnum.enum.secondary"
    @action-triggered="handleConfirmSaveRetentionPolicyChange"
    primary-message="Warning: Data Loss Risk"
    :secondary-message="retentionSaveDialogSecondaryMessage"
    v-model="isSaveRetentionChangeDialogOpen"
    :loading="isSubmittingFormData"
    :buttons-disabled="isSubmittingFormData"
  />
</template>
