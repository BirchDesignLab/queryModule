/** The one Vite build flag the primitives read (diagnostics show in development builds only). */
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
