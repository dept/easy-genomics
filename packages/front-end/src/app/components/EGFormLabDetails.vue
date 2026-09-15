<script setup lang="ts">
  import {
    LabDetails,
    LabNameSchema,
    LabDescriptionSchema,
    NextFlowTowerApiBaseUrlSchema,
    NextFlowTowerAccessTokenSchema,
    GitHubAccessTokenSchema,
    RunDetailProgressPollIntervalSecondsSchema,
    RunListStatusPollIntervalSecondsSchema,
    NextFlowTowerWorkspaceIdSchema,
    RunRetentionMonthsSchema,
    NetworkingModeSchema,
    VpcConfigurationNameSchema,
    LlmModelIdSchema,
    LlmApiKeySchema,
    LabDetailsFormModeEnum,
    LabDetailsFormMode,
  } from '@FE/types/labs';
  import { AutoCompleteOptionsEnum } from '@FE/types/forms';
  import { FormError } from '#ui/types';
  import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
  import { ButtonSizeEnum, ButtonVariantEnum } from '@FE/types/buttons';
  import { useToastStore, useUiStore } from '@FE/stores';
  import { maybeAddFieldValidationErrors } from '@FE/utils/form-utils';
  import { extractApiErrorMessage, formatValidationIssues } from '@FE/utils/api-utils';
  import {
    CreateLaboratory,
    CreateLaboratorySchema,
    ReadLaboratorySchema,
    UpdateLaboratory,
    UpdateLaboratorySchema,
  } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory';
  import { UpdateLaboratoryUserNotificationPreferenceSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-user';
  import { ERROR_CODES } from '@easy-genomics/shared-lib/src/app/constants/errorMessages';
  import {
    DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
    DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
  } from '@easy-genomics/shared-lib/src/app/utils/laboratory-run-progress-polling';
  import { fetchLabS3BucketOptions } from '@FE/utils/lab-s3-bucket-options';

  const props = withDefaults(
    defineProps<{
      formMode?: LabDetailsFormMode;
    }>(),
    {
      formMode: LabDetailsFormModeEnum.enum.Edit,
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
  const runsListPollHelpId = 'lab-settings-runs-list-poll-help';
  const runDetailPollHelpId = 'lab-settings-run-detail-poll-help';
  const seqeraSectionId = 'lab-settings-seqera-section';
  const healthOmicsSectionId = 'lab-settings-healthomics-section';
  const notificationsToggleLabelId = 'lab-settings-notifications-toggle-label';
  const notifyOwnRunsToggleLabelId = 'lab-settings-notify-own-runs-toggle-label';
  const notifyLabRunsToggleLabelId = 'lab-settings-notify-lab-runs-toggle-label';
  const notifyLabRunsAdditionalEmailsInputId = 'lab-settings-notify-lab-runs-additional-emails-input';

  const formMode = ref(props.formMode);
  const s3Directories = ref([]);
  const isLoadingBuckets = ref(false);
  const isLoadingFormData = ref(props.formMode !== LabDetailsFormModeEnum.enum.Create);
  const canSubmit = ref(false);

  const isEditing = computed<boolean>(() => formMode.value !== LabDetailsFormModeEnum.enum.ReadOnly);

  const defaultState: LabDetails = {
    Name: '',
    Description: '',
    S3Bucket: '',
    RunRetentionMonths: 6,
    RunListStatusPollIntervalSeconds: DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
    RunDetailProgressPollIntervalSeconds: DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
    NextFlowTowerEnabled: false,
    NextFlowTowerAccessToken: '',
    GitHubAccessToken: '',
    NextFlowTowerWorkspaceId: '',
    NextFlowTowerApiBaseUrl: orgsStore.orgs[userStore.currentOrgId || '']?.NextFlowTowerApiBaseUrl || '',
    AwsHealthOmicsEnabled: false,
    AwsHealthOmicsNetworkingMode: 'RESTRICTED',
    AwsHealthOmicsVpcConfigurationName: '',
    HealthOmicsLlmProvider: undefined,
    HealthOmicsLlmModelId: '',
    HealthOmicsLlmApiKey: '',
    SeqeraLlmProvider: undefined,
    SeqeraLlmModelId: '',
    SeqeraLlmApiKey: '',
    HealthOmicsLogEnrichmentEnabled: false,
    // Backend kill-switch semantics: absent/undefined means enabled, only `=== false` disables.
    NotificationsEnabled: true,
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
  // Model ID input. The leading option lets users reset back to "no provider".
  // Its value is '' rather than null: USelect renders a native <select>, whose
  // <option value> can only carry strings, so a null-valued option falls back
  // to the option's label text instead — which then fails the LlmProvider enum
  // on save. '' also collides with the empty-string value USelect's own
  // :placeholder prop injects, so :placeholder is skipped on the USelects below.
  const llmProviderOptions = [
    { value: '', label: 'None — disable AI analysis' },
    { value: 'bedrock', label: 'Amazon Bedrock (uses platform IAM, no key required)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
  ];
  const networkingModeOptions = [
    { value: 'RESTRICTED', label: 'Restricted (default)' },
    { value: 'VPC', label: 'VPC' },
  ];

  // Seqera is soft-deprecated: only labs that already have it enabled keep seeing the
  // integration section. Based on the server-loaded snapshot (unedited-lab-details), not the
  // live toggle state, so an admin disabling Seqera on an already-enabled lab doesn't lose the
  // section mid-edit. Create mode never loads a snapshot, so this is always false there.
  const isSeqeraAlreadyEnabled = computed(() => uneditedLabDetails.value?.NextFlowTowerEnabled === true);

  // Badge state for the always-visible collapsible settings cards — reflects whether the
  // section is actually in effect right now, not just whether its fields are populated.
  const integrationsBadges = computed(() => [
    ...(isSeqeraAlreadyEnabled.value
      ? [
          {
            label: `Seqera ${state.value.NextFlowTowerEnabled ? 'On' : 'Off'}`,
            tone: state.value.NextFlowTowerEnabled ? 'positive' : 'neutral',
          } as const,
        ]
      : []),
    {
      label: `HealthOmics ${state.value.AwsHealthOmicsEnabled ? 'On' : 'Off'}`,
      tone: state.value.AwsHealthOmicsEnabled ? 'positive' : 'neutral',
    } as const,
  ]);
  const healthOmicsVpcNetworkingBadge = computed(() => {
    const active = state.value.AwsHealthOmicsEnabled && state.value.AwsHealthOmicsNetworkingMode === 'VPC';
    return { label: active ? 'On' : 'Off', tone: active ? 'positive' : 'neutral' } as const;
  });
  const aiFailureAnalysisBadge = computed(() => {
    const active = !!state.value.HealthOmicsLlmProvider || !!state.value.SeqeraLlmProvider;
    return { label: active ? 'Enabled' : 'Disabled', tone: active ? 'positive' : 'neutral' } as const;
  });
  const runNotificationsBadge = computed(() => {
    const active = !!state.value.NotificationsEnabled;
    return { label: active ? 'On' : 'Off', tone: active ? 'positive' : 'neutral' } as const;
  });

  /**
   * Run Notifications section.
   *
   * All five controls here — the lab-wide kill switch plus the four per-user preferences —
   * are staged locally and only persisted when Save Changes is clicked, same as every other
   * field on this form. The four per-user controls aren't Laboratory fields (they live on
   * User/LaboratoryUser), so they're kept in their own refs rather than `state`, but they
   * share the same dirty-check / Save / Cancel lifecycle via `uneditedNotify*` baselines below.
   */
  type NotificationEventFilter = 'all_terminal' | 'failures_only' | 'successes_only';

  const isLoadingNotificationPrefs = ref(true);
  const notifyOnOwnRunsEnabled = ref(false);
  const notifyOnLabRunsEnabled = ref(false);
  const notificationEventFilter = ref<NotificationEventFilter>('all_terminal');
  // Raw comma-separated text the user is editing; parsed/validated only at Save time.
  const notifyOnLabRunsAdditionalEmailsInput = ref('');

  // Baseline snapshots for the Cancel button / dirty-check, set whenever preferences are
  // (re)loaded or successfully saved.
  const uneditedNotifyOnOwnRunsEnabled = ref(false);
  const uneditedNotifyOnLabRunsEnabled = ref(false);
  const uneditedNotificationEventFilter = ref<NotificationEventFilter>('all_terminal');
  const uneditedNotifyOnLabRunsAdditionalEmailsInput = ref('');

  // Per-user preferences have no effect while the lab-wide switch is off, so lock them
  // instead of letting a user edit settings that won't take effect until it's back on.
  const runNotificationPreferencesDisabled = computed(
    () => !isEditing.value || isSubmittingFormData.value || !state.value.NotificationsEnabled,
  );

  // The event filter only has an effect once at least one of the two "email me" toggles is on.
  const showNotificationEventFilter = computed(() => notifyOnOwnRunsEnabled.value || notifyOnLabRunsEnabled.value);
  // 'all_terminal' means both checked; 'failures_only' / 'successes_only' mean only that one.
  const eventFilterSuccessChecked = computed(() => notificationEventFilter.value !== 'failures_only');
  const eventFilterFailureChecked = computed(() => notificationEventFilter.value !== 'successes_only');

  function parseAdditionalEmailsInput(raw: string): string[] {
    return raw
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
  }

  function additionalEmailsEqual(a: string, b: string): boolean {
    const left = parseAdditionalEmailsInput(a);
    const right = parseAdditionalEmailsInput(b);
    return left.length === right.length && left.every((email, i) => email === right[i]);
  }

  const additionalEmailsError = computed<string | null>(() => {
    const parsed = parseAdditionalEmailsInput(notifyOnLabRunsAdditionalEmailsInput.value);
    const result =
      UpdateLaboratoryUserNotificationPreferenceSchema.shape.NotifyOnLabRunsAdditionalEmails.safeParse(parsed);
    if (result.success) return null;
    return parsed.length > 10
      ? 'You can add at most 10 additional email addresses.'
      : 'One or more email addresses are invalid.';
  });

  /**
   * Loads the current user's account-wide notification preferences and their own
   * lab-membership notification preference for this specific lab. These come from two
   * different records (User, LaboratoryUser), so they're fetched separately.
   *
   * There is no single-record "my own membership row in lab X" endpoint today, so this
   * reuses the existing list-laboratory-users-by-lab call (already used by EGLabView.vue)
   * and finds the caller's own row client-side. The endpoint's laboratoryId/userId query
   * parameters are mutually exclusive server-side (see list-laboratory-users.lambda.ts),
   * so they cannot be combined to fetch a single row directly.
   */
  async function loadNotificationPreferences() {
    isLoadingNotificationPrefs.value = true;
    try {
      const [currentUser, labUsers] = await Promise.all([$api.users.getUser(), $api.labs.listLabUsersByLabId(labId)]);
      notifyOnOwnRunsEnabled.value = currentUser.NotifyOnOwnRuns === true;
      notificationEventFilter.value = currentUser.NotificationEventFilter ?? 'all_terminal';

      const myLabUser = labUsers.find((labUser) => labUser.UserId === userStore.currentUserDetails.internalId);
      notifyOnLabRunsEnabled.value = myLabUser?.NotifyOnLabRuns === true;
      notifyOnLabRunsAdditionalEmailsInput.value = (myLabUser?.NotifyOnLabRunsAdditionalEmails ?? []).join(', ');

      uneditedNotifyOnOwnRunsEnabled.value = notifyOnOwnRunsEnabled.value;
      uneditedNotifyOnLabRunsEnabled.value = notifyOnLabRunsEnabled.value;
      uneditedNotificationEventFilter.value = notificationEventFilter.value;
      uneditedNotifyOnLabRunsAdditionalEmailsInput.value = notifyOnLabRunsAdditionalEmailsInput.value;
    } catch (error) {
      console.error('Error loading run notification preferences:', error);
      useToastStore().error('Failed to load run notification preferences');
    } finally {
      isLoadingNotificationPrefs.value = false;
    }
  }

  function notificationPrefsChanged(): boolean {
    if (isLoadingNotificationPrefs.value) return false;
    return (
      notifyOnOwnRunsEnabled.value !== uneditedNotifyOnOwnRunsEnabled.value ||
      notifyOnLabRunsEnabled.value !== uneditedNotifyOnLabRunsEnabled.value ||
      notificationEventFilter.value !== uneditedNotificationEventFilter.value ||
      !additionalEmailsEqual(
        notifyOnLabRunsAdditionalEmailsInput.value,
        uneditedNotifyOnLabRunsAdditionalEmailsInput.value,
      )
    );
  }

  /** Persists whichever of the two notification-preference records actually changed. */
  async function saveNotificationPreferencesIfChanged() {
    const userPrefsChanged =
      notifyOnOwnRunsEnabled.value !== uneditedNotifyOnOwnRunsEnabled.value ||
      notificationEventFilter.value !== uneditedNotificationEventFilter.value;
    if (userPrefsChanged) {
      try {
        await $api.users.updateUser(userStore.currentUserDetails.id!, {
          NotifyOnOwnRuns: notifyOnOwnRunsEnabled.value,
          NotificationEventFilter: notificationEventFilter.value,
        });
        uneditedNotifyOnOwnRunsEnabled.value = notifyOnOwnRunsEnabled.value;
        uneditedNotificationEventFilter.value = notificationEventFilter.value;
      } catch (error) {
        console.error('Error updating run notification preference:', error);
        useToastStore().error('Failed to update your run notification preference');
      }
    }

    const labPrefsChanged =
      notifyOnLabRunsEnabled.value !== uneditedNotifyOnLabRunsEnabled.value ||
      !additionalEmailsEqual(
        notifyOnLabRunsAdditionalEmailsInput.value,
        uneditedNotifyOnLabRunsAdditionalEmailsInput.value,
      );
    if (labPrefsChanged) {
      try {
        const emails = parseAdditionalEmailsInput(notifyOnLabRunsAdditionalEmailsInput.value);
        await $api.labs.updateMyLabNotificationPreference(labId, notifyOnLabRunsEnabled.value, emails);
        notifyOnLabRunsAdditionalEmailsInput.value = emails.join(', ');
        uneditedNotifyOnLabRunsEnabled.value = notifyOnLabRunsEnabled.value;
        uneditedNotifyOnLabRunsAdditionalEmailsInput.value = notifyOnLabRunsAdditionalEmailsInput.value;
      } catch (error) {
        console.error('Error updating lab run notification recipients:', error);
        useToastStore().error('Failed to update lab run notification recipients');
      }
    }
  }

  // The two checkboxes represent three real states (all_terminal / failures_only / successes_only).
  // Unchecking the last remaining checked box is a no-op rather than clamping back to
  // 'all_terminal' or leaving both unchecked — an event filter with nothing selected would
  // silently mean "never notify", which isn't a state either of these toggles should reach.
  function onToggleNotifySuccesses(checked: boolean) {
    const failureChecked = eventFilterFailureChecked.value;
    if (!checked && !failureChecked) return;
    notificationEventFilter.value = checked ? (failureChecked ? 'all_terminal' : 'successes_only') : 'failures_only';
  }

  function onToggleNotifyFailures(checked: boolean) {
    const successChecked = eventFilterSuccessChecked.value;
    if (!checked && !successChecked) return;
    notificationEventFilter.value = checked ? (successChecked ? 'all_terminal' : 'failures_only') : 'successes_only';
  }
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
  // Maps CreateLaboratorySchema/UpdateLaboratorySchema field names to the section and label
  // shown for them in this form, so a safeParse failure can name which section to fix.
  const LAB_DETAILS_FIELD_LABELS: Record<string, string> = {
    Name: 'Lab details – Name',
    Description: 'Lab details – Description',
    S3Bucket: 'Lab details – Default S3 bucket directory',
    Status: 'Lab details – Status',
    RunRetentionMonths: 'Lab details – Run retention',
    RunListStatusPollIntervalSeconds: 'Lab details – Run list poll interval',
    RunDetailProgressPollIntervalSeconds: 'Lab details – Run detail poll interval',
    NextFlowTowerEnabled: 'Integrations – Seqera enabled',
    NextFlowTowerApiBaseUrl: 'Integrations – Seqera API base URL',
    NextFlowTowerWorkspaceId: 'Integrations – Seqera workspace ID',
    NextFlowTowerAccessToken: 'Integrations – Seqera access token',
    GitHubAccessToken: 'Integrations – GitHub access token',
    AwsHealthOmicsEnabled: 'Integrations – HealthOmics enabled',
    AwsHealthOmicsNetworkingMode: 'HealthOmics VPC Networking – Networking mode',
    AwsHealthOmicsVpcConfigurationName: 'HealthOmics VPC Networking – VPC configuration name',
    HealthOmicsLogEnrichmentEnabled: 'AI Failure Analysis (HealthOmics) – Log enrichment enabled',
    HealthOmicsLlmProvider: 'AI Failure Analysis (HealthOmics) – LLM provider',
    HealthOmicsLlmModelId: 'AI Failure Analysis (HealthOmics) – Model ID',
    HealthOmicsLlmApiKey: 'AI Failure Analysis (HealthOmics) – API key',
    SeqeraLlmProvider: 'AI Failure Analysis (Seqera) – LLM provider',
    SeqeraLlmModelId: 'AI Failure Analysis (Seqera) – Model ID',
    SeqeraLlmApiKey: 'AI Failure Analysis (Seqera) – API key',
    NotificationsEnabled: 'Run Notifications – Enabled',
  };

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
   * A saved API key is scoped to whichever provider it was entered for, so it can't cover a
   * provider the admin has since switched to — a fresh key is required in that case even
   * though `hasSavedApiKey` is still true for the (now-stale) key from the original provider.
   */
  function isLlmApiKeyRequired(
    currentProvider: string | undefined,
    originalProvider: string | undefined,
    hasSavedApiKey: boolean | undefined,
  ): boolean {
    if (formMode.value === LabDetailsFormModeEnum.enum.Create) {
      return true;
    }
    if (currentProvider !== originalProvider) {
      return true;
    }
    return !hasSavedApiKey;
  }

  /**
   * Switches the form input fields disabled/hidden states based on the form mode.
   */
  function switchToFormMode(newFormMode: LabDetailsFormMode) {
    formMode.value = newFormMode;
  }

  onMounted(async () => {
    if (formMode.value !== LabDetailsFormModeEnum.enum.Create) {
      await Promise.all([getS3Buckets(), getLabDetails(), loadNotificationPreferences()]);
    } else {
      await getS3Buckets();
      isLoadingNotificationPrefs.value = false;
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
   * Submit requires a usable S3 directory for org admins: the bucket must be one the lab is
   * currently granted access to (present in the loaded list). A previously persisted bucket that
   * is no longer granted (e.g. access revoked) is not accepted, so the admin must pick a valid one.
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

    return s3Directories.value.some((dir) => dir === bucket);
  });

  /**
   * True when the lab has a persisted default bucket that is no longer in the granted list
   * (e.g. an admin revoked access). Used to explain why the select is empty and submit is blocked.
   */
  const persistedBucketNoLongerGranted = computed(() => {
    if (isLoadingBuckets.value || !useUserStore().isOrgAdmin()) {
      return false;
    }
    const bucket = uneditedLabDetails.value?.S3Bucket;
    if (!bucket) {
      return false;
    }
    return !s3Directories.value.some((dir) => dir === bucket);
  });

  async function getS3Buckets() {
    try {
      isLoadingBuckets.value = true;
      s3Directories.value = await fetchLabS3BucketOptions({
        isCreateMode: formMode.value === LabDetailsFormModeEnum.enum.Create,
        labId,
        orgId: useUserStore().currentOrgId,
        api: $api.s3Access,
      });
    } catch (error) {
      useToastStore().error('Failed to retrieve S3 buckets');
    } finally {
      isLoadingBuckets.value = false;
    }
  }

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
          RunListStatusPollIntervalSeconds:
            labDetails.RunListStatusPollIntervalSeconds ?? DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
          RunDetailProgressPollIntervalSeconds:
            labDetails.RunDetailProgressPollIntervalSeconds ?? DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
          // BYOK: server never echoes back the keys — only Has*LlmApiKey indicators.
          // Initialize the password inputs to empty so they don't show stale data.
          HealthOmicsLlmApiKey: '',
          SeqeraLlmApiKey: '',
          // Backend kill-switch semantics: absent means enabled, only `=== false` disables.
          // Normalize here so an unset field doesn't load as a `false` that then gets
          // saved back as an explicit disable on the next Save Changes.
          NotificationsEnabled: labDetails.NotificationsEnabled !== false,
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
   * It resets the state value to the original unedited lab details, turns off the editing mode for the Nextflow Tower
   * access token, and disables the submit button. Fields remain editable — there is no read-only mode to revert to.
   *
   * @return {void}
   */
  function handleCancelEdit() {
    state.value = { ...uneditedLabDetails.value! };
    notifyOnOwnRunsEnabled.value = uneditedNotifyOnOwnRunsEnabled.value;
    notifyOnLabRunsEnabled.value = uneditedNotifyOnLabRunsEnabled.value;
    notificationEventFilter.value = uneditedNotificationEventFilter.value;
    notifyOnLabRunsAdditionalEmailsInput.value = uneditedNotifyOnLabRunsAdditionalEmailsInput.value;
    isEditingNextFlowTowerAccessToken.value = false;
    isEditingGitHubAccessToken.value = false;
    canSubmit.value = false;
    retentionPreviewCacheMonths.value = null;
    retentionPreviewCounts.value = null;
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
        useToastStore().error(
          extractApiErrorMessage(error) ?? 'An unknown error occurred. Please refresh the page and try again.',
        );
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
      const parseResult = UpdateLaboratorySchema.safeParse(withNormalizedLlmFields(state.value));
      if (!parseResult.success) {
        console.error('Update lab failed to parse lab details; parseResult: ', parseResult);
        throw new Error(
          `Couldn't save — check: ${formatValidationIssues(parseResult.error.issues, LAB_DETAILS_FIELD_LABELS)}`,
        );
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

      await saveNotificationPreferencesIfChanged();

      emit('updated');
      isEditingNextFlowTowerAccessToken.value = false;
      isEditingGitHubAccessToken.value = false;
      retentionPreviewCacheMonths.value = null;
      retentionPreviewCounts.value = null;
      await getLabDetails({ showLoader: false });

      useToastStore().success(`${lab.Name} successfully updated`);
    } catch (error: any) {
      if (error.message === `Request error: ${ERROR_CODES['EG-304']}`) {
        useToastStore().error('Laboratory name already taken. Please try again.');
      } else if (error.message === `Request error: ${ERROR_CODES['EG-308']}`) {
        useToastStore().error('Invalid Workspace ID or Personal Access Token. Please try again.');
      } else {
        useToastStore().error(
          extractApiErrorMessage(error) ?? 'An unknown error occurred. Please refresh the page and try again.',
        );
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
      console.error('Create lab failed to parse lab details; parseResult: ', parseResult);
      throw new Error(
        `Couldn't save — check: ${formatValidationIssues(parseResult.error.issues, LAB_DETAILS_FIELD_LABELS)}`,
      );
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
      console.error('Update lab failed to parse lab details; parseResult: ', parseResult);
      throw new Error(
        `Couldn't save — check: ${formatValidationIssues(parseResult.error.issues, LAB_DETAILS_FIELD_LABELS)}`,
      );
    }

    const lab: UpdateLaboratory = parseResult.data;
    const res = await $api.labs.update(labId, lab);

    if (!res) {
      useToastStore().error(`Failed to verify details for ${state.value.Name}`);
    }

    await saveNotificationPreferencesIfChanged();

    emit('updated');

    isEditingNextFlowTowerAccessToken.value = false;
    isEditingGitHubAccessToken.value = false;
    await getLabDetails({ showLoader: false });

    useToastStore().success(`${lab.Name} successfully updated`);
  }

  const validate = (state: LabDetails): FormError[] => {
    const errors: FormError[] = [];

    maybeAddFieldValidationErrors(errors, LabNameSchema, 'Name', state.Name);
    maybeAddFieldValidationErrors(errors, LabDescriptionSchema, 'Description', state.Description);
    maybeAddFieldValidationErrors(errors, RunRetentionMonthsSchema, 'RunRetentionMonths', state.RunRetentionMonths);
    maybeAddFieldValidationErrors(
      errors,
      RunListStatusPollIntervalSecondsSchema,
      'RunListStatusPollIntervalSeconds',
      state.RunListStatusPollIntervalSeconds,
    );
    maybeAddFieldValidationErrors(
      errors,
      RunDetailProgressPollIntervalSecondsSchema,
      'RunDetailProgressPollIntervalSeconds',
      state.RunDetailProgressPollIntervalSeconds,
    );

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

    if (state.AwsHealthOmicsEnabled && state.AwsHealthOmicsNetworkingMode === 'VPC') {
      maybeAddFieldValidationErrors(
        errors,
        VpcConfigurationNameSchema,
        'AwsHealthOmicsVpcConfigurationName',
        state.AwsHealthOmicsVpcConfigurationName,
      );
    }

    // Model ID is only meaningful once a provider is picked for that integration.
    if (state.HealthOmicsLlmProvider) {
      maybeAddFieldValidationErrors(errors, LlmModelIdSchema, 'HealthOmicsLlmModelId', state.HealthOmicsLlmModelId);
    }
    if (state.SeqeraLlmProvider) {
      maybeAddFieldValidationErrors(errors, LlmModelIdSchema, 'SeqeraLlmModelId', state.SeqeraLlmModelId);
    }

    // openai/anthropic are BYOK: an API key is required unless one is already saved
    // for the currently-selected provider specifically (see isLlmApiKeyRequired).
    if (state.HealthOmicsLlmProvider === 'openai' || state.HealthOmicsLlmProvider === 'anthropic') {
      if (
        isLlmApiKeyRequired(
          state.HealthOmicsLlmProvider,
          uneditedLabDetails.value?.HealthOmicsLlmProvider,
          uneditedLabDetails.value?.HasHealthOmicsLlmApiKey,
        )
      ) {
        maybeAddFieldValidationErrors(errors, LlmApiKeySchema, 'HealthOmicsLlmApiKey', state.HealthOmicsLlmApiKey);
      }
    }

    if (notifyOnLabRunsEnabled.value && additionalEmailsError.value) {
      errors.push({ path: 'NotifyOnLabRunsAdditionalEmailsInput', message: additionalEmailsError.value });
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
      // In Edit mode, the form can be submitted if there are no validation errors and either the
      // lab details or the notification preferences have changed
      const dataChanged = formDataChanged() || notificationPrefsChanged();
      canSubmit.value = noValidationErrors && dataChanged;
    }
  }

  /** Fields users can change on this form; avoids comparing full Laboratory/server-only keys and fixes retention coercion issues. */
  const LAB_DETAILS_EDIT_COMPARE_KEYS = [
    'Name',
    'Description',
    'RunRetentionMonths',
    'RunListStatusPollIntervalSeconds',
    'RunDetailProgressPollIntervalSeconds',
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
    'AwsHealthOmicsNetworkingMode',
    'AwsHealthOmicsVpcConfigurationName',
    'NotificationsEnabled',
  ] as const;

  type LabEditCompareKey = (typeof LAB_DETAILS_EDIT_COMPARE_KEYS)[number];

  function valuesDifferForLabEdit(key: LabEditCompareKey, a: unknown, b: unknown): boolean {
    if (
      key === 'RunRetentionMonths' ||
      key === 'RunListStatusPollIntervalSeconds' ||
      key === 'RunDetailProgressPollIntervalSeconds'
    ) {
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
      key === 'SeqeraLlmModelId' ||
      key === 'AwsHealthOmicsVpcConfigurationName'
    ) {
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '' : v);
      return norm(a) !== norm(b);
    }
    if (key === 'HealthOmicsLlmProvider' || key === 'SeqeraLlmProvider') {
      // Empty / undefined means "no provider selected"; treat them equivalently.
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? '_unset_' : v);
      return norm(a) !== norm(b);
    }
    if (key === 'AwsHealthOmicsNetworkingMode') {
      // A server response omitting the field means RESTRICTED (today's default);
      // treat that the same as an explicit 'RESTRICTED' so loading an unconfigured
      // lab into Edit mode doesn't show a false dirty state.
      const norm = (v: unknown) => (v === undefined || v === null || v === '' ? 'RESTRICTED' : v);
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

  // Model ID and API Key are provider-specific and must not silently carry over when the
  // admin switches HealthOmics LLM provider. Skipped when the new value matches the
  // originally-saved provider — e.g. the initial load, or Cancel resetting the form —
  // since state.HealthOmicsLlmModelId/ApiKey were just (re)set to the correct saved values.
  watch(
    () => state.value.HealthOmicsLlmProvider,
    (newProvider) => {
      if (newProvider === uneditedLabDetails.value?.HealthOmicsLlmProvider) {
        return;
      }
      state.value.HealthOmicsLlmModelId = '';
      state.value.HealthOmicsLlmApiKey = '';
    },
  );

  // The four per-user notification controls aren't part of `state`, so they need their own
  // trigger to re-run validation/dirty-checking when they change.
  watch(
    [notifyOnOwnRunsEnabled, notifyOnLabRunsEnabled, notificationEventFilter, notifyOnLabRunsAdditionalEmailsInput],
    () => validate(state.value),
  );
</script>

<template>
  <p v-if="isLoadingFormData" id="lab-settings-loading-status" class="sr-only" role="status" aria-live="polite">
    Loading lab settings…
  </p>
  <UForm
    :validate="validate"
    :state="state"
    :aria-labelledby="formMode !== LabDetailsFormModeEnum.enum.Create ? settingsHeadingId : undefined"
    :aria-busy="isSubmittingFormData || isLoadingRetentionPreview || isLoadingFormData"
    :aria-describedby="isLoadingFormData ? 'lab-settings-loading-status' : undefined"
    @submit="onSubmit"
  >
    <EGText v-if="formMode !== LabDetailsFormModeEnum.enum.Create" :id="settingsHeadingId" tag="h2" class="sr-only">
      Lab settings
    </EGText>
    <EGCollapsibleSection heading-id="lab-settings-details-heading" title="Lab details" default-open>
      <div v-if="isLoadingFormData" class="flex flex-col" aria-hidden="true">
        <div class="mb-6 space-y-2">
          <USkeleton class="h-4 w-24" />
          <USkeleton class="h-12 w-full" />
        </div>
        <div class="mb-6 space-y-2">
          <USkeleton class="h-4 w-32" />
          <USkeleton class="h-20 w-full" />
        </div>
        <div v-for="n in 4" :key="n" class="mb-6 space-y-2 last:mb-0">
          <USkeleton class="h-4 w-48" />
          <USkeleton class="h-12 w-full" />
          <USkeleton class="h-3 w-64" />
        </div>
      </div>
      <template v-else>
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

        <EGFormGroup
          label="Runs list status poll interval (seconds)"
          name="RunListStatusPollIntervalSeconds"
          eager-validation
        >
          <EGInput
            v-model.number="state.RunListStatusPollIntervalSeconds"
            type="number"
            min="30"
            max="1800"
            step="1"
            :disabled="!isEditing || isSubmittingFormData"
            placeholder="Enter seconds between list updates"
            :aria-describedby="runsListPollHelpId"
          />
          <p :id="runsListPollHelpId" class="text-muted mt-1 text-xs">
            Controls how often the lab runs list refreshes run statuses. Allowed range: 30 to 1800 seconds.
          </p>
        </EGFormGroup>

        <EGFormGroup
          label="Run detail progress poll interval (seconds)"
          name="RunDetailProgressPollIntervalSeconds"
          eager-validation
        >
          <EGInput
            v-model.number="state.RunDetailProgressPollIntervalSeconds"
            type="number"
            min="10"
            max="300"
            step="1"
            :disabled="!isEditing || isSubmittingFormData"
            placeholder="Enter seconds between run detail updates"
            :aria-describedby="runDetailPollHelpId"
          />
          <p :id="runDetailPollHelpId" class="text-muted mt-1 text-xs">
            Controls how often the run detail page refreshes task progress. Allowed range: 10 to 300 seconds.
          </p>
        </EGFormGroup>

        <EGFormGroup v-if="useUserStore().isOrgAdmin()" label="Default S3 bucket directory" name="S3Bucket" required>
          <EGSelect
            :options="s3Directories"
            v-model="selectedS3Bucket"
            :disabled="!isEditing || isSubmittingFormData"
            placeholder="Please select an S3 bucket from the list below"
            searchable-placeholder="Search existing S3 buckets..."
          />
          <p v-if="isEditing && persistedBucketNoLongerGranted" class="text-alert-danger-dark mt-1 text-xs">
            This lab’s previous default bucket ({{ uneditedLabDetails?.S3Bucket }}) is no longer accessible, likely
            because access was revoked. Select a currently available S3 bucket to continue.
          </p>
        </EGFormGroup>
      </template>
    </EGCollapsibleSection>

    <div class="mt-6 flex flex-col gap-6">
      <EGCollapsibleSection
        heading-id="lab-settings-integrations-heading"
        title="Integrations"
        :description="
          isSeqeraAlreadyEnabled
            ? 'Seqera and HealthOmics connections for this lab.'
            : 'HealthOmics connections for this lab.'
        "
        :badges="isLoadingFormData ? [] : integrationsBadges"
      >
        <!-- Don't render Seqera/HealthOmics Off from defaultState while lab details are still loading. -->
        <div v-if="isLoadingFormData" class="flex flex-col" aria-hidden="true">
          <div class="mb-6 flex items-center justify-between">
            <USkeleton class="h-4 w-48" />
            <USkeleton class="h-6 w-12" />
          </div>
          <div class="flex items-center justify-between">
            <USkeleton class="h-4 w-56" />
            <USkeleton class="h-6 w-12" />
          </div>
        </div>
        <template v-else>
          <section v-if="isSeqeraAlreadyEnabled" :aria-labelledby="seqeraSectionId">
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
        </template>
      </EGCollapsibleSection>

      <!-- AI Failure Analysis: BYOK per integration. HealthOmics and Seqera each get
           their own provider/model/key + enable toggle. The deterministic HealthOmics
           lookup table runs regardless; the LLM is only used as a fallback for
           ambiguous HealthOmics codes (WORKFLOW_RUN_FAILED etc.) and free-text
           Seqera errors. Always visible (not gated on either integration being enabled)
           so the badge communicates status at a glance; content explains what's needed
           when neither integration is on. -->
      <EGCollapsibleSection
        heading-id="lab-settings-ai-failure-analysis-heading"
        title="AI Failure Analysis"
        description="When a run fails, classify the cause by responsible party using an LLM."
        :badges="isLoadingFormData ? [] : [aiFailureAnalysisBadge]"
      >
        <!-- Don't render provider/enablement state from defaultState while lab details are still loading. -->
        <div v-if="isLoadingFormData" class="flex flex-col gap-6" aria-hidden="true">
          <USkeleton class="h-3 w-3/4" />
          <div v-for="n in 2" :key="n" class="space-y-2">
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-12 w-full" />
          </div>
        </div>
        <template v-else>
          <div class="mb-3 flex items-center gap-1.5">
            <p class="text-muted text-xs">
              Documented HealthOmics error codes use a built-in lookup; the LLM only handles ambiguous or free-text
              cases.
            </p>
            <!-- Provider guidance: helps an admin decide which LLM to bring (Bedrock vs OpenAI vs Anthropic)
               before they pick one in the dropdowns below. -->
            <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
              <template #text>
                <div class="space-y-1.5 py-1">
                  <p>
                    Each integration can use a different provider — for example a cheaper model for high-volume Seqera
                    traffic, a more accurate model for HealthOmics ambiguous cases.
                  </p>
                  <p class="font-medium text-black">Which provider should I choose?</p>
                  <p>
                    <span class="font-medium text-black">Amazon Bedrock</span>
                    — no API key; calls run under the platform's own AWS account and IAM role, not your lab's. Simplest
                    setup, and the error text stays within AWS, but it isn't isolated to your own AWS account.
                  </p>
                  <p>
                    <span class="font-medium text-black">Anthropic (Claude)</span>
                    — best accuracy on nuanced or ambiguous errors. Requires an Anthropic API key.
                  </p>
                  <p>
                    <span class="font-medium text-black">OpenAI (GPT)</span>
                    — low-cost small models (e.g. gpt-4o-mini) suited to high-volume traffic. Requires an OpenAI API
                    key.
                  </p>
                  <p class="italic">
                    OpenAI and Anthropic send the error text to that provider; Bedrock does not leave AWS.
                  </p>
                </div>
              </template>
              <UIcon
                name="i-heroicons-information-circle"
                class="text-muted h-4 w-4 shrink-0"
                aria-label="LLM provider guidance"
              />
            </UTooltip>
          </div>

          <p v-if="!state.AwsHealthOmicsEnabled && !state.NextFlowTowerEnabled" class="text-muted text-xs">
            Enable HealthOmics{{ isSeqeraAlreadyEnabled ? ' or Seqera' : '' }} integration above to configure AI
            failure analysis for that integration.
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
                :disabled="!isEditing || isSubmittingFormData"
              />
            </EGFormGroup>

            <EGFormGroup
              v-if="state.HealthOmicsLlmProvider"
              label="Model ID"
              name="HealthOmicsLlmModelId"
              eager-validation
              required
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
              :required="
                isLlmApiKeyRequired(
                  state.HealthOmicsLlmProvider,
                  uneditedLabDetails?.HealthOmicsLlmProvider,
                  uneditedLabDetails?.HasHealthOmicsLlmApiKey,
                )
              "
            >
              <div
                v-if="
                  uneditedLabDetails?.HasHealthOmicsLlmApiKey &&
                  state.HealthOmicsLlmProvider === uneditedLabDetails?.HealthOmicsLlmProvider
                "
                class="mb-2 flex items-center gap-2"
              >
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
                :disabled="!isEditing || isSubmittingFormData"
              />
            </EGFormGroup>

            <EGFormGroup
              v-if="state.SeqeraLlmProvider"
              label="Model ID"
              name="SeqeraLlmModelId"
              eager-validation
              required
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
      </EGCollapsibleSection>

      <!-- HealthOmics VPC Networking: always visible (badge communicates on/off status) so an
           admin can discover the feature exists even before enabling HealthOmics. Fields stay
           visible but disabled when HealthOmics is off, per the hint text below, rather than
           hiding the whole card — hiding it entirely does not clear AwsHealthOmicsNetworkingMode /
           AwsHealthOmicsVpcConfigurationName, so a dormant VPC config is preserved either way. -->
      <EGCollapsibleSection
        heading-id="lab-settings-healthomics-vpc-networking-heading"
        title="HealthOmics VPC Networking"
        description="Route this lab's HealthOmics runs through a custom VPC configuration."
        description-tooltip="Lets runs reach resources outside the default restricted network — for example internet reference datasets, license servers, or private VPC and on-prem data."
        :badges="isLoadingFormData ? [] : [healthOmicsVpcNetworkingBadge]"
      >
        <!-- Don't render the RESTRICTED default from defaultState while lab details are still loading. -->
        <div v-if="isLoadingFormData" class="space-y-2" aria-hidden="true">
          <USkeleton class="h-4 w-36" />
          <USkeleton class="h-3 w-64" />
          <USkeleton class="h-12 w-full" />
        </div>
        <template v-else>
          <EGFormGroup label="Networking mode" name="AwsHealthOmicsNetworkingMode" eager-validation>
            <div class="mb-2 flex items-center gap-1.5">
              <p class="text-muted text-xs">Only available when HealthOmics is enabled.</p>
              <UTooltip :delay-duration="0" :ui="{ base: 'h-auto w-auto max-w-sm whitespace-normal text-left' }">
                <template #text>
                  <p>
                    Restricted (default) reaches only S3 and ECR in-region. VPC routes this lab's runs through a saved
                    configuration.
                  </p>
                </template>
                <UIcon
                  name="i-heroicons-information-circle"
                  class="text-muted h-4 w-4 shrink-0"
                  aria-label="Networking mode guidance"
                />
              </UTooltip>
            </div>
            <USelect
              v-model="state.AwsHealthOmicsNetworkingMode"
              :options="networkingModeOptions"
              value-attribute="value"
              option-attribute="label"
              :disabled="!isEditing || isSubmittingFormData || !state.AwsHealthOmicsEnabled"
            />
          </EGFormGroup>

          <EGFormGroup
            v-if="state.AwsHealthOmicsNetworkingMode === 'VPC'"
            label="VPC configuration name"
            name="AwsHealthOmicsVpcConfigurationName"
            eager-validation
            required
            hint="Name of an ACTIVE HealthOmics configuration set up by ops."
          >
            <EGInput
              v-model="state.AwsHealthOmicsVpcConfigurationName"
              maxlength="50"
              placeholder="wslh-prod-vpc"
              :disabled="!isEditing || isSubmittingFormData || !state.AwsHealthOmicsEnabled"
            />
          </EGFormGroup>
        </template>
      </EGCollapsibleSection>

      <!-- Run Notifications: all five controls save via this page's normal Save Changes /
           Cancel flow. The lab-wide toggle is a real Laboratory field (state.NotificationsEnabled);
           the other four are per-user preferences kept in their own refs (they aren't Laboratory
           fields) but share the same dirty-check/save/cancel lifecycle — see
           loadNotificationPreferences/notificationPrefsChanged/saveNotificationPreferencesIfChanged
           in the script. Hidden in Create mode: none of these preferences can be set for a lab
           that doesn't exist yet. -->
      <EGCollapsibleSection
        v-if="formMode !== LabDetailsFormModeEnum.enum.Create"
        heading-id="lab-settings-run-notifications-heading"
        title="Run Notifications"
        description="Control who gets emailed when runs in this lab finish."
        :badges="isLoadingFormData ? [] : [runNotificationsBadge]"
      >
        <!-- Don't render the lab-wide kill switch from defaultState while lab details are still loading. -->
        <div v-if="isLoadingFormData" class="flex flex-col gap-6" aria-hidden="true">
          <div class="flex items-center justify-between">
            <USkeleton class="h-4 w-64" />
            <USkeleton class="h-6 w-12" />
          </div>
          <USkeleton class="h-24 w-full" />
        </div>
        <template v-else>
          <!-- Lab-wide kill switch -->
          <EGFormGroup
            name="NotificationsEnabled"
            eager-validation
            hint="Turns off run-completion emails for everyone in this lab and disables the preferences below until this is re-enabled."
          >
            <div class="flex items-center justify-between">
              <label
                :id="notificationsToggleLabelId"
                :for="`${notificationsToggleLabelId}-input`"
                class="text-sm text-black"
              >
                Enable email notifications for this lab
              </label>
              <UToggle
                :id="`${notificationsToggleLabelId}-input`"
                class="ml-2"
                v-model="state.NotificationsEnabled"
                :disabled="!isEditing || isSubmittingFormData"
                :aria-labelledby="notificationsToggleLabelId"
              />
            </div>
          </EGFormGroup>

          <USkeleton v-if="isLoadingNotificationPrefs" class="mt-4 h-24 w-full" aria-hidden="true" />
          <template v-else>
            <!-- Per-user preferences: staged locally like every other field, saved via Save Changes -->
            <EGFormGroup name="NotifyOnOwnRuns" eager-validation>
              <div class="flex items-center justify-between">
                <span :id="notifyOwnRunsToggleLabelId" class="text-sm text-black">Email me about my own runs</span>
                <UToggle
                  class="ml-2"
                  v-model="notifyOnOwnRunsEnabled"
                  :disabled="runNotificationPreferencesDisabled"
                  :aria-labelledby="notifyOwnRunsToggleLabelId"
                />
              </div>
            </EGFormGroup>

            <EGFormGroup name="NotifyOnLabRuns" eager-validation>
              <div class="flex items-center justify-between">
                <span :id="notifyLabRunsToggleLabelId" class="text-sm text-black">
                  Email me about all runs in this lab
                </span>
                <UToggle
                  class="ml-2"
                  v-model="notifyOnLabRunsEnabled"
                  :disabled="runNotificationPreferencesDisabled"
                  :aria-labelledby="notifyLabRunsToggleLabelId"
                />
              </div>
            </EGFormGroup>

            <EGFormGroup v-if="notifyOnLabRunsEnabled" name="NotifyOnLabRunsAdditionalEmailsInput" eager-validation>
              <label :for="notifyLabRunsAdditionalEmailsInputId" class="mb-1 block text-sm text-black">
                Also CC these emails on every lab run
              </label>
              <EGInput
                :id="notifyLabRunsAdditionalEmailsInputId"
                v-model="notifyOnLabRunsAdditionalEmailsInput"
                placeholder="team-distro@example.com, oncall@example.com"
                :disabled="runNotificationPreferencesDisabled"
              />
              <p v-if="additionalEmailsError" class="text-alert-danger-dark mt-1 text-xs font-medium">
                {{ additionalEmailsError }}
              </p>
              <p v-else class="text-muted mt-1 text-xs">
                Comma-separated, up to 10. Sent whenever your own "all runs in this lab" notification fires.
              </p>
            </EGFormGroup>

            <EGFormGroup v-if="showNotificationEventFilter" name="NotificationEventFilter" eager-validation>
              <p class="mb-2 text-sm text-black">Notify me when a run</p>
              <div class="flex flex-col gap-2">
                <UCheckbox
                  label="Succeeds"
                  :model-value="eventFilterSuccessChecked"
                  :disabled="runNotificationPreferencesDisabled"
                  @update:model-value="onToggleNotifySuccesses"
                />
                <UCheckbox
                  label="Fails"
                  :model-value="eventFilterFailureChecked"
                  :disabled="runNotificationPreferencesDisabled"
                  @update:model-value="onToggleNotifyFailures"
                />
              </div>
            </EGFormGroup>
          </template>
        </template>
      </EGCollapsibleSection>
    </div>

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
