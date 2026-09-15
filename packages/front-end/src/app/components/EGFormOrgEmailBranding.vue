<script setup lang="ts">
  import { ButtonSizeEnum } from '@FE/types/buttons';
  import { useUiStore } from '@FE/stores';
  import { uploadToPresignedUrl } from '@FE/utils/upload-to-presigned-url';
  import { OrgEmailBrandingFormSchema } from '@FE/types/forms';

  const props = withDefaults(
    defineProps<{
      orgId: string;
      emailBrandingLogoUrl?: string;
    }>(),
    {
      emailBrandingLogoUrl: '',
    },
  );

  const { $api } = useNuxtApp();

  const didFormStateChange = computed(() => {
    return props.emailBrandingLogoUrl !== formState.EmailBrandingLogoUrl;
  });

  const isPending = computed(() => useUiStore().isRequestPending('editOrg'));

  const formState = reactive({
    EmailBrandingLogoUrl: props.emailBrandingLogoUrl,
  });

  const DEFAULT_LOGO_SRC = '/images/email/easy-genomics.png';
  const DEFAULT_FOOTER_TEXT = 'Sent from Easy Genomics';

  const logoFileInput = ref<HTMLInputElement | null>(null);
  const isUploadingLogo = ref(false);
  const uploadError = ref('');
  const isSendingTestEmail = ref(false);
  const logoPreviewFailed = ref(false);

  const isUsingCustomLogo = computed(() => !!formState.EmailBrandingLogoUrl);
  const logoPreviewSrc = computed(() => formState.EmailBrandingLogoUrl || DEFAULT_LOGO_SRC);

  const previewOutcome = ref<'success' | 'failed'>('success');
  const previewHeading = computed(() =>
    previewOutcome.value === 'success' ? 'Run "Sample Run" completed successfully' : 'Run "Sample Run" failed',
  );

  watch(
    () => formState.EmailBrandingLogoUrl,
    () => {
      logoPreviewFailed.value = false;
    },
  );

  async function handleLogoFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    uploadError.value = '';
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      uploadError.value = 'Only PNG or JPEG images are supported.';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      uploadError.value = 'Image must be 2MB or smaller.';
      return;
    }

    isUploadingLogo.value = true;
    try {
      const uploadInfo = await $api.organizationEmailBranding.createLogoUploadRequest(props.orgId, {
        ContentType: file.type as 'image/png' | 'image/jpeg',
        ContentLength: file.size,
      });
      await uploadToPresignedUrl(uploadInfo.S3Url, file);
      formState.EmailBrandingLogoUrl = uploadInfo.PublicUrl;
    } catch (err) {
      uploadError.value = 'Upload failed. Please try again.';
    } finally {
      isUploadingLogo.value = false;
      input.value = '';
    }
  }

  async function sendTestEmail() {
    isSendingTestEmail.value = true;
    try {
      await $api.organizationEmailBranding.requestBrandingTestEmail(props.orgId, {
        EmailBrandingLogoUrl: formState.EmailBrandingLogoUrl || undefined,
      });
      useToastStore().success('Test email sent — check your inbox.');
    } catch (error) {
      useToastStore().error('Failed to send test email');
    } finally {
      isSendingTestEmail.value = false;
    }
  }
</script>

<template>
  <UForm
    :schema="OrgEmailBrandingFormSchema"
    :state="formState"
    @submit="$emit('submit-form-org-email-branding', $event)"
  >
    <EGCard>
      <EGFormGroup label="Email branding logo URL" name="EmailBrandingLogoUrl">
        <div class="flex gap-2">
          <EGInput
            v-model.trim="formState.EmailBrandingLogoUrl"
            placeholder="Paste an image URL, or upload one"
            :disabled="isPending || isUploadingLogo"
            class="flex-1"
          />
          <label for="email-branding-logo-input" class="sr-only">Upload email branding logo</label>
          <input
            id="email-branding-logo-input"
            ref="logoFileInput"
            type="file"
            accept="image/png,image/jpeg"
            hidden
            @change="handleLogoFileSelected"
          />
          <EGButton
            :size="ButtonSizeEnum.enum.sm"
            variant="secondary"
            label="Upload"
            :loading="isUploadingLogo"
            :disabled="isPending || isUploadingLogo"
            @click="logoFileInput?.click()"
          />
        </div>
        <p v-if="uploadError" class="text-alert-danger mt-1 text-sm">{{ uploadError }}</p>
        <p v-if="logoPreviewFailed" class="text-alert-danger mt-1 text-xs">
          That logo URL doesn't load — check the preview below.
        </p>
      </EGFormGroup>
    </EGCard>

    <div class="mb-2 mt-6 flex items-center justify-between">
      <p class="text-sm font-medium text-gray-700">
        Email preview
        <span class="font-normal text-gray-500">
          — {{ isUsingCustomLogo ? 'using your logo above' : 'using the default Easy Genomics logo' }}, with sample run
          data
        </span>
      </p>
      <div class="flex gap-1 rounded border border-gray-200 bg-gray-50 p-0.5">
        <button
          type="button"
          class="rounded px-2 py-1 text-xs font-medium"
          :class="previewOutcome === 'success' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'"
          @click="previewOutcome = 'success'"
        >
          Success
        </button>
        <button
          type="button"
          class="rounded px-2 py-1 text-xs font-medium"
          :class="previewOutcome === 'failed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'"
          @click="previewOutcome = 'failed'"
        >
          Failed
        </button>
      </div>
    </div>
    <div class="rounded border border-gray-200 bg-gray-50 p-6">
      <div class="mx-auto max-w-md rounded bg-white p-6 shadow-sm">
        <div class="mb-6 flex h-10 items-center">
          <img
            v-if="!logoPreviewFailed"
            :src="logoPreviewSrc"
            alt="Email logo preview"
            class="max-h-10 max-w-[160px] object-contain"
            @error="logoPreviewFailed = true"
          />
          <span v-else class="text-alert-danger text-xs">Logo failed to load</span>
        </div>
        <h2 class="mb-3 text-lg font-semibold text-gray-900">{{ previewHeading }}</h2>
        <p class="mb-2 text-sm text-gray-700">
          <span class="font-semibold">Laboratory:</span>
          Sample Laboratory
        </p>
        <p class="mb-2 text-sm text-gray-700">
          <span class="font-semibold">Workflow:</span>
          nf-core/demo-1.0.1
        </p>
        <p class="mb-2 text-sm text-gray-700">
          <span class="font-semibold">Run time:</span>
          0d 0h 15m 11s
        </p>
        <p class="my-6">
          <span class="inline-block rounded bg-blue-600 px-5 py-3 text-sm font-bold text-white">View run details</span>
        </p>
        <p class="mb-2 text-sm text-gray-600">{{ DEFAULT_FOOTER_TEXT }}</p>
        <p class="text-xs text-gray-400">&copy; {{ new Date().getFullYear() }} Easy Genomics</p>
      </div>
    </div>
    <EGButton
      :size="ButtonSizeEnum.enum.sm"
      :disabled="isPending || !didFormStateChange"
      type="submit"
      label="Save changes"
      class="mt-6"
      :loading="isPending"
    />
    <EGButton
      :size="ButtonSizeEnum.enum.sm"
      variant="secondary"
      label="Send test email"
      class="ml-2 mt-6"
      :disabled="isPending || isSendingTestEmail"
      :loading="isSendingTestEmail"
      @click="sendTestEmail"
    />
  </UForm>
</template>

<style scoped lang="scss"></style>
