/**
 * Shared runtime placeholders for namespace imports.
 */
// @ts-nocheck
export const placeholder = new Proxy(() => undefined, {
  get: () => placeholder,
  apply: () => undefined
});
