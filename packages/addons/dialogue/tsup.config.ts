import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  // Four entries enforce the export splits:
  //   "."            -> src/index.ts      (headless: no pixi / @yagejs/renderer)
  //   "./presenters" -> src/presenters.ts (pixi: chrome/render/composite/avatar)
  //   "./yaml"       -> src/yaml.ts       (the ONLY entry that pulls `yaml`,
  //                     kept off the root so JSON/expression authors never bundle it)
  //   "./yarn"       -> src/yarn.ts       (the Yarn Spinner compiler, kept off
  //                     the root so games that don't use Yarn never bundle it)
  entry: ["src/index.ts", "src/presenters.ts", "src/yaml.ts", "src/yarn.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
});
