import { Component, Entity, Scene, SceneManagerKey, Vec2 } from "@yagejs/core";
import { CameraEntity, slidePush } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import {
  COMPACT_RECIPE_PANELS,
  ESSENTIAL_PANELS,
  HEIGHT,
  MORE_PANELS,
  PAGE_COUNT,
  WIDTH,
  type PanelRect,
} from "./constants.js";
import {
  GalleryBackdrop,
  GalleryHud,
  type ShowcaseController,
  type ShowcaseDemo,
} from "./gallery.js";
import {
  CustomDemo,
  DashDemo,
  HighlightDemo,
  ImpactDemo,
} from "./essentials.js";
import {
  AnimationDemo,
  CompositionDemo,
  PunchDemo,
  ShockwaveDemo,
  SlowMotionDemo,
  VisibilityDemo,
} from "./more-effects.js";
import {
  DissolveDemo,
  GlitchDemo,
  ImplosionDemo,
  SpeedBlurDemo,
  VoidCollapseDemo,
} from "./advanced-effects.js";
import {
  DamageImpactRecipeDemo,
  DashBurstRecipeDemo,
  EnemyDeathRecipeDemo,
  ImpactRecipeDemo,
  SpawnPopRecipeDemo,
} from "./practical-recipes.js";

/** What one page hands to the next when the player turns the page. */
export interface GallerySettings {
  autoplay: boolean;
}

// ---------------------------------------------------------------------------
// Page navigation
// ---------------------------------------------------------------------------

/** N and P replace the page with the next or previous one. */
class GalleryNavigation extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);
  private readonly page: number;
  private readonly showcase: ShowcaseController;
  private armed = false;
  private navigating = false;

  constructor(page: number, showcase: ShowcaseController) {
    super();
    this.page = page;
    this.showcase = showcase;
  }

  update(): void {
    if (!this.armed) {
      this.armed = true;
      return;
    }
    if (this.navigating || this.scenes.isTransitioning) return;
    const direction = this.input.isJustPressed("nextPage")
      ? 1
      : this.input.isJustPressed("previousPage")
        ? -1
        : 0;
    if (direction === 0) return;

    this.navigating = true;
    const nextPage = (this.page + direction + PAGE_COUNT) % PAGE_COUNT;
    void this.scenes.replace(
      createShowcaseScene(nextPage, { autoplay: this.showcase.autoplay }),
      {
        transition: slidePush({
          duration: 0.45,
          direction: direction > 0 ? "left" : "right",
          reverseOnPop: false,
        }),
      },
    );
  }
}

