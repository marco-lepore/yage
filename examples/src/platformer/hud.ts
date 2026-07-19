import { TextComponent } from "@yagejs/renderer";
import { TOTAL_COINS } from "./constants.js";

// Game state — module-private, mutated only through the functions below; no
// other module reads or reassigns these directly.
let coins = 0;
let won = false;

// In-canvas HUD text, bound by the scene once it spawns the HUD entities.
let coinText: TextComponent | undefined;
let bannerText: TextComponent | undefined;
let bannerSub: TextComponent | undefined;

/** Point the HUD functions at the scene's in-canvas text. Called once from the
 * scene after it spawns the HUD entities. */
export function bindHud(
  coin: TextComponent,
  banner: TextComponent,
  sub: TextComponent,
): void {
  coinText = coin;
  bannerText = banner;
  bannerSub = sub;
  refreshHud();
}

function refreshHud(): void {
  coinText?.setText(`Coins: ${coins} / ${TOTAL_COINS}`);
}

/** Reset coins + win state and the HUD. Call on scene (re)enter. */
export function resetGame(): void {
  coins = 0;
  won = false;
  refreshHud();
  if (bannerText) bannerText.visible = false;
  if (bannerSub) bannerSub.visible = false;
}

/** Collect one coin and refresh the HUD. */
export function addCoin(): void {
  coins += 1;
  refreshHud();
}

/** Whether the goal has been reached. */
export function isWon(): boolean {
  return won;
}

/** Reveal the win banner with the final coin tally. */
export function showWin(): void {
  if (won) return;
  won = true;
  bannerSub?.setText(`Collected ${coins} / ${TOTAL_COINS} coins`);
  if (bannerText) bannerText.visible = true;
  if (bannerSub) bannerSub.visible = true;
}
