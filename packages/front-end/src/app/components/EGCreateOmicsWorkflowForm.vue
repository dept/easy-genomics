<script setup lang="ts">
  import { FormError } from '#ui/types';
  import { maybeAddFieldValidationErrors } from '@FE/utils/form-utils';
  import { z } from 'zod';
  import { v4 as uuidv4 } from 'uuid';

  const emit = defineEmits<{
    created: [];
    cancelled: [];
  }>();

  const { $api } = useNuxtApp();
  const uiStore = useUiStore();
  const toastStore = useToastStore();

  const props = defineProps<{
    labId: string;
  }>();

  const engineOptions = [
    { label: 'Nextflow', value: 'NEXTFLOW' },
    { label: 'WDL', value: 'WDL' },
    { label: 'CWL', value: 'CWL' },
  ];
  const sourceOptions = [
    { label: 'Upload ZIP', value: 'ZIP' },
    { label: 'GitHub repository', value: 'GITHUB' },
  ];
  const parameterInputOptions = [
    { label: 'Upload JSON file', value: 'FILE' },
    { label: 'Paste JSON text', value: 'TEXT' },
  ];

  const nameSchema = z
    .string()
    .trim()
    .min(1, 'Workflow name is required')
    .max(64, 'Workflow name must be 64 characters or less');
  const engineSchema = z.enum(['NEXTFLOW', 'WDL', 'CWL']);
  const mainSchema = z
    .string()
    .trim()
    .min(1, 'Main file path is required')
    .max(2048, 'Main file path must be 2048 characters or less');
  const requestIdSchema = z
    .string()
    .trim()
    .min(1, 'Request ID is required')
    .max(127, 'Request ID must be 127 characters or less')
    .regex(/^[a-zA-Z0-9._\-]+$/, 'Request ID allows letters, numbers, dot, underscore, and hyphen');
  const descriptionSchema = z.string().max(256, 'Description must be 256 characters or less').optional();
  const githubRepoUrlSchema = z
    .string()
    .trim()
    .min(1, 'GitHub repository URL is required')
    .max(2048, 'GitHub repository URL must be 2048 characters or less')
    .regex(/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?(?:\/)?$/i, 'Use a valid GitHub repository URL');
  const githubRefSchema = z
    .string()
    .trim()
    .min(1, 'GitHub branch or tag is required')
    .max(128, 'GitHub branch or tag must be 128 characters or less');

  type FormState = {
    name: string;
    engine: 'NEXTFLOW' | 'WDL' | 'CWL';
    source: 'ZIP' | 'GITHUB';
    parameterInputType: 'FILE' | 'TEXT';
    parameterTemplateText: string;
    main: string;
    requestId: string;
    githubRepoUrl: string;
    githubRef: string;
    description?: string;
  };

  const formState = reactive<FormState>({
    name: '',
    engine: 'NEXTFLOW',
    source: 'ZIP',
    parameterInputType: 'FILE',
    parameterTemplateText: '',
    main: 'main.nf',
    requestId: uuidv4(),
    githubRepoUrl: '',
    githubRef: 'main',
    description: '',
  });

  const canSubmit = ref(false);
  const workflowZipFile = ref<File | null>(null);
  const workflowZipFileError = ref<string | null>(null);
  const parameterTemplateFile = ref<File | null>(null);
  const parameterTemplateFileError = ref<string | null>(null);
  const MAX_UPLOAD_SIZE_BYTES = 5 * Math.pow(1024, 3);

  const workflowZipFileLabel = computed<string>(() => workflowZipFile.value?.name || 'No file selected');
  const parameterTemplateFileLabel = computed<string>(() => parameterTemplateFile.value?.name || 'No file selected');

  function parseParameterTemplateText(jsonText: string): Record<string, unknown> {
    const trimmedJsonText = jsonText.trim();
    if (!trimmedJsonText) {
      throw new Error('Workflow parameters JSON is required');
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(trimmedJsonText);
    } catch (error) {
      throw new Error('Workflow parameters must be valid JSON');
    }
    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      throw new Error('Workflow parameters JSON must be an object');
    }
    return parsedJson as Record<string, unknown>;
  }

  function validate(state: FormState): FormError[] {
    const errors: FormError[] = [];
    maybeAddFieldValidationErrors(errors, nameSchema, 'name', state.name);
    maybeAddFieldValidationErrors(errors, engineSchema, 'engine', state.engine);
    maybeAddFieldValidationErrors(errors, mainSchema, 'main', state.main);
    maybeAddFieldValidationErrors(errors, requestIdSchema, 'requestId', state.requestId);
    if (state.description) {
      maybeAddFieldValidationErrors(errors, descriptionSchema, 'description', state.description);
    }
    if (state.source === 'ZIP') {
      if (!workflowZipFile.value) {
        errors.push({ path: 'workflowZipFile', message: 'Workflow ZIP file is required' });
      } else if (!workflowZipFile.value.name.toLowerCase().endsWith('.zip')) {
        errors.push({ path: 'workflowZipFile', message: 'Workflow definition must be a .zip file' });
      } else if (workflowZipFile.value.size > MAX_UPLOAD_SIZE_BYTES) {
        errors.push({ path: 'workflowZipFile', message: 'Workflow ZIP file cannot exceed 5 GiB' });
      }
    } else {
      maybeAddFieldValidationErrors(errors, githubRepoUrlSchema, 'githubRepoUrl', state.githubRepoUrl);
      maybeAddFieldValidationErrors(errors, githubRefSchema, 'githubRef', state.githubRef);
    }

    if (state.parameterInputType === 'FILE') {
      if (!parameterTemplateFile.value) {
        errors.push({ path: 'parameterTemplateFile', message: 'Workflow parameters JSON file is required' });
      } else if (!parameterTemplateFile.value.name.toLowerCase().endsWith('.json')) {
        errors.push({ path: 'parameterTemplateFile', message: 'Workflow parameters file must be a .json file' });
      }
    } else {
      try {
        parseParameterTemplateText(state.parameterTemplateText);
      } catch (error: any) {
        errors.push({ path: 'parameterTemplateText', message: error?.message || 'Invalid workflow parameters JSON' });
      }
    }
    canSubmit.value = errors.length === 0;
    return errors;
  }

  function onWorkflowZipChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    workflowZipFile.value = file;
    workflowZipFileError.value = null;
  }

  function onParameterTemplateFileChange(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    parameterTemplateFile.value = file;
    parameterTemplateFileError.value = null;
  }

  async function onSubmit() {
    try {
      uiStore.setRequestPending('createOmicsWorkflow');
      let parameterTemplate: Record<string, unknown> | undefined;
      if (formState.parameterInputType === 'FILE') {
        if (!parameterTemplateFile.value) {
          throw new Error('Workflow parameters JSON file is required');
        }
        parameterTemplate = parseParameterTemplateText(await parameterTemplateFile.value.text());
      } else {
        parameterTemplate = parseParameterTemplateText(formState.parameterTemplateText);
      }
      let definitionUri: string | undefined;
      if (formState.source === 'ZIP') {
        if (!workflowZipFile.value) {
          throw new Error('Workflow ZIP file is required');
        }
        const uploadRequest = await $api.omicsWorkflows.createUploadRequest(props.labId, {
          fileName: workflowZipFile.value.name,
          size: workflowZipFile.value.size,
          requestId: formState.requestId.trim(),
        });
        const uploadResponse = await fetch(uploadRequest.uploadUrl, {
          method: 'PUT',
          body: workflowZipFile.value,
          headers: {
            'Content-Type': 'application/zip',
          },
        });
        if (!uploadResponse.ok) {
          throw new Error('Failed to upload workflow ZIP file');
        }
        definitionUri = uploadRequest.s3Uri;
      }
      await $api.omicsWorkflows.create(props.labId, {
        name: formState.name.trim(),
        engine: formState.engine,
        definitionUri,
        main: formState.main.trim(),
        requestId: formState.requestId.trim(),
        description: formState.description?.trim() || undefined,
        parameterTemplate,
        githubRepoUrl: formState.source === 'GITHUB' ? formState.githubRepoUrl.trim() : undefined,
        githubRef: formState.source === 'GITHUB' ? formState.githubRef.trim() : undefined,
      });
      toastStore.success('Workflow created successfully');
      emit('created');
    } catch (error: any) {
      toastStore.error(error?.message || 'Failed to create workflow');
    } finally {
      uiStore.setRequestComplete('createOmicsWorkflow');
    }
  }
