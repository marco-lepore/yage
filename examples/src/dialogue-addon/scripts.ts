import { loadCompact } from "@yagejs-addons/dialogue";
// YAML authoring lives behind the `/yaml` subpath so non-YAML games don't bundle
// the parser; it returns the same validated, frozen `DialogueScript`.
import { loadYaml } from "@yagejs-addons/dialogue/yaml";
// The dialogue itself lives in plain `.yaml` data files (a designer edits these
// without touching code); Vite's `?raw` suffix imports each as a string.
import miraYaml from "./scripts/mira.yaml?raw";
import quartermasterYaml from "./scripts/quartermaster.yaml?raw";
import merchantYaml from "./scripts/merchant.yaml?raw";
import guardYaml from "./scripts/guard.yaml?raw";
import rookYaml from "./scripts/rook.yaml?raw";
import sageYaml from "./scripts/sage.yaml?raw";
import captainYaml from "./scripts/captain.yaml?raw";
import gossipYaml from "./scripts/gossip.yaml?raw";
// One NPC's script is authored in the compact DSL instead of YAML — loaded with
// `loadCompact` from the root entry (no `yaml` dep), same validated/frozen IR.
import locksmithCompact from "./scripts/locksmith.dlg?raw";

// ── scripts — authored in `./scripts/*.yaml`, parsed by `loadYaml` ──────────
//
// The dialogue lives in plain YAML data files (imported above via Vite `?raw`),
// each mirroring the JSON `DialogueScript` and all content-only
// (storage/functions/commands live on the host). Conditions and `set` values are
// plain string expressions (`gold >= 50 and not has_item('rusty-key')`,
// `gold - 50`) — `loadYaml` parses them into the IR and validates at module load,
// so a malformed file throws here rather than at first `play`. The portrait keys
// (`cap-stern` / `cap-neutral` / `sage-face`) are the texture keys the scene
// registers in `Assets` below.

/** Mira — markup effects + a persistent visit counter (cycling NPC). */
export const MIRA = loadYaml(miraYaml);
/** Quartermaster — a one-time stipend via `give-gold`, gated on a declared flag. */
export const QUARTERMASTER = loadYaml(quartermasterYaml);
/** Vex — buys the rusty key for gold via an expression-gated option that writes
 *  through the two-way `gold` cell and hands over the item. */
export const MERCHANT = loadYaml(merchantYaml);
/** Bron — opens the gate only with the key (a function gate), spends it, and
 *  fires a world-consequence command. */
export const GUARD = loadYaml(guardYaml);
/** Rook — a TIMED choice (a recipe, not an engine feature): a non-blocking
 *  `choice-timer` command arms a host-owned countdown on the game clock; stall too
 *  long and {@link ChoiceTimer} commits the default ("Freeze up", index 1).
 *  `meta.timeout` rides through to the presenter for a custom countdown. */
export const ROOK = loadYaml(rookYaml);
/** Sage — NO `view` hint on his lines: the default route floats him in a bubble
 *  anyway because he has a registered {@link DialogueActor} (speaker-aware). His
 *  `meta.portrait` drives the bubble-side avatar, the diegetic counterpart to the
 *  Captain's in-box one. */
export const SAGE = loadYaml(sageYaml);
/** Captain Vow — the box presenter's per-line layout: a `meta.position: "top"`
 *  alert (frame + body move up together), a line-driven reflowing in-box avatar
 *  (`meta.portrait` / `meta.side`, the `InBoxAvatarPresenter` wired into the
 *  bundle), and a six-option briefing that GROWS the frame to fit the menu. */
export const CAPTAIN = loadYaml(captainYaml);
/** Ambient gossip — loops forever, each line auto-advancing, no input binding. */
export const GOSSIP = loadYaml(gossipYaml);
/** Pip — the one NPC authored in the **compact DSL** (`./scripts/locksmith.dlg`,
 *  parsed by `loadCompact`, not `loadYaml`). Shows the compact-only conveniences:
 *  a `declare`d visit flag + a conditional jump (`-> regreet if: pip_seen`) that
 *  re-greets a returning customer, line-driven `#portrait:`/`#side:` avatars, a
 *  `#line:` i18n key, per-line `speed=`, and `set` / `do` against the SAME shared
 *  storage the YAML NPCs use. It compiles to the identical frozen IR. */
export const LOCKSMITH = loadCompact(locksmithCompact);
