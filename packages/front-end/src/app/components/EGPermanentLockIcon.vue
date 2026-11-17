<script setup lang="ts">
  defineProps<{
    noun: 'sample' | 'file';
  }>();
</script>

<template>
  <UIcon
    name="i-heroicons-lock-closed"
    class="h-3.5 w-3.5 shrink-0 text-red-600"
    :title="`This ${noun} is protected from auto-deletion when run retention expires.`"
    aria-label="Protected from auto-deletion"
  />
</template>
