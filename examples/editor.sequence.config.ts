import { defineEditorConfig } from "@yagejs-tools/editor";
export default defineEditorConfig({
  modules: {
    project: "./src/sequence/editorProject.ts",
    harness: "./src/sequence/editorHarness.ts",
  },
  levels: ["src/sequence/preview-levels/*.yage-level.json"],
  sequences: ["src/sequence/*.yage-sequence-workspace.json"],
});
