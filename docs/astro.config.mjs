import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  vite: {
    plugins: [wasm()],
  },
  site: "https://yage.dev",
  integrations: [
    starlight({
      title: "YAGE",
      description:
        "Yet Another Game Engine — A modular 2D game engine for TypeScript",
      logo: {
        src: "./public/logo.svg",
        alt: "YAGE Logo",
      },
      favicon: "/logo.svg",
      customCss: ["./src/styles/custom.css"],
      plugins: [
        starlightTypeDoc({
          entryPoints: [
            "../packages/core",
            "../packages/renderer",
            "../packages/input",
            "../packages/physics",
            "../packages/audio",
            "../packages/particles",
            "../packages/tilemap",
            "../packages/ui",
            "../packages/save",
            "../packages/debug",
          ],
          tsconfig: "./tsconfig.typedoc.json",
          typeDoc: {
            entryPointStrategy: "packages",
            exclude: ["**/*.test.ts", "**/*.test.tsx"],
            excludeExternals: true,
            packageOptions: {
              entryPoints: ["src/index.ts"],
            },
          },
        }),
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/marco-lepore/yage",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            {
              label: "Your First Game",
              slug: "getting-started/your-first-game",
            },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Engine & Plugins", slug: "concepts/engine-and-plugins" },
            {
              label: "Entities & Components",
              slug: "concepts/entities-and-components",
            },
            { label: "Systems", slug: "concepts/systems" },
            { label: "Scenes", slug: "concepts/scenes" },
            { label: "Events", slug: "concepts/events" },
            {
              label: "Dependency Injection",
              slug: "concepts/dependency-injection",
            },
            { label: "Game Loop", slug: "concepts/game-loop" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Rendering", slug: "guides/rendering" },
            { label: "Input", slug: "guides/input" },
            {
              label: "Processes & Tweens",
              slug: "guides/processes-and-tweens",
            },
            { label: "Physics", slug: "guides/physics" },
            { label: "Audio", slug: "guides/audio" },
            { label: "Particles", slug: "guides/particles" },
            { label: "Tilemaps", slug: "guides/tilemaps" },
            { label: "UI", slug: "guides/ui" },
            { label: "UI (React)", slug: "guides/ui-react" },
            { label: "Save & Load", slug: "guides/save-and-load" },
            { label: "Loading Scene", slug: "guides/loading-scene" },
            { label: "Debug Tools", slug: "guides/debug" },
          ],
        },
        {
          label: "Patterns",
          items: [
            { label: "Project Layout", slug: "patterns/project-layout" },
            { label: "Entity Subclasses", slug: "patterns/entity-subclasses" },
            { label: "Testing", slug: "patterns/testing" },
            { label: "Scene Management", slug: "patterns/scene-management" },
            { label: "State Management", slug: "patterns/state-management" },
            {
              label: "Common Game Patterns",
              slug: "patterns/common-game-patterns",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Packages", slug: "getting-started/project-structure" },
          ],
        },
        typeDocSidebarGroup,
      ],
    }),
  ],
});
