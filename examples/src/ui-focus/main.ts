import { Engine, MathUtils, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import {
  DEFAULT_REPEAT_DELAY,
  DEFAULT_REPEAT_INTERVAL,
  InputPlugin,
} from "@yagejs/input";
import {
  Anchor,
  PixiCheckbox,
  PixiFancyButton,
  PixiInput,
  PixiRadioGroup,
  PixiSelect,
  PixiSlider,
  UICheckbox,
  UIPanel,
  UIPlugin,
  UISurface,
  createNineSliceView,
} from "@yagejs/ui";
import type {
  PointerFocusMode,
  UIButton,
  UIButtonProps,
  UIText,
} from "@yagejs/ui";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import {
  allAssets,
  assets,
  btnTextOffset,
  defaultTextStyle,
  nineSlice,
  textStyle,
} from "../shared/ui-theme.js";
import { FocusLog, FocusReadout, nameElement } from "./status.js";

// ---------------------------------------------------------------------------
// Screen metrics — the four pane widths and three 10 px gaps fill the
// surface's content width.
// ---------------------------------------------------------------------------
const WIDTH = 960;
const HEIGHT = 680;
const MENU_W = 186;
const CENTRE_W = 244;
const WIDGET_W = 238;
const LIST_W = 224;
const GRID_COLS = 4;
const GRID_ROWS = 3;

// ---------------------------------------------------------------------------
// Colours. These are resting backgrounds. Focus is drawn over them in two
// ways on this page: an outline on most panes, which sits over whatever an
// element rests on so a textured widget and a colour panel both show it, and
// a marker beside the row in the menu pane. SLOT_FOCUS_BG is the one place
// this page asks for a filled selected row as well.
// ---------------------------------------------------------------------------
const SCREEN_BG = { color: 0x0d1420, alpha: 1, radius: 10 };
const PANE_BG = { color: 0x141f2e, alpha: 1, radius: 6 };
const ROW_BG = { color: 0x27405f, alpha: 1, radius: 4 };
const OFF_BG = { color: 0x1a2432, alpha: 1, radius: 4 };
const STEP_BG = { color: 0x2c4a3c, alpha: 1, radius: 4 };
const LIST_BG = { color: 0x0a111b, alpha: 1, radius: 4 };
const DIALOG_BG = { color: 0x4a2137, alpha: 1, radius: 8 };
const DANGER_BG = { color: 0x7a2b3c, alpha: 1, radius: 4 };
const SLOT_FOCUS_BG = { color: 0x1d4568, alpha: 1, radius: 4 };

/**
 * The outline this page asks the plugin for. Every focusable element reads it
 * except the menu pane's rows, which opt out and carry a marker instead.
 */
const FOCUS_OUTLINE = { color: 0x7dd3fc, width: 2 };

/** The character the menu pane puts beside its focused row, and its colour. */
const MARKER = ">";
const MARKER_FILL = 0x7dd3fc;

const ROW_TEXT = textStyle("buttonSmall", { fontSize: 12 });
const CELL_TEXT = textStyle("caption", { fontSize: 10, fill: 0xe2e8f0 });
const READOUT_TEXT = textStyle("caption", { fontSize: 11 });
const MARKER_TEXT = textStyle("buttonSmall", {
  fontSize: 13,
  fill: MARKER_FILL,
});

// ---------------------------------------------------------------------------
// Tab contents — the grid is re-labelled from the activated tab.
// ---------------------------------------------------------------------------
const TABS = [
  {
    name: "Items",
    cells: [
      "Potion",
      "Elixir",
      "Bread",
      "Cheese",
      "Rope",
      "Torch",
      "Bomb",
      "Salve",
      "Scroll",
      "Pick",
      "Flask",
      "Tent",
    ],
  },
  {
    name: "Gear",
    cells: [
      "Sword",
      "Axe",
      "Spear",
      "Bow",
      "Shield",
      "Helm",
      "Mail",
      "Boots",
      "Cloak",
      "Ring",
      "Charm",
      "Gloves",
    ],
  },
  {
    name: "Magic",
    cells: [
      "Fire",
      "Frost",
      "Spark",
      "Heal",
      "Ward",
      "Haste",
      "Slow",
      "Blink",
      "Drain",
      "Light",
      "Quake",
      "Gust",
    ],
  },
  {
    name: "Quests",
    cells: [
      "Bridge",
      "Wolves",
      "Reaper",
      "Ledger",
      "Cellar",
      "Beacon",
      "Ferry",
      "Choir",
      "Grove",
      "Smithy",
      "Hollow",
      "Crown",
    ],
  },
] as const;

const DIFFICULTIES = ["Story", "Normal", "Hard", "Nightmare"] as const;
const SAVE_SLOTS = 20;
const EMPTY_SLOTS = [4, 9];

/** The three answers `pointerFocus` takes, in the order the stepper walks. */
const POINTER_MODES: readonly PointerFocusMode[] = ["none", "press", "hover"];
/** Index of `"press"`, the setting a scope starts on. */
const DEFAULT_POINTER_MODE = 1;

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** The builder methods `UISurface`, `UIPanel` and `UIScrollView` share. */
type UIBuilder = Pick<UIPanel, "text" | "button" | "panel" | "addElement">;

/** A menu row: the shared look, and its label as the status panel's name. */
function row(
  parent: UIBuilder,
  label: string,
  props: Omit<UIButtonProps, "children"> = {},
): UIButton {
  return nameElement(
    parent.button(label, {
      background: ROW_BG,
      textStyle: ROW_TEXT,
      ...props,
    }),
    label,
  );
}

/**
 * A menu row whose focused look is a marker beside it rather than the outline
 * the rest of the page draws. `focusStyle: null` drops the UI-wide outline for
 * this row alone, and `onFocusChange` moves the marker — the shape most games
 * reach for, sitting next to the outlined panes so both reads are on screen
 * at once.
 */
function markedRow(
  parent: UIBuilder,
  label: string,
  props: Omit<UIButtonProps, "children"> = {},
): UIButton {
  const line = parent.panel({
    direction: "row",
    width: "100%",
    gap: 6,
    alignItems: "center",
  });
  const marker = line.text("", MARKER_TEXT, { width: 10 });
  return row(line, label, {
    flex: 1,
    ...props,
    focusStyle: null,
    onFocusChange: (focused) => marker.setText(focused ? MARKER : ""),
  });
}

/** A titled column of the screen. */
function pane(parent: UIBuilder, title: string, width: number): UIPanel {
  const column = parent.panel({
    width,
    direction: "column",
    gap: 8,
    padding: 10,
    background: PANE_BG,
  });
  column.text(title, textStyle("label"));
  return column;
}

/**
 * A row that steps a value on left and right through `onAdjust` and keeps
 * focus, while up and down still move out of it.
 */
function stepper(
  parent: UIBuilder,
  label: string,
  initial: string,
  step: (direction: -1 | 1) => string,
): void {
  const panel = parent.panel({
    direction: "row",
    width: "100%",
    height: 30,
    padding: { left: 10, right: 10 },
    alignItems: "center",
    justifyContent: "space-between",
    background: STEP_BG,
    focusable: true,
    onAdjust: (direction) => value.setText(step(direction)),
  });
  nameElement(panel, `${label} stepper`);
  panel.text(label, READOUT_TEXT);
  const value = panel.text(initial, READOUT_TEXT);
}

/** A status line: one row of the panel, clipped rather than wrapped. */
function statusLine(parent: UIBuilder, initial: string): UIText {
  return parent.text(initial, READOUT_TEXT, {
    width: "100%",
    truncate: "ellipsis",
    truncateWith: "...",
  });
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class FocusScene extends Scene {
  readonly name = "ui-focus";
  readonly preload = allAssets;

  onEnter(): void {
    const log = new FocusLog();
    const entity = this.spawn("focus-screen");

    // One scope over the whole screen. Movement between the tab strip, the
    // menu, the grid and the save list is the position rule doing its work —
    // nothing ties the panes together beyond where they are drawn.
    const screen = entity.add(
      new UISurface({
        anchor: Anchor.Center,
        width: WIDTH,
        height: HEIGHT,
        direction: "column",
        gap: 10,
        padding: 14,
        background: SCREEN_BG,
        focus: {
          onFocusMove: (element, previous) => log.move(element, previous),
          onActivate: (element) => log.activated(element),
          onMoveBlocked: (direction) => log.blocked(direction),
        },
      }),
    );

    // ---- Confirm dialog -------------------------------------------------
    // Its own scope inside the screen's: while it is visible it takes the
    // keys and the screen's navigation stops at it, and hiding it hands them
    // back on the row that opened it. Added to the tree last, so it paints
    // over the panes; a panel carrying `focus` builds its scope whenever it
    // joins the tree, so the build order is free.
    const confirm = new UIPanel({
      position: "absolute",
      left: 316,
      top: 180,
      width: 290,
      direction: "column",
      gap: 10,
      padding: 16,
      background: DIALOG_BG,
      visible: false,
      focus: {
        onCancel: closeConfirm,
        onFocusMove: (element, previous) => log.move(element, previous),
        onActivate: (element) => log.activated(element),
      },
    });
    const question = confirm.text("", textStyle("body", { fontSize: 14 }));
    row(confirm, "Yes", {
      width: "100%",
      height: 32,
      background: DANGER_BG,
      onClick: closeConfirm,
    });
    row(confirm, "No", { width: "100%", height: 32, onClick: closeConfirm });

    function askConfirm(text: string): void {
      question.setText(text);
      confirm.visible = true;
    }

    function closeConfirm(): void {
      confirm.visible = false;
    }

    // ---- Tab strip: left and right run it, up and down leave it ----------
    const tabs = screen.panel({ direction: "row", gap: 8 });
    for (const tab of TABS) {
      row(tabs, tab.name, {
        width: 112,
        height: 32,
        onClick: () => showTab(tab),
      });
    }

    const body = screen.panel({ direction: "row", gap: 10, flex: 1 });

    // ---- Vertical menu: one row disabled, so up and down step over it ----
    // This pane draws no outline. Each row opts out with `focusStyle: null`
    // and moves a marker from `onFocusChange` instead, so the two focus looks
    // stand side by side on one screen.
    const menu = pane(body, "Main Menu", MENU_W);
    markedRow(menu, "Continue", { height: 34 });
    markedRow(menu, "Load Game", { height: 34 });
    markedRow(menu, "Upload Save", {
      height: 34,
      disabled: true,
      background: OFF_BG,
      textStyle: textStyle("buttonSmall", { fontSize: 12, fill: 0x5b6b7f }),
    });
    markedRow(menu, "Options", { height: 34 });
    markedRow(menu, "Quit to Desktop", {
      height: 34,
      onClick: () => askConfirm("Quit to desktop?"),
    });

    // ---- Grid: four columns by three rows, every direction by position ---
    const centre = pane(body, "Inventory", CENTRE_W);
    const caption = centre.text("", textStyle("caption"));
    const grid = centre.panel({ direction: "column", gap: 4 });
    const cells: UIButton[] = [];
    for (let line = 0; line < GRID_ROWS; line++) {
      const cellRow = grid.panel({ direction: "row", gap: 4 });
      for (let column = 0; column < GRID_COLS; column++) {
        cells.push(
          row(cellRow, "", {
            width: 52,
            height: 38,
            textStyle: CELL_TEXT,
            truncate: "ellipsis",
            truncateWith: "...",
          }),
        );
      }
    }

    function showTab(tab: (typeof TABS)[number]): void {
      caption.setText(`${tab.name} — ${GRID_COLS} x ${GRID_ROWS}`);
      cells.forEach((cell, index) => {
        const label = tab.cells[index] ?? "";
        cell.setText(label);
        nameElement(cell, label);
      });
    }
    showTab(TABS[0]);

    // ---- Stepper rows: left and right change a value, focus stays --------
    centre.text("Settings", textStyle("label"));
    let volume = 60;
    stepper(centre, "Music", `${volume}`, (direction) => {
      volume = MathUtils.clamp(volume + direction * 5, 0, 100);
      return `${volume}`;
    });
    let difficulty = 1;
    stepper(centre, "Difficulty", DIFFICULTIES[1], (direction) => {
      difficulty = MathUtils.clamp(
        difficulty + direction,
        0,
        DIFFICULTIES.length - 1,
      );
      return DIFFICULTIES[difficulty] ?? DIFFICULTIES[0];
    });

    // ---- The two pointer rules, switchable while the page runs -----------
    // `setOptions` applies each key present, so a change lands on the frame
    // it is made. The pointer-focus setting goes to both scopes, so the
    // comparison holds wherever the pointer is; pointer ownership is switched
    // on the dialog's scope, the one with a menu behind it to click through.
    centre.text("Pointer", textStyle("label"));
    const policy = {
      pointerFocus: POINTER_MODES[DEFAULT_POINTER_MODE] ?? "press",
      dialogOwnsPointer: true,
    };

    function applyPolicy(): void {
      screen.focusScope?.setOptions({ pointerFocus: policy.pointerFocus });
      confirm.focusScope?.setOptions({
        pointerFocus: policy.pointerFocus,
        modal: policy.dialogOwnsPointer,
      });
    }

    let pointerMode = DEFAULT_POINTER_MODE;
    stepper(centre, "Pointer focus", policy.pointerFocus, (direction) => {
      pointerMode = MathUtils.clamp(
        pointerMode + direction,
        0,
        POINTER_MODES.length - 1,
      );
      policy.pointerFocus = POINTER_MODES[pointerMode] ?? "press";
      applyPolicy();
      return policy.pointerFocus;
    });

    centre.addElement(
      nameElement(
        new UICheckbox({
          label: "Dialog owns the pointer",
          labelStyle: READOUT_TEXT,
          checked: policy.dialogOwnsPointer,
          size: 16,
          onChange: (on) => {
            policy.dialogOwnsPointer = on;
            applyPolicy();
          },
        }),
        "Dialog pointer checkbox",
      ),
    );

    // ---- Checkbox and the @pixi/ui wrappers ------------------------------
    const widgets = pane(body, "Widgets", WIDGET_W);
    widgets.addElement(
      nameElement(
        new UICheckbox({
          label: "Subtitles",
          labelStyle: READOUT_TEXT,
          checked: true,
          size: 16,
        }),
        "Subtitles checkbox",
      ),
    );
    widgets.addElement(
      nameElement(
        new PixiFancyButton({
          defaultView: assets.btnDefault,
          hoverView: assets.btnHover,
          pressedView: assets.btnPressed,
          nineSliceSprite: nineSlice.button,
          text: "Apply",
          textStyle: textStyle("buttonSmall"),
          textOffset: btnTextOffset,
          width: 200,
          height: 36,
        }),
        "Apply button",
      ),
    );
    widgets.addElement(
      nameElement(
        new PixiCheckbox({
          checkedView: assets.checkboxChecked,
          uncheckedView: assets.checkboxUnchecked,
          text: "Shake",
          textStyle: READOUT_TEXT,
        }),
        "Shake checkbox",
      ),
    );
    widgets.addElement(
      nameElement(
        new PixiSlider({
          bg: assets.sliderTrack,
          fill: assets.sliderFillBlue,
          slider: assets.sliderHandle,
          nineSliceSprite: nineSlice.track,
          min: 0,
          max: 100,
          step: 5,
          value: 50,
          width: 200,
          height: 16,
        }),
        "Brightness slider",
      ),
    );
    // Confirm opens the list, and the open list takes the screen scope's keys:
    // up and down move the lit row, confirm commits it, cancel closes on the
    // value the select already had. `itemHoverBG` is the colour that light
    // uses, because the list lights a row the way the pointer does.
    const displaySelect = nameElement(
      new PixiSelect({
        closedBG: createNineSliceView({
          texture: assets.selectClosed,
          width: 200,
          height: 32,
          insets: nineSlice.panel,
        }),
        openBG: createNineSliceView({
          texture: assets.selectOpen,
          width: 200,
          height: 32,
          insets: nineSlice.panel,
        }),
        items: ["Windowed", "Borderless", "Fullscreen"],
        textStyle: textStyle("dark", { fontSize: 12 }),
        itemTextStyle: textStyle("body", { fontSize: 12 }),
        itemWidth: 180,
        itemHeight: 28,
        itemBG: 0x1e293b,
        itemHoverBG: 0x334155,
        visibleItems: 3,
      }),
      "Display select",
    );
    widgets.addElement(displaySelect);
    widgets.addElement(
      nameElement(
        new PixiRadioGroup({
          items: (["Low", "Med", "High"] as const).map((text) => ({
            checkedView: assets.radioChecked,
            uncheckedView: assets.radioUnchecked,
            text,
            textStyle: READOUT_TEXT,
          })),
          type: "horizontal",
          elementsMargin: 6,
          selected: 1,
        }),
        "Quality radios",
      ),
    );
    const nameField = nameElement(
      new PixiInput({
        bg: assets.inputBg,
        nineSliceSprite: nineSlice.input,
        placeholder: "Name this save",
        width: 200,
        height: 32,
        padding: [6, 10],
        textStyle: textStyle("dark", { fontSize: 12 }),
      }),
      "Save name field",
    );
    widgets.addElement(nameField);

    // ---- Scrolling list: the follow brings a focused row into view -------
    const saves = pane(body, "Save Slots", LIST_W);
    const list = saves.scrollView({
      flex: 1,
      gap: 4,
      padding: 4,
      background: LIST_BG,
    });
    // This pane asks for the filled selected row as well: `focusBackground` is
    // an opt-in fill painted under the outline, so the save list reads like a
    // classic menu while the rest of the screen shows the outline alone.
    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const label = `Slot ${String(slot).padStart(2, "0")}`;
      const empty = EMPTY_SLOTS.includes(slot);
      row(list, empty ? `${label} — empty` : label, {
        width: "100%",
        height: 30,
        textStyle: CELL_TEXT,
        focusBackground: SLOT_FOCUS_BG,
        ...(empty ? { disabled: true, background: OFF_BG } : {}),
        onClick: () => askConfirm(`Overwrite ${label}?`),
      });
    }
    // A footer outside the list: moving up into a scrolling list lands on the
    // nearest row that is actually on screen, not on one behind the clip.
    row(saves, "New Save", {
      width: "100%",
      height: 30,
      focusBackground: SLOT_FOCUS_BG,
    });

    // ---- Status panel ----------------------------------------------------
    const status = screen.panel({
      direction: "row",
      gap: 20,
      height: 96,
      padding: 12,
      background: PANE_BG,
    });
    const leftLines = status.panel({ direction: "column", gap: 4, flex: 1 });
    const rightLines = status.panel({ direction: "column", gap: 4, flex: 1 });
    const lines = {
      focused: statusLine(leftLines, "Focused:"),
      scope: statusLine(leftLines, "Reading input:"),
      capture: statusLine(leftLines, "Holding the keys: nothing"),
      trail: statusLine(rightLines, "Focus trail:"),
      cues: statusLine(rightLines, "Activated:"),
      actions: statusLine(rightLines, "Gameplay hears:"),
      policy: statusLine(rightLines, "Pointer:"),
    };
    statusLine(
      leftLines,
      `Repeat: after ${DEFAULT_REPEAT_DELAY}s, then every ${DEFAULT_REPEAT_INTERVAL}s`,
    );

    screen.addElement(confirm);
    entity.add(
      new FocusReadout({
        panes: [
          { name: "Menu screen", host: screen },
          { name: "Confirm dialog", host: confirm },
        ],
        log,
        // The two elements that answer the player on their own, so the panel
        // can say which of them is holding the scope's keys.
        holders: [nameField, displaySelect],
        policy,
        lines,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      virtualWidth: WIDTH,
      virtualHeight: HEIGHT,
      backgroundColor: 0x080b11,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );

  engine.use(
    new InputPlugin({
      // The six names a focus scope polls by default, bound to the keyboard
      // and to a controller's d-pad, left stick and south / east face
      // buttons. Hold-to-repeat is already on for the four directions, and a
      // stick push arrives as an ordinary key edge, so a held stick runs a
      // list at the same rate a held arrow does.
      actions: {
        "move-up": ["ArrowUp", "KeyW", "GamepadDPadUp", "GamepadLeftStickUp"],
        "move-down": [
          "ArrowDown",
          "KeyS",
          "GamepadDPadDown",
          "GamepadLeftStickDown",
        ],
        "move-left": [
          "ArrowLeft",
          "KeyA",
          "GamepadDPadLeft",
          "GamepadLeftStickLeft",
        ],
        "move-right": [
          "ArrowRight",
          "KeyD",
          "GamepadDPadRight",
          "GamepadLeftStickRight",
        ],
        interact: ["Enter", "GamepadA"],
        cancel: ["Escape", "GamepadB"],
        // A gameplay action beside the menu's: a scope consumes nothing it
        // polls, and a key typed into a text field raises no action at all.
        fire: ["KeyF"],
      },
      preventDefaultKeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );

  // One focus style for the whole UI, which is what asks for the outline at
  // all: with no `focusStyle` here and none on an element, focus draws
  // nothing and a game shows it its own way. Every focusable element reads
  // this one — the buttons, the focusable stepper panels, the checkboxes and
  // all six `@pixi/ui` wrappers — except the menu pane's rows, which pass
  // `focusStyle: null` and carry a marker instead. Leave `color` out and it
  // follows `defaultTextStyle.fill`; naming an accent here is the lever a
  // game pulls.
  engine.use(new UIPlugin({ defaultTextStyle, focusStyle: FOCUS_OUTLINE }));
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new FocusScene());
}

main().catch(console.error);
