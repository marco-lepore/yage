import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  // One entry per optional peer, so the root stays free of pixi and React:
  //   "."            -> src/index.ts      (messages, service, i18next backend, plugin)
  //   "./renderer"   -> src/renderer.ts   (@yagejs/renderer text components)
  //   "./ui"         -> src/ui.ts         (@yagejs/ui elements and builders)
  //   "./ui-react"   -> src/ui-react.ts   (React components and hooks)
  //   "./inventory"  -> src/inventory.ts  (@yagejs-addons/inventory presenters)
  entry: [
    "src/index.ts",
    "src/renderer.ts",
    "src/ui.ts",
    "src/ui-react.ts",
    "src/inventory.ts",
  ],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
  external: ["react"],
});
