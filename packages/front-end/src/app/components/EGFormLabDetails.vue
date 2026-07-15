<script setup lang="ts">
  import {
    LabDetails,
    LabNameSchema,
    LabDescriptionSchema,
    NextFlowTowerApiBaseUrlSchema,
    NextFlowTowerAccessTokenSchema,
    GitHubAccessTokenSchema,
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

  const settingsHeadingId = 'lab-settings-heading';
  const seqeraToggleLabelId = 'lab-settings-seqera-toggle-label';
  const healthOmicsToggleLabelId = 'lab-settings-healthomics-toggle-label';
  const retentionHelpId = 'lab-settings-retention-help';
  const seqeraSectionId = 'lab-settings-seqera-section';
  const healthOmicsSectionId = 'lab-settings-healthomics-section';

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
    GitHubAccessToken: '',
    NextFlowTowerWorkspaceId: '',
    NextFlowTowerApiBaseUrl: orgsStore.orgs[userStore.currentOrgId || '']?.NextFlowTowerApiBaseUrl || '',
    AwsHealthOmicsEnabled: false,
    HealthOmicsLlmProvider: undefined,
    HealthOmicsLlmModelId: '',
    HealthOmicsLlmApiKey: '',
    SeqeraLlmProvider: undefined,
    SeqeraLlmModelId: '',
    SeqeraLlmApiKey: '',
    HealthOmicsLogEnrichmentEnabled: false,
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
  const isEditingGitHubAccessToken = ref(false);

  // BYOK provider dropdown options + per-provider hints/placeholders for the
  // Model ID input. The leading `null` option lets users reset back to "no
  // provider" — USelect's placeholder is only shown when the value is empty,
  // so without an explicit reset option the dropdown becomes one-way.
  const llmProviderOptions = [
    { value: null, label: 'None — disable AI analysis' },
    { value: 'bedrock', label: 'Amazon Bedrock (uses platform IAM, no key required)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
  ];
  function modelIdPlaceholderFor(provider: string | undefined): string {
    switch (provider) {
      case 'bedrock':
        return 'e.g. anthropic.claude-haiku-4-5-20251001';
      case 'openai':
        return 'e.g. gpt-4o-mini';
      case 'anthropic':
        return 'e.g. claude-haiku-4-5-20251001';
      default:
        return '';
    }
  }
  /**
   * USelect's "reset to none" option uses `null` as the value, but the backend
   * Zod schemas only accept `string | undefined`. Normalize before submitting
   * so the safeParse doesn't reject `LlmProvider: null`. Same applies to model
   * id / api key empties when a provider was unset.
   */
  function withNormalizedLlmFields<T extends Record<string, unknown>>(input: T): T {
    const fields = [
      'HealthOmicsLlmProvider',
      'HealthOmicsLlmModelId',
      'HealthOmicsLlmApiKey',
      'SeqeraLlmProvider',
      'SeqeraLlmModelId',
      'SeqeraLlmApiKey',
    ] as const;
    const next = { ...input } as Record<string, unknown>;
    for (const key of fields) {
      if (next[key] === null || next[key] === '') next[key] = undefined;
    }
    return next as T;
  }

  function modelIdHintFor(provider: string | undefined): string {
    switch (provider) {
      case 'bedrock':
        return 'Foundation model identifier used by Bedrock InvokeModel.';
      case 'openai':
        return 'Model name as it appears in the OpenAI dashboard.';
      case 'anthropic':
        return 'Model name from the Anthropic API documentation.';
      default:
        return '';
    }
  }

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
      if (formMode.value !== LabDetailsFormModeEnum.enum.Create && labId) {
        const granted = await $api.s3Access.listGrantedBuckets(labId);
        s3Directories.value = granted.buckets;
      } else {
        s3Directories.value = await $api.infra.s3Buckets().then((res) => res.map((bucket) => bucket.Name));
      }
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
          // BYOK: server never echoes back the keys — only Has*LlmApiKey indicators.
          // Initialize the password inputs to empty so they don't show stale data.
          HealthOmicsLlmApiKey: '',
          SeqeraLlmApiKey: '',
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
    isEditingGitHubAccessToken.value = false;
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
      isEditingGitHubAccessToken.value = false;
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

    const lab: CreateLaboratory = withNormalizedLlmFields({
      ...state.value,
      OrganizationId: useUserStore().currentOrgId,
      Status: 'Active',
    });

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
    const parseResult = UpdateLaboratorySchema.safeParse(withNormalizedLlmFields(state.value));

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
    isEditingGitHubAccessToken.value = false;
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

    if (state.AwsHealthOmicsEnabled && formMode.value === LabDetailsFormModeEnum.enum.Create) {
      maybeAddFieldValidationErrors(errors, GitHubAccessTokenSchema, 'GitHubAccessToken', state.GitHubAccessToken);
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
    'GitHubAccessToken',
    'HealthOmicsLlmProvider',
    'HealthOmicsLlmModelId',
    'HealthOmicsLlmApiKey',
    'SeqeraLlmProvider',
    'SeqeraLlmModelId',
    'SeqeraLlmApiKey',
    'HealthOmicsLogEnrichmentEnabled',
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
    if (
      key === 'NextFlowTowerAccessToken' ||
      key === 'GitHubAccessToken' ||
      key === 'Description' ||
      key === 'HealthOmicsLlmApiKey' ||
      key === 'SeqeraLlmApiKey' ||
      key === 'HealthOmicsLlmModelId' ||
      key === 'SeqeraLlmModelId'
    ) {
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '' : v);
      return norm(a) !== norm(b);
    }
    if (key === 'HealthOmicsLlmProvider' || key === 'SeqeraLlmProvider') {
      // Empty / undefined means "no provider selected"; treat them equivalently.
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '_unset_' : v);
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
        if (key === 'GitHubAccessToken') {
          isEditingGitHubAccessToken.value = true;
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
  <div v-if="isLoadingFormData" :aria-busy="true" aria-labelledby="lab-settings-loading-status">
    <p id="lab-settings-loading-status" class="sr-only" role="status" aria-live="polite">Loading lab settings…</p>
    <USkeleton class="min-h-96 w-full" aria-hidden="true" />
  </div>
  <UForm
    v-else
    :validate="validate"
    :state="state"
    :aria-labelledby="formMode !== LabDetailsFormModeEnum.enum.Create ? settingsHeadingId : undefined"
    :aria-busy="isSubmittingFormData || isLoadingRetentionPreview"
    @submit="onSubmit"
  >
    <EGText v-if="formMode !== LabDetailsFormModeEnum.enum.Create" :id="settingsHeadingId" tag="h2" class="sr-only">
      Lab settings
    </EGText>
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
          :aria-describedby="retentionHelpId"
        />
        <p :id="retentionHelpId" class="text-muted mt-1 text-xs">0 = never delete run records</p>
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

      <hr class="mb-6" role="presentation" />

      <section :aria-labelledby="seqeraSectionId">
        <h3 :id="seqeraSectionId" class="sr-only">Seqera integration</h3>

        <!-- Next Flow Tower: Toggle -->
        <EGFormGroup
          label="Enable Seqera Integration"
          name="NextFlowTowerEnable"
          eager-validation
          class="flex items-center justify-between"
        >
          <label :id="seqeraToggleLabelId" :for="`${seqeraToggleLabelId}-input`" class="sr-only">
            Enable Seqera Integration
          </label>
          <UToggle
            :id="`${seqeraToggleLabelId}-input`"
            class="ml-2"
            v-model="state.NextFlowTowerEnabled"
            :disabled="!isEditing || isSubmittingFormData"
            :aria-labelledby="seqeraToggleLabelId"
          />
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
      </section>

      <hr class="mb-6" role="presentation" />

      <section :aria-labelledby="healthOmicsSectionId">
        <h3 :id="healthOmicsSectionId" class="sr-only">HealthOmics integration</h3>

        <!-- HealthOmics Toggle -->
        <EGFormGroup
          label="Enable HealthOmics Integration"
          name="HealthOmicsEnable"
          eager-validation
          class="flex items-center justify-between"
        >
          <label :id="healthOmicsToggleLabelId" :for="`${healthOmicsToggleLabelId}-input`" class="sr-only">
            Enable HealthOmics Integration
          </label>
          <UToggle
            :id="`${healthOmicsToggleLabelId}-input`"
            class="ml-2"
            v-model="state.AwsHealthOmicsEnabled"
            :disabled="!isEditing || isSubmittingFormData"
            :aria-labelledby="healthOmicsToggleLabelId"
          />
        </EGFormGroup>
        <EGFormGroup
          v-if="isEditing && state.AwsHealthOmicsEnabled"
          label="GitHub Personal Access Token"
          name="GitHubAccessToken"
          eager-validation
          :required="formMode === LabDetailsFormModeEnum.enum.Create"
        >
          <div v-if="formMode === LabDetailsFormModeEnum.enum.Edit" class="mb-2 flex items-center gap-2">
            <UBadge
              size="sm"
              class="bg-alert-danger-muted text-alert-danger rounded-xl border-0 ring-0"
              aria-hidden="true"
            >
              TOKEN SAVED
            </UBadge>
            <p class="text-alert-danger-dark text-xs font-medium">
              Saving a new value will replace the existing token.
            </p>
          </div>
          <EGPasswordInput
            v-if="formMode === LabDetailsFormModeEnum.enum.Create"
            v-model="state.GitHubAccessToken"
            :password="true"
            :autocomplete="AutoCompleteOptionsEnum.enum.NewPassword"
            :disabled="!isEditing || isSubmittingFormData"
          />
          <EGPasswordInput
            v-if="formMode === LabDetailsFormModeEnum.enum.Edit"
            v-model="state.GitHubAccessToken"
            :select-on-focus="true"
            :password="true"
            placeholder="Add or update the GitHub personal access token. Note: A previously set token will never be shown."
            :show-toggle-password-button="isEditingGitHubAccessToken"
            :autocomplete="AutoCompleteOptionsEnum.enum.Off"
            eager-validation
            :disabled="!isEditing || isSubmittingFormData"
          />
        </EGFormGroup>
      </section>

      <!-- AI Failure Analysis: BYOK per integration. HealthOmics and Seqera each get
           their own provider/model/key + enable toggle. The deterministic HealthOmics
           lookup table runs regardless; the LLM is only used as a fallback for
           ambiguous HealthOmics codes (WORKFLOW_RUN_FAILED etc.) and free-text
           Seqera errors. -->
      <template v-if="state.AwsHealthOmicsEnabled || state.NextFlowTowerEnabled">
        <hr class="mb-6" />
        <div class="mb-3 flex items-center gap-1.5">
          <p class="text-sm font-medium text-black">AI Failure Analysis</p>
          <!-- Provider guidance: helps an admin decide which LLM to bring (Bedrock vs OpenAI vs Anthropic)
               before they pick one in the dropdowns below. -->
          <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
            <template #text>
              <div class="space-y-1.5 py-1">
                <p class="font-medium text-black">Which provider should I choose?</p>
                <p>
                  <span class="font-medium text-black">Amazon Bedrock</span>
                  — no API key; the error text stays inside your AWS account. Simplest setup and tightest data control.
                </p>
                <p>
                  <span class="font-medium text-black">Anthropic (Claude)</span>
                  — best accuracy on nuanced or ambiguous errors. Requires an Anthropic API key.
                </p>
                <p>
                  <span class="font-medium text-black">OpenAI (GPT)</span>
                  — low-cost small models (e.g. gpt-4o-mini) suited to high-volume traffic. Requires an OpenAI API key.
                </p>
                <p class="italic">
                  OpenAI and Anthropic send the error text to that provider; Bedrock does not leave AWS.
                </p>
              </div>
            </template>
            <UIcon
              name="i-heroicons-information-circle"
              class="text-muted h-4 w-4"
              aria-label="LLM provider guidance"
            />
          </UTooltip>
        </div>
        <p class="text-muted mb-4 text-xs">
          When a run fails, classify the cause by responsible party using an LLM. Documented HealthOmics error codes are
          always classified using a built-in lookup; the LLM is used only for ambiguous HealthOmics codes and free-text
          Seqera errors. Each integration can use a different provider — for example a cheaper model for high-volume
          Seqera traffic, a more accurate model for HealthOmics ambiguous cases.
        </p>

        <!-- HealthOmics sub-section -->
        <div v-if="state.AwsHealthOmicsEnabled" class="mb-6 rounded border border-gray-200 p-4">
          <p class="mb-3 text-sm font-medium text-black">HealthOmics</p>

          <EGFormGroup label="LLM Provider" name="HealthOmicsLlmProvider" eager-validation>
            <USelect
              v-model="state.HealthOmicsLlmProvider"
              :options="llmProviderOptions"
              value-attribute="value"
              option-attribute="label"
              placeholder="None — disable AI analysis for HealthOmics"
              :disabled="!isEditing || isSubmittingFormData"
            />
          </EGFormGroup>

          <EGFormGroup
            v-if="state.HealthOmicsLlmProvider"
            label="Model ID"
            name="HealthOmicsLlmModelId"
            eager-validation
            :hint="modelIdHintFor(state.HealthOmicsLlmProvider)"
          >
            <EGInput
              v-model="state.HealthOmicsLlmModelId"
              :placeholder="modelIdPlaceholderFor(state.HealthOmicsLlmProvider)"
              :disabled="!isEditing || isSubmittingFormData"
            />
          </EGFormGroup>

          <EGFormGroup
            v-if="
              isEditing && (state.HealthOmicsLlmProvider === 'openai' || state.HealthOmicsLlmProvider === 'anthropic')
            "
            label="API Key"
            name="HealthOmicsLlmApiKey"
            eager-validation
            :required="formMode === LabDetailsFormModeEnum.enum.Create || !uneditedLabDetails?.HasHealthOmicsLlmApiKey"
          >
            <div v-if="uneditedLabDetails?.HasHealthOmicsLlmApiKey" class="mb-2 flex items-center gap-2">
              <UBadge size="sm" class="bg-alert-danger-muted text-alert-danger rounded-xl border-0 ring-0">
                KEY SAVED
              </UBadge>
              <p class="text-alert-danger-dark text-xs font-medium">
                Saving a new value will replace the existing key.
              </p>
            </div>
            <EGPasswordInput
              v-model="state.HealthOmicsLlmApiKey"
              :select-on-focus="true"
              :password="true"
              placeholder="Paste your provider API key. A previously set key is never shown."
              :autocomplete="AutoCompleteOptionsEnum.enum.NewPassword"
              :disabled="!isEditing || isSubmittingFormData"
            />
          </EGFormGroup>

          <EGFormGroup
            v-if="state.HealthOmicsLlmProvider"
            name="HealthOmicsLogEnrichmentEnabled"
            hint="Sends a redacted excerpt of the failed run's CloudWatch logs to the AI for deeper analysis. Identifiers, paths, and secrets are stripped before sending."
          >
            <div class="flex items-center">
              <span class="text-sm text-black">Analyse run logs on failure</span>
              <UToggle
                class="ml-2"
                v-model="state.HealthOmicsLogEnrichmentEnabled"
                :disabled="!isEditing || isSubmittingFormData"
              />
            </div>
          </EGFormGroup>
        </div>

        <!-- Seqera sub-section -->
        <div v-if="state.NextFlowTowerEnabled" class="mb-6 rounded border border-gray-200 p-4">
          <p class="mb-3 text-sm font-medium text-black">Seqera</p>

          <EGFormGroup label="LLM Provider" name="SeqeraLlmProvider" eager-validation>
            <USelect
              v-model="state.SeqeraLlmProvider"
              :options="llmProviderOptions"
              value-attribute="value"
              option-attribute="label"
              placeholder="None — disable AI analysis for Seqera"
              :disabled="!isEditing || isSubmittingFormData"
            />
          </EGFormGroup>

          <EGFormGroup
            v-if="state.SeqeraLlmProvider"
            label="Model ID"
            name="SeqeraLlmModelId"
            eager-validation
            :hint="modelIdHintFor(state.SeqeraLlmProvider)"
          >
            <EGInput
              v-model="state.SeqeraLlmModelId"
              :placeholder="modelIdPlaceholderFor(state.SeqeraLlmProvider)"
              :disabled="!isEditing || isSubmittingFormData"
            />
          </EGFormGroup>

          <EGFormGroup
            v-if="isEditing && (state.SeqeraLlmProvider === 'openai' || state.SeqeraLlmProvider === 'anthropic')"
            label="API Key"
            name="SeqeraLlmApiKey"
            eager-validation
            :required="formMode === LabDetailsFormModeEnum.enum.Create || !uneditedLabDetails?.HasSeqeraLlmApiKey"
          >
            <div v-if="uneditedLabDetails?.HasSeqeraLlmApiKey" class="mb-2 flex items-center gap-2">
              <UBadge size="sm" class="bg-alert-danger-muted text-alert-danger rounded-xl border-0 ring-0">
                KEY SAVED
              </UBadge>
              <p class="text-alert-danger-dark text-xs font-medium">
                Saving a new value will replace the existing key.
              </p>
            </div>
            <EGPasswordInput
              v-model="state.SeqeraLlmApiKey"
              :select-on-focus="true"
              :password="true"
              placeholder="Paste your provider API key. A previously set key is never shown."
              :autocomplete="AutoCompleteOptionsEnum.enum.NewPassword"
              :disabled="!isEditing || isSubmittingFormData"
            />
          </EGFormGroup>
        </div>
      </template>
    </EGCard>

    <!-- Form Buttons: Create Mode -->
    <div v-if="formMode === LabDetailsFormModeEnum.enum.Create" class="mt-6 flex space-x-2">
      <EGButton
        :disabled="!canSubmit || !isS3BucketValidForSubmit"
        :loading="isSubmittingFormData"
        :size="ButtonSizeEnum.enum.sm"
        u-button-type="submit"
        label="Create Lab"
      />
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        u-button-type="button"
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
        u-button-type="button"
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
        u-button-type="submit"
        label="Save Changes"
      />
      <EGButton
        :size="ButtonSizeEnum.enum.sm"
        :variant="ButtonVariantEnum.enum.secondary"
        u-button-type="button"
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
