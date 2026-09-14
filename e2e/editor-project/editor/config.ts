import { defineEditorConfig } from "@yagejs-tools/editor";

export default defineEditorConfig({
  modules: {
    project: "../src/levelProject.ts",
    harness: "../lab/harness.ts",
  },
  levels: [
    { glob: "levels/*.yage-level.json", layers: "../src/forestLayers.ts" },
  ],
  assets: ["sprites/*.png", "maps/*.json"],
  gamePage: "/game.html",
});
