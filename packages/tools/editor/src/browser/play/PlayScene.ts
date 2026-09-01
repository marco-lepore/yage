import { Scene } from "@yagejs/core";
import { CameraEntity } from "@yagejs/renderer";
import { instantiateLevel, type PreparedLevel } from "@yagejs/level";

/** Where the play page's own scene key lives, kept clear of a game's. */
export const PLAY_SCENE_NAME = "yage-editor/play";

/**
 * The level, running.
 *
 * The same document the editor is holding, instantiated with nothing held
 * back: components update, systems query the entities, and a placement
 * authored inactive stays inactive because that is what the game would do.
 * The editor's preview is the opposite of this by design, and the two are
 * separate scenes in separate pages so neither can become the other by
 * accident.
 *
 * The camera is the editor's, not the level's: without one the world origin
 * would sit in the page's top-left corner rather than the middle, so a level
 * would look nothing like it did while it was built. A camera the level
 * authors is an ordinary entity and takes over by its own priority.
 */
export class PlayScene extends Scene {
  readonly name = PLAY_SCENE_NAME;

  constructor(private readonly level: PreparedLevel) {
    super();
  }

  onEnter(): void {
    this.spawn(CameraEntity, { priority: 0 });
    instantiateLevel(this, this.level, { namespace: "play" });
  }
}
