/**
 * The first example for @yagejs-addons/abilities: a close-quarters top-down
 * arena brawl exercising the full timeline-ability + hit-contract surface.
 *
 * - Player `Abilities`: two complete tap-vs-hold loadouts. FISTS chains a
 *   jab, cross, and lunging hook, then releases a held charge as a homing
 *   fireball. KICKS chains front, high, and flying kicks, then releases the
 *   existing lunging charge kick. Both combos use one phased def whose
 *   guarded `on:` windows linger through the recovery gap. `AbilityDriverComponent`
 *   owns tap-vs-hold classification for each loadout. Tapping dash performs
 *   the invulnerable roll; holding it runs, while a buffered tap may still
 *   cancel an attack's recovery. The rest of the kit is a
 *   hold-vs-tap
 *   guard (`GUARD_HOLD`/`PARRY`: holding reduces every landed hit in place
 *   with no stagger and never closes early, tapping cancels into a short
 *   negate-and-punish parry window with a hand-rolled counterattack/
 *   projectile-reflect on success),
 *   "potion" (a `heal` point step on the `"item"` lane, so it plays even
 *   while the main lane is busy). Every player attack phase is windup
 *   → active (hitbox/effect) → recovery: the phase `duration` extends past
 *   the active window so landing (or whiffing) a swing leaves the lane busy
 *   for a beat afterward. Every committed attack/counter phase additionally
 *   carries `priority: SUPER_ARMOR_PRIORITY` (above the addon's built-in
 *   stagger reaction) so a committed attack still takes damage but can't be
 *   flinched or knocked back out of it — see the ability defs below.
 * - Enemies: a telegraphed melee `hitbox` (windup → active → recovery, with
 *   a `telegraph` step that flashes the sprite and bursts particles through
 *   the whole windup) plus a `projectile` ranged attack (`SHOOT`), aimed at
 *   the player and carrying the same telegraph through its cast. Unlike the
 *   player, enemies carry no `priority` (super armor) on these defs — a
 *   landed hit interrupts a telegraphed swing at any point, so punishing the
 *   tell stops the attack. An engagement
 *   token (`EngagementToken`) lets only one enemy hold it at a time: the
 *   holder runs the melee / close-in / shoot logic below, everyone else
 *   orbits/strafes at mid range instead of piling onto the player.
 *   `EnemyAI` picks melee / close-in / shoot off distance to the player each
 *   frame, and attacks gate movement the same way the cast always has.
 * - `Health` + `Stagger` + `HitReceiver` on both sides. `Facing` on every
 *   combatant drives both ability aim and which 8-directional sprite frame
 *   plays. A sustained charge re-samples the held movement direction each
 *   frame so the player can turn in place. Other abilities freeze Facing
 *   except at the next action boundary — a combo stage firing, a buffered
 *   dash executing, a charge releasing, or a parry starting — where
 *   `PlayerController.resampleFacing` aims the action in the direction held
 *   when it fires rather than when it queued.
 *   Death turns an entity into an inert corpse — dead-specific
 *   components removed, body made static — instead of leaving it
 *   dealing damage or sliding around. A pale strobe on the sprite marks
 *   invulnerability from any source — the def-authored windows on dash and
 *   the parry counter (paired `invulnFlash` window steps at the same
 *   `from`/`to` as their `invulnerable` steps) and the post-hit i-frames
 *   `HitReceiver` arms automatically (`runInvulnFlash`, triggered off
 *   `HitReceived`, reading `HitReceiver.iframesRemaining`).
 * - Feedback: each attack def declares its own `hit.hitstop`; the attacker's
 *   `HitDealt` listener reads it off the payload and freezes the whole scene
 *   through `SceneTime.freezeFor` (the addon's arbitration primitive — no
 *   hand-rolled `scene.timeScale` toggle). Camera shake stays game-side,
 *   sized by the landed hit's damage (`damageWeight`/`SHAKE_BY_WEIGHT`). Every
 *   landed hit bursts impact particles sized by damage and plays a thock, a
 *   parry sparks and rings, a blocked hit thuds, death booms, and the charge
 *   attack emits a ring of sparks converging on the caster through a local
 *   particle emitter — see `PlayerController`, `VfxHub` and the SFX section.
 * - A `CameraEntity` zoomed in and softly following the player, clamped to
 *   the arena; the hotbar/HP/log HUD lives on its own screen-space layer
 *   (`HUD_LAYER`) so it stays viewport-fixed under the zoom/follow — see
 *   `AbilitiesDemoScene.onEnter`. R tears down and rebuilds the whole scene
 *   (`PlayerController.resetDemo`) without a page reload.
 * - A bottom-center hotbar (`HotbarSlot`) mirrors the player's four action
 *   slots (both loadouts share one attack slot) with a per-frame clock-wipe
 *   arc and an `X.X` countdown, read off `Abilities.cooldownRemaining`/
 *   `cooldownRatio` for dash/guardHold/potion and off the active def's own
 *   elapsed/duration for the shared attack slot, which has no single
 *   cooldown id to poll (see `PlayerController.attackSlotState`).
 * - E swaps between the FISTS and KICKS definition sets.
 *   `PlayerController.swapLoadout` calls `Abilities.replaceDefinitions` and
 *   replaces the mounted driver's input mapping. The swap cancels active
 *   abilities and resets every cooldown.
 *
 * Visuals are the CC0 "8-Directional Melee Character (Boxer)" sprite pack
 * (see `examples/public/assets/CREDITS.md`) via `AnimatedSpriteComponent` +
 * `AnimationController`. The addon's own `anim` timeline step drives a core
 * `KeyframeAnimator`, not a sprite sheet, so this example defines its own
 * `spriteAnim`/`spriteHold` steps (see the "Boxer sprite animation" section
 * below) that pick the right directional frames off `AnimationController`,
 * plus a `telegraph` step for the enemy windup tell.
 *
 * H toggles the engine's built-in physics debug overlay (`DebugPlugin`'s
 * `toggleKey`) — collider wireframes for every body, including the
 * sensors `hitbox`/`projectile` spawn, colored by body type (yellow for
 * sensors).
 */

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { ParticlesPlugin } from "@yagejs/particles";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";
import { AudioPlugin } from "@yagejs/audio";
import { setupGameContainer } from "../shared/bootstrap.js";
import { HEIGHT, WIDTH } from "./constants.js";
import { AbilitiesDemoScene } from "./scene.js";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  const container = setupGameContainer(WIDTH, HEIGHT);

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      // The boxer sheets are pixel art — keep frames crisp.
      pixelArtPreset: true,
      container,
    }),
  );
  engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 0 } }));
  engine.use(
    new InputPlugin({
      actions: {
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["KeyW", "ArrowUp"],
        down: ["KeyS", "ArrowDown"],
        attack: ["Space", "KeyJ"],
        dash: ["ShiftLeft", "KeyK"],
        guard: ["KeyF", "KeyL"],
        potion: ["KeyQ", "Digit1"],
        loadout: ["KeyE"],
        reset: ["KeyR"],
      },
      preventDefaultKeys: [
        "Space",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ],
    }),
  );
  engine.use(new ParticlesPlugin());
  engine.use(new AudioPlugin());
  // toggleKey: "KeyH" — the built-in physics debug overlay already draws
  // every collider's wireframe (yellow for sensors: `hitbox`/`projectile`),
  // so no example-side hitbox overlay is needed, only a key binding.
  engine.use(new DebugPlugin({ toggleKey: "KeyH" }));

  await engine.start();
  await engine.scenes.push(new AbilitiesDemoScene());
}

main().catch(console.error);
