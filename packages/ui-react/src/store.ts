// Store and createStore are now provided by @yagejs/core. This module
// re-exports them so existing ui-react importers (`@yagejs/ui-react`'s own
// `useStore`, plus user code) keep working unchanged.
export { createStore } from "@yagejs/core";
export type { Store } from "@yagejs/core";
