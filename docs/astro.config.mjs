import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "YAGE",
      description: "Yet Another Game Engine — A modular 2D game engine for TypeScript",
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
            { label: "Your First Game", slug: "getting-started/your-first-game" },
            { label: "Project Structure", slug: "getting-started/project-structure" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Engine & Plugins", slug: "concepts/engine-and-plugins" },
            { label: "Entities & Components", slug: "concepts/entities-and-components" },
            { label: "Systems", slug: "concepts/systems" },
            { label: "Scenes", slug: "concepts/scenes" },
            { label: "Events", slug: "concepts/events" },
            { label: "Dependency Injection", slug: "concepts/dependency-injection" },
            { label: "Game Loop", slug: "concepts/game-loop" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Rendering", slug: "guides/rendering" },
            { label: "Input", slug: "guides/input" },
            { label: "Processes & Tweens", slug: "guides/processes-and-tweens" },
          ],
        },
        {
          label: "Patterns",
          items: [
            { label: "Entity Subclasses", slug: "patterns/entity-subclasses" },
            { label: "Testing", slug: "patterns/testing" },
          ],
        },
      ],
    }),
  ],
});
