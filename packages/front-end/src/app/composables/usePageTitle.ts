/**
 * Sets the document title for the current page (SPA route).
 * Requires `app.head.titleTemplate` in nuxt.config (e.g. "%s — Easy Genomics").
 */
export function usePageTitle(title: MaybeRefOrGetter<string>) {
  useHead({
    title: () => toValue(title),
  });
}
