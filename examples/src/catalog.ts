/**
 * The examples catalogue: every page the examples index lists, grouped into
 * sections. The index (`src/shell/`) renders its sidebar, overview, search,
 * and filters from this file.
 *
 * Each entry's `slug` is both the page (`examples/<slug>.html`) and its source
 * folder (`examples/src/<slug>/`). `vite.config.ts` fails the build when a
 * page has no entry here or an entry has no page, so adding an example means
 * adding its entry.
 */

/** Sidebar sections, in display order. */
export const SECTIONS = [
  { id: "start", title: "Start here" },
  { id: "rendering", title: "Rendering & camera" },
  { id: "effects", title: "Effects & lighting" },
  { id: "physics", title: "Physics" },
  { id: "input", title: "Input" },
  { id: "ui", title: "UI" },
  { id: "audio", title: "Audio" },
  { id: "scenes", title: "Scenes & saves" },
  { id: "world", title: "World & AI" },
  { id: "gameplay", title: "Gameplay addons" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Engine packages an example can list, in filter-chip order. `core` and
 * `renderer` are left out because every example uses them.
 */
export const PACKAGES = [
  "physics",
  "input",
  "ui",
  "ui-react",
  "audio",
  "particles",
  "lighting",
  "effects",
  "tilemap",
  "pathfinding",
  "save",
  "debug",
] as const;

export type PackageId = (typeof PACKAGES)[number];

/** Addon packages, published as `@yagejs-addons/<id>`. */
export const ADDONS = [
  "abilities",
  "dialogue",
  "feel",
  "i18n",
  "interaction",
  "inventory",
  "quests",
  "steering",
  "synth",
  "virtual-controls",
] as const;

export type AddonId = (typeof ADDONS)[number];

export interface Example {
  /** Page name without `.html`; also the folder under `examples/src/`. */
  readonly slug: string;
  readonly title: string;
  /** One sentence, shown in the overview and the stage header, and searched. */
  readonly summary: string;
  readonly section: SectionId;
  /**
   * Engine packages the example uses beyond `core` and `renderer`. `debug` is
   * listed only where the overlay is the subject: most examples can load it.
   */
  readonly packages: readonly PackageId[];
  /** Addons the example uses, the one it demonstrates first. */
  readonly addons?: readonly AddonId[];
  /** Path of the matching guide on yage.dev. */
  readonly guide: string;
}

/** Every example, grouped by section in display order. */
export const EXAMPLES: readonly Example[] = [
  // Start here
  {
    slug: "hello-world",
    title: "Hello World",
    summary:
      "The smallest setup: a few shapes drawn by the engine and renderer.",
    section: "start",
    packages: [],
    guide: "/getting-started/your-first-game/",
  },
  {
    slug: "platformer",
    title: "2D Platformer",
    summary:
      "Side-scroller with camera follow, moving platforms, coins, death pits, and physics-driven movement.",
    section: "start",
    packages: ["physics", "input", "audio"],
    guide: "/patterns/common-game-patterns/",
  },
  {
    slug: "shooter",
    title: "2D Shooter",
    summary:
      "Run-and-gun platformer with squash and stretch, hit flash, camera shake, and knockback.",
    section: "start",
    packages: ["physics", "input", "audio"],
    guide: "/patterns/common-game-patterns/",
  },
  {
    slug: "debug",
    title: "Debug Overlay",
    summary:
      "FPS, entity count, system timings, collider wireframes, and input state. Backtick toggles it.",
    section: "start",
    packages: ["debug", "physics", "input"],
    guide: "/guides/debug/",
  },

  // Rendering & camera
  {
    slug: "split-text",
    title: "Split Text",
    summary:
      "Per-glyph text effects on a loop: typewriter, wave, rainbow, glitch, explode, and more.",
    section: "rendering",
    packages: [],
    guide: "/guides/rendering/text/",
  },
  {
    slug: "camera",
    title: "Camera",
    summary: "Smooth follow with a deadzone, world bounds, shake, and zoom.",
    section: "rendering",
    packages: ["input"],
    guide: "/guides/rendering/camera/",
  },
  {
    slug: "camera-layers",
    title: "Camera Layers & Parallax",
    summary:
      "Per-layer scroll ratios for parallax, UI pinned to the screen, and a pause scene with its own camera.",
    section: "rendering",
    packages: ["input", "ui"],
    guide: "/guides/rendering/camera/",
  },
  {
    slug: "render-targets",
    title: "Render Targets & Blend Modes",
    summary:
      "A live radar drawn into an offscreen texture and shown on two screens.",
    section: "rendering",
    packages: [],
    guide: "/guides/rendering/effects/#offscreen-render-targets",
  },
  {
    slug: "responsive-ui",
    title: "Responsive Play Area",
    summary:
      "An 800×600 play area that stays fully visible at any window shape, with the HUD in the margins.",
    section: "rendering",
    packages: ["ui"],
    guide: "/guides/rendering/responsive/",
  },

  // Effects & lighting
  {
    slug: "effects-showcase",
    title: "Effects Showcase",
    summary:
      "Bloom, outline, CRT, vignette, and more, toggled at component, layer, scene, or screen scope.",
    section: "effects",
    packages: ["effects", "ui"],
    guide: "/guides/rendering/effects/",
  },
  {
    slug: "lighting",
    title: "Lighting",
    summary:
      "Warm, cool, and moving lights with shadows, plus a probe that reads the light level for gameplay.",
    section: "effects",
    packages: ["lighting"],
    guide: "/guides/lighting/",
  },
  {
    slug: "particles",
    title: "Particles",
    summary:
      "Mouse-driven emitters with four presets, six built-in shapes, and a custom texture.",
    section: "effects",
    packages: ["particles", "input"],
    guide: "/guides/particles/",
  },
  {
    slug: "feel-addon",
    title: "Feel Addon",
    summary:
      "Feedback cues: impact shake, callouts, trails, afterimages, slow motion, and a shockwave.",
    section: "effects",
    packages: ["effects", "input"],
    addons: ["feel"],
    guide: "/addons/feel/",
  },

  // Physics
  {
    slug: "physics-basics",
    title: "Physics Basics",
    summary: "Shapes bouncing in a box. Apply impulses and flip gravity.",
    section: "physics",
    packages: ["physics", "input"],
    guide: "/guides/physics/",
  },
  {
    slug: "physics-collisions",
    title: "Collisions & Sensors",
    summary:
      "Collect coins and dodge danger zones with sensors, trigger events, collision layers, and kinematic bodies.",
    section: "physics",
    packages: ["physics", "input", "audio"],
    guide: "/guides/physics/",
  },
  {
    slug: "physics-joints",
    title: "Physics Joints",
    summary:
      "Swing on a click-to-grapple rope, turn it into a bungee mid-swing, and drag a ball on a spring.",
    section: "physics",
    packages: ["physics", "input"],
    guide: "/guides/physics/",
  },
  {
    slug: "pooling",
    title: "Entity Pooling",
    summary:
      "A fountain of physics sparks, recycled through an EntityPool or spawned fresh, with live counters.",
    section: "physics",
    packages: ["physics", "input"],
    guide: "/patterns/entity-pooling/",
  },

  // Input
  {
    slug: "gamepad",
    title: "Gamepad",
    summary:
      "Twin-stick ship with a HUD showing sticks, triggers, and buttons. Falls back to WASD.",
    section: "input",
    packages: ["input"],
    guide: "/guides/input/",
  },
  {
    slug: "multitouch",
    title: "Multi-touch",
    summary:
      "Every pointer tracked separately, with labelled disks, trails, and tap ripples. Try it on a phone.",
    section: "input",
    packages: ["input"],
    guide: "/guides/input/",
  },
  {
    slug: "input-remapping",
    title: "Input Remapping",
    summary:
      "Two-player rebindable controls with conflict detection and a React rebind menu.",
    section: "input",
    packages: ["input", "ui", "ui-react"],
    guide: "/guides/input/",
  },
  {
    slug: "ui-consume",
    title: "UI Auto-consume",
    summary:
      "Two panels over a click-to-shoot area: one takes the click, the other lets it through.",
    section: "input",
    packages: ["input", "ui"],
    guide: "/guides/input/",
  },
  {
    slug: "virtual-controls",
    title: "Virtual Controls Addon",
    summary:
      "On-screen joystick and action buttons for touch screens, with 1, 2, and 4 button layouts.",
    section: "input",
    packages: ["input"],
    addons: ["virtual-controls"],
    guide: "/addons/virtual-controls/",
  },

  // UI
  {
    slug: "ui",
    title: "UI",
    summary:
      "Screen-space UI from the builder API: nine-slice panels and buttons, progress bars, checkboxes, and a HUD.",
    section: "ui",
    packages: ["ui"],
    guide: "/guides/ui/",
  },
  {
    slug: "ui-react",
    title: "UI (React)",
    summary: "The same menu as the UI example, built with React components.",
    section: "ui",
    packages: ["ui", "ui-react"],
    guide: "/guides/ui-react/",
  },
  {
    slug: "scroll-view",
    title: "Scrollable Cards",
    summary:
      "A ScrollView of reactive cards that scrolls by wheel or drag and keeps its position across updates.",
    section: "ui",
    packages: ["ui", "ui-react"],
    guide: "/guides/ui-react/",
  },
  {
    slug: "pixi-ui-kitchen-sink",
    title: "@pixi/ui Kitchen Sink",
    summary:
      "Every @pixi/ui wrapper in React: buttons, checkboxes, sliders, inputs, selects, and radio groups.",
    section: "ui",
    packages: ["ui", "ui-react"],
    guide: "/guides/ui-react/",
  },
  {
    slug: "ui-focus",
    title: "Keyboard & Gamepad Focus",
    summary:
      "A menu driven by arrow keys or a stick: a column, tabs, a grid, a scrolling list, and a nested dialog.",
    section: "ui",
    packages: ["ui", "input"],
    guide: "/guides/ui/",
  },
  {
    slug: "ui-layers",
    title: "UI Layers",
    summary:
      "Named, z-ordered layers for HUD, menu, and dialog panels. Toggle them to see the stacking.",
    section: "ui",
    packages: ["ui"],
    guide: "/guides/ui/",
  },
  {
    slug: "world-ui",
    title: "World-space UI",
    summary:
      "Nameplates and health bars that follow enemies and stay upright and the same size under zoom and rotation.",
    section: "ui",
    packages: ["ui", "input"],
    guide: "/guides/ui/",
  },
  {
    slug: "world-ui-react",
    title: "Diegetic UI (React)",
    summary:
      "The world-space UI example in React, with a tooltip that stays attached to a moving namecard.",
    section: "ui",
    packages: ["ui", "ui-react"],
    guide: "/guides/ui-react/",
  },

  // Audio
  {
    slug: "audio",
    title: "Audio",
    summary:
      "Sound pads, a music toggle, per-channel volume, and a master mute.",
    section: "audio",
    packages: ["audio", "input"],
    guide: "/guides/audio/",
  },
  {
    slug: "synth",
    title: "Synth Addon",
    summary:
      "Sound effects generated at startup, with no audio files. Click a pad to hear it and see its waveform.",
    section: "audio",
    packages: ["audio"],
    addons: ["synth"],
    guide: "/addons/synth/",
  },

  // Scenes & saves
  {
    slug: "scene-pause",
    title: "Scene Pause & Time Scale",
    summary:
      "A scene stack with a pause menu, a HUD overlay, and per-scene time scaling.",
    section: "scenes",
    packages: ["physics", "input", "ui"],
    guide: "/patterns/scene-management/",
  },
  {
    slug: "scene-transitions",
    title: "Scene Transitions",
    summary:
      "Push, pop, and replace scenes with fade, flash, cross-fade, iris, and custom transitions.",
    section: "scenes",
    packages: ["ui"],
    guide: "/guides/scene-transitions/",
  },
  {
    slug: "loading-scene",
    title: "Loading Scene",
    summary:
      "Preload the next scene's assets behind a progress bar, then fade into it.",
    section: "scenes",
    packages: ["ui", "input"],
    guide: "/guides/loading-scene/",
  },
  {
    slug: "save-stores",
    title: "Save Stores",
    summary:
      "Auto-saved settings, save slots with metadata, and progress. Continue restores the last run after a reload.",
    section: "scenes",
    packages: ["save", "input", "ui", "ui-react"],
    guide: "/guides/save-and-load/",
  },

  // World & AI
  {
    slug: "tilemap",
    title: "Tilemap",
    summary:
      "A Tiled dungeon map. WASD pans the camera and the mouse wheel zooms.",
    section: "world",
    packages: ["tilemap", "input"],
    guide: "/guides/tilemaps/",
  },
  {
    slug: "pathfinding",
    title: "Pathfinding",
    summary:
      "Grid A* on a Tiled dungeon: click anywhere and the agent walks the computed path.",
    section: "world",
    packages: ["pathfinding", "tilemap", "input"],
    guide: "/guides/pathfinding/",
  },
  {
    slug: "steering",
    title: "Steering Addon",
    summary:
      "Chasers, fleers, wanderers, a patrol, a flock, and obstacle avoidance, all reacting to your player.",
    section: "world",
    packages: ["physics", "input"],
    addons: ["steering"],
    guide: "/addons/steering/",
  },

  // Gameplay addons
  {
    slug: "dialogue-addon",
    title: "Dialogue Addon",
    summary:
      "Branching dialogue with a typewriter box, a speech bubble, choices, and animated text effects.",
    section: "gameplay",
    packages: ["input", "audio"],
    addons: ["dialogue"],
    guide: "/addons/dialogue/",
  },
  {
    slug: "inventory-addon",
    title: "Inventory Addon",
    summary:
      "A grid backpack and a key-item list with stacking, Use, Equip, and Drop actions, sorting, and a locked door.",
    section: "gameplay",
    packages: ["input"],
    addons: ["inventory"],
    guide: "/addons/inventory/",
  },
  {
    slug: "interaction",
    title: "Interaction Addon",
    summary: "Walk up to an NPC, a coin, or a door, see a prompt, and press E.",
    section: "gameplay",
    packages: ["input"],
    addons: ["interaction"],
    guide: "/addons/interaction/",
  },
  {
    slug: "quests-addon",
    title: "Quests Addon",
    summary:
      "A quest log driven by inventory pickups and dialogue, with prerequisites and auto-completion.",
    section: "gameplay",
    packages: ["input"],
    addons: ["quests", "inventory", "dialogue"],
    guide: "/addons/quests/",
  },
  {
    slug: "abilities-addon",
    title: "Abilities Addon",
    summary:
      "A brawler with combos, a homing fireball, dash cancels, parries, hitstop, and telegraphed enemy attacks.",
    section: "gameplay",
    packages: ["physics", "input", "audio", "particles"],
    addons: ["abilities"],
    guide: "/addons/abilities/",
  },
  {
    slug: "i18n",
    title: "Localization",
    summary:
      "Switch language mid-line and watch text, UI, dialogue, inventory, and quests update in place.",
    section: "gameplay",
    packages: ["ui", "ui-react", "input"],
    addons: ["i18n", "dialogue", "inventory", "quests"],
    guide: "/addons/i18n/",
  },
];
