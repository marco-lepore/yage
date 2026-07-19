import { TextComponent } from "@yagejs/renderer";
import { TOTAL_ENEMIES } from "./constants.js";

// Game state — encapsulated behind functions so scene/entity code never
// reassigns these bindings (they become cross-module imports after the split).
let killCount = 0;
let won = false;

// In-canvas HUD text, bound by the scene once it spawns the HUD entities.
let countText: TextComponent | undefined;
let bannerText: TextComponent | undefined;
let bannerSub: TextComponent | undefined;

/** Point the HUD functions at the scene's in-canvas text. Called once from
 * the scene after it spawns the HUD entities. */
export function bindHud(
  count: TextComponent,
  banner: TextComponent,
  sub: TextComponent,
): void {
  countText = count;
  bannerText = banner;
  bannerSub = sub;
  refreshHud();
}

function refreshHud(): void {
  countText?.setText(`Enemies: ${killCount} / ${TOTAL_ENEMIES}`);
}

/** Reset kills + win state and the HUD. Call on scene (re)enter. */
export function resetGame(): void {
  killCount = 0;
  won = false;
  refreshHud();
  if (bannerText) bannerText.visible = false;
  if (bannerSub) bannerSub.visible = false;
}

/** Count one kill; reveals the win banner once every enemy is down. */
export function registerKill(): void {
  killCount += 1;
  refreshHud();
  if (killCount >= TOTAL_ENEMIES) showWin();
}

/** Whether the win condition has been reached. */
export function isWon(): boolean {
  return won;
}

function showWin(): void {
  if (won) return;
  won = true;
  if (bannerText) bannerText.visible = true;
  if (bannerSub) bannerSub.visible = true;
}

// Fullscreen toggle — DOM control, wired to RendererPlugin in main().
export const fullscreenBtn = document.createElement("button");
fullscreenBtn.id = "fullscreen-btn";
fullscreenBtn.type = "button";
fullscreenBtn.textContent = "⛶ Fullscreen";
