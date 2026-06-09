<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      initials?: string | null;
      name?: string | null;
      email?: string | null;
      organization?: string | null;

      inactive?: boolean;
    }>(),
    {
      initials: null,
      name: null,
      email: null,
      organization: null,

      inactive: false,
    },
  );

  const avatarColour = computed<string>(() => (props.inactive ? 'bg-primary-muted text-primary-dark' : ''));
</script>

<template>
  <div class="flex flex-row items-center gap-3">
    <div
      v-if="initials"
      class="bg-primary flex h-8 w-8 items-center justify-center rounded-full text-xs text-white"
      :class="avatarColour"
      aria-hidden="true"
    >
      {{ initials }}
    </div>

    <div class="flex grow flex-col items-start gap-1">
      <div v-if="name" class="text-left font-medium">{{ name }}</div>
      <div v-if="organization" class="text-muted text-left">{{ organization }}</div>
      <div v-if="email" class="text-muted text-xs font-normal">{{ email }}</div>
    </div>
  </div>
</template>
