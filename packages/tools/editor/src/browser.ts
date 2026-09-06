// Entry point `@yagejs-tools/editor/browser`, declared as a subpath export so
// it is reachable by specifier rather than by path. The generated editor page
// imports `mountEditor` from here.
export { mountEditor } from "./browser/mount.js";
export type { EditorHandle, MountEditorOptions } from "./browser/mount.js";
export { mountPlay } from "./browser/play/index.js";
export type { MountPlayOptions, PlayHandle } from "./browser/play/index.js";
