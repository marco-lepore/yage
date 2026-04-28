import {
  Component,
  Entity,
  EventBusKey,
  LoadingScene,
  serializable,
} from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import { UIPanel } from "./UIPanel.js";
import { UIProgressBar } from "./UIProgressBar.js";
import { Anchor } from "./types.js";
import type { BackgroundOptions } from "./types.js";

/** Default track and fill appearance for the loading progress bar. */
const DEFAULT_TRACK: BackgroundOptions = { color: 0x1e293b, alpha: 1 };
const DEFAULT_FILL: BackgroundOptions = { color: 0x38bdf8, alpha: 1 };

/** Customization for the default loading progress bar. */
export interface LoadingSceneProgressBarOptions {
  /** Bar width in virtual pixels. Default 400. */
  width?: number;
  /** Bar height in virtual pixels. Default 16. */
  height?: number;
  /** Track (background) background. Default solid dark slate. */
  track?: BackgroundOptions;
  /** Fill (progress) background. Default solid cyan. */
  fill?: BackgroundOptions;
  /**
   * Full-viewport backdrop rendered behind the bar. Without one, the
   * loading scene is transparent and the outgoing scene bleeds through
   * during transitions. Set to a solid color or a textured background to
   * cover the viewport.
   */
  backdrop?: BackgroundOptions;
  /** Screen anchor for the bar. Default `Anchor.Center`. */
  anchor?: Anchor;
  /** Offset from the anchor in virtual pixels. Default `{ x: 0, y: 0 }`. */
  offset?: { x: number; y: number };
  /** Name of the UI layer to mount on. Default UI's auto-provisioned layer. */
  layer?: string;
}

/**
 * Ready-made loading progress bar for use inside a `LoadingScene`.
 *
 * Spawn it from the scene's `onEnter`, then call `this.startLoading()` to
 * kick off the load:
 * ```ts
 * class Boot extends LoadingScene {
 *   readonly target = new GameScene();
 *   override onEnter() {
 *     this.spawn(LoadingSceneProgressBar);
 *     this.startLoading();
 *   }
 * }
 * ```
 *
 * Subscribes to `scene:loading:progress` internally and updates a
 * `UIProgressBar`. For spinners, animated text, or other custom visuals,
 * write your own component that subscribes to the same event.
 */
/**
 * Not `@serializable`: the loading bar is a transient UI for a transient
 * scene. Mid-load save/restore is not a supported flow — by the time the
 * snapshot is loaded, the destination scene should be active.
 */
export class LoadingSceneProgressBar extends Entity {
  setup(opts: LoadingSceneProgressBarOptions = {}): void {
    const scene = this.scene;
    if (!(scene instanceof LoadingScene)) {
      throw new Error(
        "LoadingSceneProgressBar must be spawned inside a LoadingScene.",
      );
    }

    // Optional backdrop — spawned as a sibling entity so the bar's panel
    // stays independently anchored. The backdrop covers the full virtual
    // viewport with the provided background. Spawned first so it sits
    // beneath the bar in the UI layer.
    let backdropEntity: Entity | undefined;
    if (opts.backdrop) {
      const { width: vw, height: vh } = scene.context
        .resolve(RendererKey)
        .virtualSize;
      backdropEntity = scene.spawn("__loading-backdrop__");
      backdropEntity.add(
        new UIPanel({
          anchor: Anchor.TopLeft,
          width: vw,
          height: vh,
          background: opts.backdrop,
          ...(opts.layer ? { layer: opts.layer } : {}),
        }),
      );
    }

    const panel = this.add(
      new UIPanel({
        anchor: opts.anchor ?? Anchor.Center,
        ...(opts.offset ? { offset: opts.offset } : {}),
        ...(opts.layer ? { layer: opts.layer } : {}),
        direction: "column",
      }),
    );

    const bar = new UIProgressBar({
      value: scene.progress,
      width: opts.width ?? 400,
      height: opts.height ?? 16,
      trackBackground: opts.track ?? DEFAULT_TRACK,
      fillBackground: opts.fill ?? DEFAULT_FILL,
    });
    panel.addElement(bar);

    this.add(new LoadingProgressSync(bar, backdropEntity));
  }
}

/**
 * Internal — syncs a UIProgressBar's value to the current LoadingScene's
 * progress by subscribing to `scene:loading:progress` on the event bus.
 *
 * `serialize()` returns null because the component holds a runtime closure
 * (event-bus unsubscribe) that can't round-trip through a snapshot.
 */
@serializable
class LoadingProgressSync extends Component {
  private unsub?: () => void;

  constructor(
    private readonly bar: UIProgressBar,
    private readonly backdrop: Entity | undefined,
  ) {
    super();
  }

  override onAdd(): void {
    const scene = this.scene;
    const bus = scene.context.resolve(EventBusKey);

    this.unsub = bus.on("scene:loading:progress", (ev) => {
      if (ev.scene !== scene) return;
      this.bar.update({ value: ev.ratio });
    });
  }

  override onDestroy(): void {
    this.unsub?.();
    this.backdrop?.destroy();
  }

  serialize(): null {
    return null;
  }
}
