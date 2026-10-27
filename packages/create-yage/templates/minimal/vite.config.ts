import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  // The mode picks the target: `vite build --mode electron` and
  // `--mode capacitor` build the desktop and mobile pages into their own
  // directories, and anything else builds the browser page into `dist/`.
  // `npx yage-pack init` writes the entry file each of the other targets
  // loads.
  const target = mode === "electron" || mode === "capacitor" ? mode : "web";

  return {
    plugins: [
      {
        name: "target-entry",
        transformIndexHtml: {
          order: "pre" as const,
          handler: (html: string) =>
            target === "web"
              ? html
              : html.replace("/src/main.web.ts", `/src/main.${target}.ts`),
        },
      },
    ],
    oxc: {
      // YAGE's @trait decorator uses TypeScript's legacy decorator transform.
      decorator: {
        legacy: true,
      },
    },
    build: {
      outDir: target === "web" ? "dist" : `dist-${target}`,
    },
  };
});