class GalleryNavigator extends Entity {
  setup(params: { page: number; showcase: ShowcaseController }): void {
    this.add(new GalleryNavigation(params.page, params.showcase));
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** One gallery page: the backdrop, its demos, the HUD and page navigation. */
abstract class FeelGalleryScene extends Scene {
  /** Zero-based page number. */
  protected abstract readonly page: number;
  protected abstract readonly panels: readonly PanelRect[];
  /** Panel headings, in the order of `panels`. */
  protected abstract readonly titles: readonly string[];
  private readonly settings: GallerySettings;

  constructor(settings: GallerySettings) {
    super();
    this.settings = settings;
  }

  onEnter(): void {
    const camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.spawn(GalleryBackdrop, {
      panels: this.panels,
      titles: this.titles,
    });
    const demos = this.spawnDemos(camera);
    const hud = this.spawn(GalleryHud, {
      page: this.page,
      autoplay: this.settings.autoplay,
      demos,
    });
    this.spawn(GalleryNavigator, { page: this.page, showcase: hud.showcase });
  }

  /** The page's demos in cue order: key 1 plays the first. */
  protected abstract spawnDemos(camera: CameraEntity): ShowcaseDemo[];
}

class EssentialsScene extends FeelGalleryScene {
  readonly name = "feel-addon-essentials";
  protected readonly page = 0;
  protected readonly panels = ESSENTIAL_PANELS;
  protected readonly titles = [
    "1  IMPACT",
    "3  OUTLINE + GLOW",
    "4  CUSTOM EFFECT",
    "2  CURVED TRAIL + AFTERIMAGES",
  ];

  protected spawnDemos(camera: CameraEntity): ShowcaseDemo[] {
    return [
      this.spawn(ImpactDemo, { position: new Vec2(165, 235), camera }),
      this.spawn(DashDemo, { start: new Vec2(120, 425) }),
      this.spawn(HighlightDemo, { position: new Vec2(450, 235) }),
      this.spawn(CustomDemo, { position: new Vec2(735, 235) }),
    ];
  }
}

class MoreEffectsScene extends FeelGalleryScene {
  readonly name = "feel-addon-more-effects";
  protected readonly page = 1;
  protected readonly panels = MORE_PANELS;
  protected readonly titles = [
    "1  RECOIL + SPRINGS",
    "2  FADE + BLINK",
    "3  SEQUENCE + REPEAT",
    "4  TARGET TIME",
    "5  ANIMATION + CALLBACK",
    "6  SCENE SHOCKWAVE",
  ];

  protected spawnDemos(): ShowcaseDemo[] {
    return [
      this.spawn(PunchDemo, { position: new Vec2(165, 215) }),
      this.spawn(VisibilityDemo, { position: new Vec2(450, 215) }),
      this.spawn(CompositionDemo, { position: new Vec2(735, 215) }),
      this.spawn(SlowMotionDemo, { position: new Vec2(165, 435) }),
      this.spawn(AnimationDemo, { position: new Vec2(450, 425) }),
      this.spawn(ShockwaveDemo, { position: new Vec2(735, 435) }),
    ];
  }
}

class AdvancedEffectsScene extends FeelGalleryScene {
  readonly name = "feel-addon-advanced-effects";
  protected readonly page = 2;
  protected readonly panels = COMPACT_RECIPE_PANELS;
  protected readonly titles = [
    "1  GLITCH",
    "2  ZOOM + AXIS BLUR",
    "3  IMPLOSION PRIMITIVE",
    "4  RECIPE: VOID COLLAPSE",
    "5  DISSOLVE OUT",
  ];

  protected spawnDemos(): ShowcaseDemo[] {
    return [
      this.spawn(GlitchDemo, { position: new Vec2(165, 215) }),
      this.spawn(SpeedBlurDemo, { position: new Vec2(450, 215) }),
      this.spawn(ImplosionDemo, { position: new Vec2(735, 215) }),
      this.spawn(VoidCollapseDemo, { position: new Vec2(236, 425) }),
      this.spawn(DissolveDemo, { position: new Vec2(664, 425) }),
    ];
  }
}

class PracticalRecipesScene extends FeelGalleryScene {
  readonly name = "feel-addon-practical-recipes";
  protected readonly page = 3;
  protected readonly panels = COMPACT_RECIPE_PANELS;
  protected readonly titles = [
    "1  RECIPE: IMPACT",
    "2  RECIPE: DAMAGE IMPACT",
    "3  RECIPE: DASH BURST",
    "4  RECIPE: SPAWN POP",
    "5  RECIPE: ENEMY DEATH",
  ];

  protected spawnDemos(): ShowcaseDemo[] {
    return [
      this.spawn(ImpactRecipeDemo, { position: new Vec2(165, 215) }),
      this.spawn(DamageImpactRecipeDemo, { position: new Vec2(450, 215) }),
      this.spawn(DashBurstRecipeDemo, { position: new Vec2(735, 215) }),
      this.spawn(SpawnPopRecipeDemo, { position: new Vec2(236, 425) }),
      this.spawn(EnemyDeathRecipeDemo, { position: new Vec2(664, 425) }),
    ];
  }
}

/** The scene for a zero-based page number. */
export function createShowcaseScene(
  page: number,
  settings: GallerySettings,
): FeelGalleryScene {
  if (page === 0) return new EssentialsScene(settings);
  if (page === 1) return new MoreEffectsScene(settings);
  if (page === 2) return new AdvancedEffectsScene(settings);
  return new PracticalRecipesScene(settings);
}
