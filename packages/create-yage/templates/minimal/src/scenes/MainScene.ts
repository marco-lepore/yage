import { Scene } from "@yagejs/core";
import { Placeholder } from "../entities/Placeholder";

/**
 * Starter scene. Edit this file to start building your game.
 *
 * `onEnter` assembles the scene: it spawns entities and sets up the camera.
 * The game's rules live in components on those entities, not here.
 *
 * Some things to try:
 *   - Draw a sprite: `new SpriteComponent(texture("/assets/hero.png"))`
 *   - Add physics:   `npm install @yagejs/physics` + `new PhysicsPlugin(...)`
 *   - Handle input:  `npm install @yagejs/input` + `new InputPlugin(...)`
 */
export class MainScene extends Scene {
  readonly name = "main";

  onEnter(): void {
    this.spawn(Placeholder, { x: 400, y: 300 });
  }
}
