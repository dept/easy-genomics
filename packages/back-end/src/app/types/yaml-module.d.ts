/**
 * Allows importing `.yaml` files as raw text. At build time the esbuild
 * `'.yaml': 'text'` loader (configured in lambda-construct.ts) inlines the file
 * contents as the default string export.
 */
declare module '*.yaml' {
  const content: string;
  export default content;
}
