<script setup lang="ts">
  export type PageBreadcrumb =
    | string
    | {
        label: string;
        to?: string | Record<string, unknown>;
      };

  type NormalizedBreadcrumb = {
    label: string;
    to?: string | Record<string, unknown>;
  };

  const props = withDefaults(
    defineProps<{
      title: string;
      titleId?: string;
      description?: string;
      showBack: boolean;
      backButtonLabel?: string;
      backAction?: () => void;
      isLoading?: boolean;
      skeletonConfig?: {
        titleLines?: number;
        descriptionLines?: number;
      };
      showOrgBreadcrumb?: boolean;
      showLabBreadcrumb?: boolean;
      breadcrumbs?: PageBreadcrumb[];
    }>(),
    {
      backButtonLabel: 'Back',
      isLoading: false,
      backAction: () => {},
      description: '',
    },
  );

  const skeletonTitleLines = computed(() => props.skeletonConfig?.titleLines ?? 1);
  const skeletonDescriptionLines = computed(() => props.skeletonConfig?.descriptionLines ?? 1);

  const breadcrumbs = computed<NormalizedBreadcrumb[]>(() => {
    if (!props.breadcrumbs?.length) return [];

    return props.breadcrumbs
      .map((crumb): NormalizedBreadcrumb | null => {
        if (typeof crumb === 'string') {
          return crumb ? { label: crumb } : null;
        }
        return crumb.label ? { label: crumb.label, to: crumb.to } : null;
      })
      .filter((crumb): crumb is NormalizedBreadcrumb => crumb !== null);
  });

  function isCurrentCrumb(index: number): boolean {
    return index === breadcrumbs.value.length - 1;
  }

  function isClickableCrumb(crumb: NormalizedBreadcrumb, index: number): boolean {
    return Boolean(crumb.to) && !isCurrentCrumb(index);
  }
</script>

<template>
  <div class="mb-6 flex flex-col justify-between">
    <div class="min-h-[40px]">
      <div class="mb-4 flex flex-row items-center gap-6">
        <EGBack v-if="showBack" :label="backButtonLabel" :back-action="backAction" />

        <nav v-if="showOrgBreadcrumb || showLabBreadcrumb || breadcrumbs.length" aria-label="Breadcrumb">
          <ol class="font-schibsted text-body flex list-none flex-row flex-wrap items-center gap-4 p-0 text-sm">
            <li v-if="showOrgBreadcrumb">
              <EGBreadcrumbOrgs />
            </li>

            <template v-if="showLabBreadcrumb">
              <li aria-hidden="true">/</li>
              <li>
                <EGBreadcrumbLabs />
              </li>
            </template>

            <template v-for="(crumb, crumbIndex) in breadcrumbs" :key="crumbIndex">
              <li aria-hidden="true">/</li>
              <li>
                <NuxtLink
                  v-if="isClickableCrumb(crumb, crumbIndex) && crumb.to"
                  :to="crumb.to"
                  class="focus-visible:ring-primary-500 text-gray-500 hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                >
                  {{ crumb.label }}
                </NuxtLink>
                <span v-else :aria-current="isCurrentCrumb(crumbIndex) ? 'page' : undefined">{{ crumb.label }}</span>
              </li>
            </template>
          </ol>
        </nav>
      </div>

      <EGAdminAlert v-if="useUserStore().isSuperuser" class="mb-4" />
    </div>
    <div class="flex min-h-[52px] items-start justify-between">
      <div class="w-full">
        <template v-if="isLoading">
          <USkeleton v-for="line in skeletonTitleLines" class="mb-2 min-h-12 w-3/4 rounded" :key="line" />
          <USkeleton v-for="line in skeletonDescriptionLines" class="mt-4 min-h-5 w-[150px] rounded" :key="line" />
        </template>
        <template v-else>
          <EGText :id="titleId" tag="h1" class="mb-0">{{ title }}</EGText>
          <EGText v-if="description" tag="p" class="text-muted mt-4 rounded">{{ description }}</EGText>
        </template>
      </div>
      <div class="relative flex flex-col items-end">
        <!-- Right-aligned content  -->
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .skeleton {
    background: #e0e0e0;
    height: 1em;
    margin-bottom: 0.5em;
    border-radius: 4px;
  }
</style>
