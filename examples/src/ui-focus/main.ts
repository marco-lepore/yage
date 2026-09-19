import { Engine, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
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
import type { PointerFocusMode, UIButton, UIButtonProps } from "@yagejs/ui";
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
import { FocusStatus, named } from "./status.js";

const WIDTH = 960;
const HEIGHT = 680;

const bg = (color: number) => ({ color, radius: 4 });
const PANE_BG = bg(0x141f2e);
const SMALL_TEXT = textStyle("caption", { fontSize: 11 });
const ROW_TEXT = textStyle("buttonSmall", { fontSize: 12 });
const DISABLED = {
  disabled: true,
  background: bg(0x1a2432),
  textStyle: textStyle("buttonSmall", { fontSize: 12, fill: 0x5b6b7f }),
};

/** Activating a tab writes its twelve labels into the grid. */
const TABS = {
  Items:
    "Potion Elixir Bread Cheese Rope Torch Bomb Salve Scroll Pick Flask Tent",
  Gear: "Sword Axe Spear Bow Shield Helm Mail Boots Cloak Ring Charm Gloves",
  Magic: "Fire Frost Spark Heal Ward Haste Slow Blink Drain Light Quake Gust",
  Quests:
    "Bridge Wolves Reaper Ledger Cellar Beacon Ferry Choir Grove Smithy Hollow Crown",
};
const POINTER_MODES: readonly PointerFocusMode[] = ["none", "press", "hover"];

/** The builder methods `UISurface`, `UIPanel` and `UIScrollView` share. */
type UIBuilder = Pick<UIPanel, "text" | "button" | "panel" | "addElement">;
type RowProps = Omit<UIButtonProps, "children">;

/** A button that is focusable by default, named for the status panel. */
function row(parent: UIBuilder, label: string, props: RowProps = {}): UIButton {
  const button = parent.button(label, {
    height: 32,
    background: bg(0x27405f),
    textStyle: ROW_TEXT,
    ...props,
  });
  return named(button, label);
}

/** A row that shows focus its own way: no outline, a marker beside it. */
function markedRow(parent: UIBuilder, label: string, props: RowProps = {}) {
  const line = parent.panel({ direction: "row", gap: 6, alignItems: "center" });
  const marker = line.text("", ROW_TEXT, { width: 10 });
  row(line, label, {
    flex: 1,
    ...props,
    focusStyle: null,
    onFocusChange: (focused) => marker.setText(focused ? ">" : ""),
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

/** A focusable panel: left and right step its value, up and down move on. */
function stepper<T extends string>(
  parent: UIBuilder,
  label: string,
  values: readonly T[],
  start: T,
  onChange?: (value: T) => void,
): void {
  let index = values.indexOf(start);
  const panel = parent.panel({
    direction: "row",
    height: 30,
    padding: { left: 10, right: 10 },
    alignItems: "center",
    justifyContent: "space-between",
    background: bg(0x2c4a3c),
    focusable: true,
    onAdjust: (direction) => {
      index = Math.min(Math.max(index + direction, 0), values.length - 1);
      const next = values[index] ?? start;
      value.setText(next);
      onChange?.(next);
    },
  });
  named(panel, `${label} stepper`);
  panel.text(label, SMALL_TEXT);
  const value = panel.text(start, SMALL_TEXT);
}

class FocusScene extends Scene {
  readonly name = "ui-focus";
  readonly preload = allAssets;

  onEnter(): void {
    const status = new FocusStatus();

    // One scope over the whole screen: focus moves between the panes by where
    // their elements are drawn.
    const screen = this.spawn("focus-screen").add(
      new UISurface({
        anchor: Anchor.Center,
        width: WIDTH,
        height: HEIGHT,
        direction: "column",
        gap: 10,
        padding: 14,
        background: bg(0x0d1420),
        focus: { ...status.callbacks },
      }),
    );

    // Confirm dialog: a nested scope. While visible it takes the keys, and
    // hiding it from `onCancel` hands them back to the row that opened it.
    const closeConfirm = (): void => {
      confirm.visible = false;
    };
    const confirm = new UIPanel({
      position: "absolute",
      left: 316,
      top: 180,
      width: 290,
      direction: "column",
      gap: 10,
      padding: 16,
      background: bg(0x4a2137),
      visible: false,
      focus: { ...status.callbacks, onCancel: closeConfirm },
    });
    const question = confirm.text("", textStyle("body", { fontSize: 14 }));
    row(confirm, "Yes", { background: bg(0x7a2b3c), onClick: closeConfirm });
    row(confirm, "No", { onClick: closeConfirm });
    const askConfirm = (text: string): void => {
      question.setText(text);
      confirm.visible = true;
    };

    // Tab strip: left and right run it, up and down leave it.
    const tabs = screen.panel({ direction: "row", gap: 8 });
    for (const [name, labels] of Object.entries(TABS)) {
      row(tabs, name, { width: 112, onClick: () => showTab(labels) });
    }
    const body = screen.panel({ direction: "row", gap: 10, flex: 1 });

    // Vertical menu: marker rows, a disabled row that up and down step over,
    // and wrap from the last row round to the tab strip.
    const menu = pane(body, "Main Menu", 186);
    markedRow(menu, "Continue");
    markedRow(menu, "Load Game");
    markedRow(menu, "Upload Save", DISABLED);
    markedRow(menu, "Options");
    markedRow(menu, "Quit Game", {
      onClick: () => askConfirm("Quit the game?"),
    });

    // Grid: four columns by three rows, every direction moves by position.
    const centre = pane(body, "Inventory", 244);
    const cells: UIButton[] = [];
    for (let line = 0; line < 3; line++) {
      const cellRow = centre.panel({ direction: "row", gap: 4 });
      for (let column = 0; column < 4; column++) {
        cells.push(
          row(cellRow, "", { width: 52, height: 38, textStyle: SMALL_TEXT }),
        );
      }
    }
    const showTab = (labels: string): void => {
      labels.split(" ").forEach((label, index) => {
        const cell = cells[index];
        if (cell) named(cell, label).setText(label);
      });
    };
    showTab(TABS.Items);

    // Steppers: `onAdjust` takes left and right and keeps focus on the row.
    centre.text("Settings", textStyle("label"));
    const volumes = Array.from({ length: 21 }, (_, step) => `${step * 5}`);
    stepper(centre, "Music", volumes, "60");
    stepper(centre, "Difficulty", ["Story", "Normal", "Hard"], "Normal");

    // Pointer rules, switched while the page runs: `setOptions` applies each
    // key it is given on the frame it is called.
    centre.text("Pointer", textStyle("label"));
    let pointerFocus: PointerFocusMode = "press";
    let modal = true;
    stepper(centre, "Pointer focus", POINTER_MODES, pointerFocus, (mode) => {
      pointerFocus = mode;
      screen.focusScope?.setOptions({ pointerFocus });
      confirm.focusScope?.setOptions({ pointerFocus });
    });
    centre.addElement(
      named(
        new UICheckbox({
          label: "Dialog owns the pointer",
          labelStyle: textStyle("label"),
          checked: true,
          size: 16,
          onChange: (on) => {
            modal = on;
            confirm.focusScope?.setOptions({ modal });
          },
        }),
        "Dialog pointer checkbox",
      ),
    );

    // The six `@pixi/ui` wrappers take focus and draw the plugin's outline.
    const selectBg = (texture: typeof assets.selectOpen) =>
      createNineSliceView({
        texture,
        width: 200,
        height: 32,
        insets: nineSlice.panel,
      });
    const wrappers = {
      "Apply button": new PixiFancyButton({
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
      "Shake checkbox": new PixiCheckbox({
        checkedView: assets.checkboxChecked,
        uncheckedView: assets.checkboxUnchecked,
        text: "Shake",
        textStyle: SMALL_TEXT,
      }),
      "Brightness slider": new PixiSlider({
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
      // Confirm opens the list, and the open list holds the scope's keys.
      "Display select": new PixiSelect({
        closedBG: selectBg(assets.selectClosed),
        openBG: selectBg(assets.selectOpen),
        items: ["Windowed", "Borderless", "Fullscreen"],
        textStyle: textStyle("dark", { fontSize: 12 }),
        itemTextStyle: textStyle("body", { fontSize: 12 }),
        itemWidth: 180,
        itemHeight: 28,
        itemBG: 0x1e293b,
        itemHoverBG: 0x334155,
        visibleItems: 3,
      }),
      "Quality radios": new PixiRadioGroup({
        items: ["Low", "Med", "High"].map((text) => ({
          checkedView: assets.radioChecked,
          uncheckedView: assets.radioUnchecked,
          text,
          textStyle: SMALL_TEXT,
        })),
        type: "horizontal",
        elementsMargin: 6,
        selected: 1,
      }),
      // Confirm starts typing, and the field holds the keys until it ends.
      "Save name field": new PixiInput({
        bg: assets.inputBg,
        nineSliceSprite: nineSlice.input,
        placeholder: "Name this save",
        width: 200,
        height: 32,
        padding: [6, 10],
        textStyle: textStyle("dark", { fontSize: 12 }),
      }),
    };
    const widgets = pane(body, "Widgets", 238);
    for (const [name, wrapper] of Object.entries(wrappers)) {
      widgets.addElement(named(wrapper, name));
    }

    // Scrolling list: the list scrolls to keep the focused row in view.
    // `focusBackground` fills the focused row under the outline.
    const saves = pane(body, "Save Slots", 224);
    const list = saves.scrollView({
      flex: 1,
      gap: 4,
      padding: 4,
      background: bg(0x0a111b),
    });
    const slotLook = { width: "100%", focusBackground: bg(0x1d4568) } as const;
    for (let slot = 1; slot <= 20; slot++) {
      const label = `Slot ${String(slot).padStart(2, "0")}`;
      const empty = slot === 4 || slot === 9;
      row(list, empty ? `${label} (empty)` : label, {
        ...slotLook,
        ...(empty ? DISABLED : {}),
        onClick: () => askConfirm(`Overwrite ${label}?`),
      });
    }
    row(saves, "New Save", slotLook);

    // Status panel: two columns of lines the `FocusStatus` component writes.
    const bar = screen.panel({
      direction: "row",
      gap: 20,
      height: 96,
      padding: 12,
      background: PANE_BG,
    });
    const lines = [4, 3].flatMap((count) => {
      const column = bar.panel({ direction: "column", gap: 4, flex: 1 });
      return Array.from({ length: count }, () =>
        column.text("", SMALL_TEXT, {
          width: "100%",
          truncate: "ellipsis",
          truncateWith: "...",
        }),
      );
    });

    // Added last, so the dialog paints over the panes.
    screen.addElement(confirm);
    screen.entity.add(
      status.connect({
        scopes: [
          ["Menu screen", screen],
          ["Confirm dialog", confirm],
        ],
        holders: Object.values(wrappers),
        pointer: () =>
          `focus on ${pointerFocus}, dialog ${modal ? "modal" : "shared"}`,
        lines,
      }),
    );
  }
}

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
      // The six action names a focus scope polls by default. The directions
      // repeat while held, and a stick push arrives as an ordinary key edge.
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
        // polls, and a key typed into a text field raises no action.
        fire: ["KeyF"],
      },
      preventDefaultKeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );
  // `focusStyle` asks for the package's outline on every focusable element.
  // Without it focus draws nothing; `focusStyle: null` opts one element out.
  engine.use(
    new UIPlugin({
      defaultTextStyle,
      focusStyle: { color: 0x7dd3fc, width: 2 },
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new FocusScene());
}

main().catch(console.error);
