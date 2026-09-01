import { defineEditorConfig } from "@yagejs-tools/editor";

export default defineEditorConfig({
  modules: {
    project: "../src/levelProject.ts",
    harness: "../lab/harness.ts",
  },
  levels: ["levels/*.yage-level.json"],
  assets: ["sprites/*.png"],
  gamePage: "/game.html",
});
