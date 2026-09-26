/**
 * Yarn Spinner dialogue — a tavern conversation written in `.yarn` files (see
 * `./dialogue/`, editable with the Yarn Spinner VS Code extension) and played
 * by the dialogue addon's default box.
 *
 * `loadYarn` reads the whole folder: the `.yarnproject` picks the `.yarn`
 * sources and lists `it.csv` as the Italian strings table. The script shows
 * characters, `{$expressions}` in lines and options, `<<if>>`, options gated on
 * a condition (`#disabled` keeps one greyed out), `<<once>>`, `<<detour>>`,
 * `<<jump>>`, `visited()`, a line group (`=>`), a node group (`Greeting.yarn`:
 * `when:` headers pick the barkeep's greeting, so it changes when you talk
 * again), the built-in `<<wait>>`, and a game command (`<<pay 3>>`) that spends
 * the player's coins.
 *
 * **Enter** advances / confirms, **↑↓** choose, **L** switches English ⇄
 * Italian mid-line (the line on screen swaps in place), **T** talks again once
 * the conversation has ended.
 */

import {
  Component,
  Engine,
  Entity,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { RendererPlugin, TextComponent, type LayerDef } from "@yagejs/renderer";
import {
  createLocalization,
  LocalizationKey,
  LocalizationPlugin,
} from "@yagejs-addons/i18n";
import {
  DialogueController,
  DialogueLineEvent,
  MemoryVariableStorage,
  cells,
  compose,
} from "@yagejs-addons/dialogue";
import {
  createBoxDialogue,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import { loadYarn } from "@yagejs-addons/dialogue/yarn";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 500;

// The whole Yarn project, compiled once. Every character gets a speaker named
// after them; `speakers` only adds nameplate colours.
const TAVERN = loadYarn(
  import.meta.glob("./dialogue/*", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  {
    speakers: {
      Barkeep: { color: 0xffb86b },
      Bard: { color: 0x8be9fd },
    },
  },
);

/** The player's coins: the game state the script reads (`$coins`) and the
 *  `pay` command spends. */
class Purse extends Component {
  coins = 7;

  pay(amount: number): void {
    this.coins -= amount;
  }
}

/** Hosts the conversation and the purse its script reads and spends. */
class TavernEntity extends Entity {
  purse!: Purse;
  dialogue!: DialogueController;

  setup(): void {
    const purse = this.add(new Purse());
    this.purse = purse;
    this.dialogue = this.add(
      new DialogueController({
        ...createBoxDialogue(),
        // Yarn variables keep their `$`. `$coins` reads and writes the purse;
        // the script's own variables and Yarn's visit / once bookkeeping land
        // in the memory store and persist across conversations.
        storage: compose(
          cells({
            $coins: {
              get: () => purse.coins,
              set: (v) => (purse.coins = Number(v)),
            },
          }),
          new MemoryVariableStorage(),
        ),
        commands: {
          // `<<pay {$price}>>`: the command's words arrive as `args`.
          pay: (cmd) => purse.pay(Number(cmd.args?.[0] ?? 0)),
        },
      }),
    );
  }
}

/** Inspector-readable state for the e2e test and for a human poking around. */
class TavernProbe extends Component {
  private readonly localization = this.service(LocalizationKey);
  lastLine = "";
  lines = 0;

  constructor(private readonly tavern: TavernEntity) {
    super();
  }

  onAdd(): void {
    this.listen(this.tavern, DialogueLineEvent, (e) => {
      this.lastLine = e.speaker ? `${e.speaker}: ${e.text}` : e.text;
      this.lines++;
    });
  }

  get coins(): number {
    return this.tavern.purse.coins;
  }
  get locale(): string {
    return this.localization.locale;
  }
  get active(): boolean {
    return this.tavern.dialogue.isActive();
  }
  get choosing(): boolean {
    return this.tavern.dialogue.isChoosing();
  }
}

/** L switches language, T talks again; the HUD shows the purse and locale. */
class TavernControls extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly localization = this.service(LocalizationKey);
  private readonly hud = this.sibling(TextComponent);

  constructor(private readonly tavern: TavernEntity) {
    super();
  }

  update(): void {
    const { dialogue, purse } = this.tavern;
    if (this.input.isJustPressed("language")) {
      this.localization.setLocale(
        this.localization.locale === "en" ? "it" : "en",
      );
    }
    if (this.input.isJustPressed("replay") && !dialogue.isActive()) {
      dialogue.play(TAVERN);
    }
    const again = dialogue.isActive() ? "" : "   ·   T: talk again";
    this.hud.setText(
      `Coins: ${purse.coins}   ·   Language: ${this.localization.locale.toUpperCase()} (L)${again}`,
    );
  }
}

/** The HUD line in the top-left corner, and the keys it lists. */
class HudEntity extends Entity {
  setup(params: { tavern: TavernEntity }): void {
    this.add(new Transform({ position: new Vec2(20, 20) }));
    this.add(
      new TextComponent({
        text: "",
        style: { fontSize: 16, fill: 0xf8f8f2, fontFamily: "sans-serif" },
      }),
    );
    this.add(new TavernControls(params.tavern));
  }
}

class TavernScene extends Scene {
  readonly name = "yarn-tavern";
  readonly layers: LayerDef[] = [...DIALOGUE_LAYERS];

  onEnter(): void {
    const tavern = this.spawn(TavernEntity);
    this.spawn(HudEntity, { tavern });
    this.spawn("tavern-probe").add(new TavernProbe(tavern));
    tavern.dialogue.play(TAVERN);
  }
}

async function main(): Promise<void> {
  // The Yarn project's catalogs: English from the `.yarn` files, Italian from
  // `it.csv`. The controller finds this service and follows its locale.
  const localization = await createLocalization({
    locale: "en",
    fallbackLocale: TAVERN.baseLanguage,
    catalogs: TAVERN.catalogs,
  });
  const engine = new Engine({ debug: true });
  engine.use(new LocalizationPlugin(localization));
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      virtualWidth: WIDTH,
      virtualHeight: HEIGHT,
      backgroundColor: 0x1d1520,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        // The dialogue controller's default bindings read these names.
        interact: ["Enter", "Space", "KeyE"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        // The example's own keys.
        language: ["KeyL"],
        replay: ["KeyT"],
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown"],
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new TavernScene());
}
main().catch(console.error);
