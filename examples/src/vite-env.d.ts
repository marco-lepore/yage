// Vite resolves a bare CSS import for its side effect (injecting the stylesheet).
// `tsc --noEmit` has no vite/client types, so declare the module shape it needs.
declare module "*.css";