</script>

<template>
  <EGCard class="mb-6">
    <EGText tag="h5" class="mb-4">Create HealthOmics Workflow</EGText>
    <UForm :state="formState" :validate="validate" @submit="onSubmit">
      <EGFormGroup label="Workflow name" name="name" required>
        <EGInput v-model="formState.name" placeholder="Enter workflow name" />
      </EGFormGroup>

      <EGFormGroup label="Engine" name="engine" required>
        <EGSelect v-model="formState.engine" :options="engineOptions" />
      </EGFormGroup>
      <EGFormGroup label="Definition source" name="source" required>
        <EGSelect v-model="formState.source" :options="sourceOptions" />
      </EGFormGroup>

      <EGFormGroup
        v-if="formState.source === 'ZIP'"
        label="Workflow definition ZIP"
        name="workflowZipFile"
        hint="Upload a .zip file (max 5 GiB)"
        required
      >
        <div class="flex flex-col gap-2">
          <input
            type="file"
            accept=".zip,application/zip"
            class="text-body file:bg-primary block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:px-4 file:py-2 file:text-white hover:file:opacity-90"
            @change="onWorkflowZipChange"
          />
          <p class="text-muted text-xs">{{ workflowZipFileLabel }}</p>
          <p v-if="workflowZipFileError" class="text-alert-danger text-xs">{{ workflowZipFileError }}</p>
        </div>
      </EGFormGroup>

      <EGFormGroup
        v-if="formState.source === 'GITHUB'"
        label="GitHub repository URL"
        name="githubRepoUrl"
        hint="Example: https://github.com/org/repo"
        required
      >
        <EGInput v-model="formState.githubRepoUrl" placeholder="https://github.com/org/repo" />
      </EGFormGroup>

      <EGFormGroup
        v-if="formState.source === 'GITHUB'"
        label="GitHub branch or tag"
        name="githubRef"
        hint="Branch/tag used to build the workflow definition ZIP"
        required
      >
        <EGInput v-model="formState.githubRef" placeholder="main" />
      </EGFormGroup>

      <EGFormGroup
        label="Workflow parameters input"
        name="parameterInputType"
        hint="Provide parameter template as JSON"
        required
      >
        <EGSelect v-model="formState.parameterInputType" :options="parameterInputOptions" />
      </EGFormGroup>

      <EGFormGroup
        v-if="formState.parameterInputType === 'FILE'"
        label="Workflow parameters JSON file"
        name="parameterTemplateFile"
        hint="Upload a .json file with parameter definitions"
        required
      >
        <div class="flex flex-col gap-2">
          <input
            type="file"
            accept=".json,application/json"
            class="text-body file:bg-primary block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:px-4 file:py-2 file:text-white hover:file:opacity-90"
            @change="onParameterTemplateFileChange"
          />
          <p class="text-muted text-xs">{{ parameterTemplateFileLabel }}</p>
          <p v-if="parameterTemplateFileError" class="text-alert-danger text-xs">{{ parameterTemplateFileError }}</p>
        </div>
      </EGFormGroup>

      <EGFormGroup
        v-else
        label="Workflow parameters JSON"
        name="parameterTemplateText"
        hint="Paste a JSON object with parameter definitions"
        required
      >
        <EGTextArea
          v-model="formState.parameterTemplateText"
          placeholder='{"parameterName": {"description": "example", "optional": false}}'
        />
      </EGFormGroup>

      <EGFormGroup
        label="Main file path"
        name="main"
        :hint="
          formState.source === 'GITHUB'
            ? 'Entry file in repository root, e.g. main.nf'
            : 'Entry file in the ZIP, e.g. main.nf'
        "
        required
      >
        <EGInput v-model="formState.main" placeholder="main.nf" />
      </EGFormGroup>

      <EGFormGroup label="Description" name="description">
        <EGInput v-model="formState.description" placeholder="Optional workflow description" />
      </EGFormGroup>

      <div class="flex justify-end gap-3">
        <EGButton label="Cancel" variant="secondary" @click.prevent="emit('cancelled')" />
        <EGButton
          label="Create Workflow"
          :disabled="!canSubmit || uiStore.isRequestPending('createOmicsWorkflow')"
          :loading="uiStore.isRequestPending('createOmicsWorkflow')"
          u-button-type="submit"
        />
      </div>
    </UForm>
  </EGCard>
</template>
