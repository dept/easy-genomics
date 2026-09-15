<script setup lang="ts">
  /**
   * Renders different HTML tags based on the provided tag prop.
   * It can render headings from h1 to h6, paragraph, div, and span, each with specific styles defined in the style section.
   * Specifies a color class to use for the element being rendered.
   *
   * Optional `size` overrides the default tag-based heading size (lg/md/sm/xs).
   * Omit it to keep the existing tag defaults unchanged.
   */
  defineProps({
    colorClass: {
      default: 'text-body',
      type: String,
    },
    href: {
      type: String,
    },
    size: {
      type: String,
      required: false,
      default: undefined,
      validator: (size: string | undefined) => size === undefined || ['lg', 'md', 'sm', 'xs'].includes(size),
    },
    small: {
      type: Boolean,
    },
    tag: {
      type: [String],
      validator: (tag: string) => ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'a', 'small'].includes(tag),
    },
  });
</script>

<template>
  <component
    :href="href"
    :is="tag"
    :class="[
      `${colorClass}`,
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(<string>tag) ? `text-heading font-serif` : '',
      ['a'].includes(<string>tag) ? `hover:underline` : '',
      size ? `eg-text--size-${size}` : '',
    ]"
  >
    <slot />
  </component>
</template>

<style scoped lang="scss">
  @use '@/styles/helpers';

  h1,
  h2 {
    font-weight: 600;
  }
  h1 {
    font-size: toRem(36px);
    line-height: toRem(42px);
    font-style: normal;

    > p {
      margin-bottom: toRem(30px);
    }
  }
  h2 {
    font-size: toRem(36px);
    line-height: toRem(44px);
  }
  h3 {
    font-size: toRem(24px);
    line-height: toRem(32px);
  }
  h4 {
    font-size: toRem(18px);
    line-height: toRem(22px);
  }
  h5 {
    font-size: toRem(14px);
    line-height: toRem(20px);
  }
  h3,
  h4,
  h5 {
    font-weight: 500;
    letter-spacing: toRem(-0.14px);

    > p {
      margin-bottom: 1.2rem;
    }
  }

  a,
  p,
  div,
  span {
    line-height: toRem(24px);
    font-weight: 400;
    letter-spacing: 0;
  }

  small {
    font-weight: 400;
    line-height: toRem(16px);
    letter-spacing: 0.2px;
  }

  // Optional size overrides — only applied when `size` prop is set.
  .eg-text--size-lg {
    font-size: toRem(36px);
    line-height: toRem(42px);
  }
  .eg-text--size-md {
    font-size: toRem(24px);
    line-height: toRem(32px);
  }
  .eg-text--size-sm {
    font-size: toRem(20px);
    line-height: toRem(28px);
  }
  .eg-text--size-xs {
    font-size: toRem(18px);
    line-height: toRem(22px);
  }
</style>
