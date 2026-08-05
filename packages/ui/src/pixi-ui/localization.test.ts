import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { msg } from "@yagejs/core";
import type { Localization, LocalizedBinding } from "@yagejs/core";

// Mock @pixi/ui with minimal fakes exposing only the surface the wrappers and
// their YAGE subclasses touch (text sinks, signals, the Select internals).
vi.mock("@pixi/ui", () => {
  class FakeSignal {
    handlers = new Set<(...args: unknown[]) => void>();
    connect(fn: (...args: unknown[]) => void): void {
      this.handlers.add(fn);
    }
    disconnect(fn: (...args: unknown[]) => void): void {
      this.handlers.delete(fn);
    }
    disconnectAll(): void {
      this.handlers.clear();
    }
    emit(...args: unknown[]): void {
      for (const h of [...this.handlers]) h(...args);
    }
  }

  class FancyButton {
    textView: { style: unknown } | undefined;
    enabled = true;
    onPress = new FakeSignal();
    width = 0;
    height = 0;
    visible = true;
    destroyed = false;
    private _text = "";
    constructor(opts?: { text?: string }) {
      if (opts?.text !== undefined) this.text = opts.text;
    }
    /** Mirrors @pixi/ui: an empty string removes the text view entirely, and
     *  the next non-empty value builds a fresh one carrying no style. */
    get text(): string {
      return this._text;
    }
    set text(value: string) {
      this._text = value;
      if (!value) {
        this.textView = undefined;
        return;
      }
      this.textView ??= { style: {} };
    }
    destroy(): void {
      this.destroyed = true;
    }
  }

  class CheckBox {
    text = "";
    onCheck = new FakeSignal();
    width = 0;
    height = 0;
    visible = true;
    constructor(opts?: { text?: string }) {
      if (opts?.text !== undefined) this.text = opts.text;
    }
    forceCheck(): void {}
    destroy(): void {}
  }

  class Input {
    // protected in the real class; public here so the subclass can reach it.
    placeholder: { text: string };
    value: string;
    secure = false;
    onChange = new FakeSignal();
    onEnter = new FakeSignal();
    width = 0;
    height = 0;
    visible = true;
    constructor(opts?: { placeholder?: string; value?: string }) {
      this.placeholder = { text: opts?.placeholder ?? "" };
      this.value = opts?.value ?? "";
    }
    destroy(): void {}
  }

  class Select {
    /** Mirrors @pixi/ui: `destroy()` tears the box down but detaches its List
     *  children without destroying them, so the option buttons survive it. */
    scrollBox: { items: FancyButton[]; destroyed: boolean; destroy(): void };
    openButton: FancyButton;
    closeButton: FancyButton;
    value = -1;
    onSelect = new FakeSignal();
    width = 0;
    height = 0;
    visible = true;
    constructor(opts?: {
      items?: { items?: string[] };
      selected?: number;
    }) {
      const labels = opts?.items?.items ?? [];
      const selected = opts?.selected ?? 0;
      this.scrollBox = {
        items: labels.map((t) => new FancyButton({ text: t })),
        destroyed: false,
        destroy(): void {
          this.destroyed = true;
        },
      };
      this.openButton = new FancyButton({ text: labels[selected] ?? "" });
      this.closeButton = new FancyButton({ text: labels[selected] ?? "" });
      // Mirror @pixi/ui: each item button emits/labels its original string.
      this.scrollBox.items.forEach((b, id) => {
        const text = b.text;
        b.onPress.connect(() => {
          this.value = id;
          this.onSelect.emit(id, text);
          this.openButton.text = text;
          this.closeButton.text = text;
          this.close();
        });
      });
    }
    close(): void {}
    destroy(): void {}
  }

  class RadioGroup {
    items: CheckBox[];
    onChange = new FakeSignal();
    width = 0;
    height = 0;
    visible = true;
    constructor(opts?: { items?: CheckBox[] }) {
      this.items = opts?.items ?? [];
    }
    selectItem(): void {}
    destroy(): void {}
  }

  return { FancyButton, CheckBox, Input, Select, RadioGroup };
});

// Avoid the renderer/pixi import chain — views are opaque to these tests.
vi.mock("./view-resolver.js", () => ({
  resolvePixiView: (v: unknown) => v,
}));

import Yoga from "yoga-layout";
import { setYoga } from "../yoga-helpers.js";
import { PixiFancyButton } from "./PixiFancyButton.js";
import { PixiCheckbox } from "./PixiCheckbox.js";
import { PixiInput } from "./PixiInput.js";
import { PixiSelect } from "./PixiSelect.js";
import { PixiRadioGroup } from "./PixiRadioGroup.js";

beforeAll(() => {
  setYoga(Yoga);
});

/** A fake Localization backed by an in-memory table, switchable at runtime. */
function makeLocalization(tables: Record<string, Record<string, string>>) {
  let locale = "en";
  let rev = 0;
  const subs = new Set<() => void>();
  const loc: Localization = {
    get locale() {
      return locale;
    },
    revision: () => rev,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    resolve(b: LocalizedBinding) {
      return tables[locale]?.[b.id] ?? b.default ?? b.id;
    },
    setLocale(next: string) {
      locale = next;
      rev++;
      for (const cb of [...subs]) cb();
      return Promise.resolve();
    },
  };
  return loc;
}

describe("pixi-ui localization", () => {
  let loc: Localization;

  beforeEach(() => {
    loc = makeLocalization({
      en: { play: "Play", agree: "Agree", search: "Search…", red: "Red", blue: "Blue" },
      it: { play: "Gioca", agree: "Accetto", search: "Cerca…", red: "Rosso", blue: "Blu" },
      // A locale whose entry is deliberately empty — @pixi/ui tears the text
      // view down for it, so the next switch rebuilds one.
      blank: { label: "" },
    });
  });

  it("PixiFancyButton re-resolves its label on locale change", async () => {
    const btn = new PixiFancyButton({ text: msg("play", undefined, "Play") });
    // Statically resolved to the default before attach.
    expect((btn as unknown as { view: { text: string } }).view.text).toBe("Play");

    btn.attachLocalization(loc);
    expect((btn as unknown as { view: { text: string } }).view.text).toBe("Play");

    await loc.setLocale("it");
    expect((btn as unknown as { view: { text: string } }).view.text).toBe("Gioca");

    btn.detachLocalization();
    await loc.setLocale("en");
    // Detached: no further updates.
    expect((btn as unknown as { view: { text: string } }).view.text).toBe("Gioca");
  });

  it("PixiCheckbox re-resolves its label on locale change", async () => {
    const cb = new PixiCheckbox({
      checkedView: undefined as never,
      uncheckedView: undefined as never,
      text: msg("agree", undefined, "Agree"),
    });
    cb.attachLocalization(loc);
    await loc.setLocale("it");
    expect((cb as unknown as { view: { text: string } }).view.text).toBe("Accetto");
  });

  it("PixiInput relocalizes the placeholder, never the value", async () => {
    const input = new PixiInput({
      bg: undefined as never,
      placeholder: msg("search", undefined, "Search…"),
      value: "typed text",
    });
    input.attachLocalization(loc);
    await loc.setLocale("it");
    const view = (input as unknown as {
      view: { placeholder: { text: string }; value: string };
    }).view;
    expect(view.placeholder.text).toBe("Cerca…");
    expect(view.value).toBe("typed text");
  });

  it("PixiRadioGroup relocalizes each option label", async () => {
    const group = new PixiRadioGroup({
      type: "vertical",
      elementsMargin: 4,
      items: [
        { checkedView: undefined as never, uncheckedView: undefined as never, text: msg("red", undefined, "Red") },
        { checkedView: undefined as never, uncheckedView: undefined as never, text: msg("blue", undefined, "Blue") },
      ],
    });
    group.attachLocalization(loc);
    await loc.setLocale("it");
    const items = (group as unknown as { view: { items: { text: string }[] } }).view.items;
    expect(items.map((c) => c.text)).toEqual(["Rosso", "Blu"]);
  });

  it("PixiSelect relocalizes item, selected label, and emitted text", async () => {
    const onSelect = vi.fn();
    const select = new PixiSelect({
      closedBG: undefined as never,
      openBG: undefined as never,
      items: [msg("red", undefined, "Red"), msg("blue", undefined, "Blue")],
      selected: 1,
      onSelect,
    });
    select.attachLocalization(loc);
    await loc.setLocale("it");

    const view = (select as unknown as {
      view: {
        scrollBox: { items: { text: string; onPress: { emit(): void } }[] };
        openButton: { text: string };
        closeButton: { text: string };
        value: number;
      };
    }).view;

    // Item button labels re-resolved.
    expect(view.scrollBox.items.map((b) => b.text)).toEqual(["Rosso", "Blu"]);
    // Selected label (index 1) re-resolved.
    expect(view.openButton.text).toBe("Blu");
    expect(view.closeButton.text).toBe("Blu");

    // Pressing an item emits the localized text and updates the selected label.
    const [firstItem] = view.scrollBox.items;
    firstItem?.onPress.emit();
    expect(onSelect).toHaveBeenLastCalledWith(0, "Rosso");
    expect(view.openButton.text).toBe("Rosso");
    expect(view.value).toBe(0);
  });

  it("PixiSelect.destroy() destroys the option buttons ScrollBox leaves behind", () => {
    const select = new PixiSelect({
      closedBG: 0x000000,
      openBG: 0x000000,
      items: ["Red", "Blue"],
    });
    const view = select as unknown as {
      view: { scrollBox: { items: { destroyed: boolean }[] } };
    };
    const buttons = [...view.view.scrollBox.items];
    select.destroy();
    // @pixi/ui ScrollBox.destroy() detaches its List children without
    // destroying them; the wrapper must finish the job.
    expect(buttons.every((b) => b.destroyed)).toBe(true);
  });

  it("PixiSelect.destroy() tears down the dropdown ScrollBox", () => {
    // The base destroy spares children (they include views the game passed in
    // and may reuse), so the wrapper owns Select's own internals. Leaving the
    // ScrollBox alive would leak its document `wheel` listener.
    const select = new PixiSelect({
      closedBG: 0x000000,
      openBG: 0x000000,
      items: ["Red", "Blue"],
    });
    const box = (select as unknown as {
      view: { scrollBox: { destroyed: boolean } };
    }).view.scrollBox;

    select.destroy();
    expect(box.destroyed).toBe(true);
  });

  /** A display object the game owns: it can be detached, and records it. */
  const callerView = () => ({
    destroyed: false,
    detached: false,
    removeFromParent(): void {
      this.detached = true;
    },
    destroy(): void {
      this.destroyed = true;
    },
  });

  it("keeps a caller-supplied view alive after destroy", () => {
    // `closedBG` / `defaultView` and friends are display objects the game built
    // and may reuse across mounts; @pixi/ui parents them under the widget, so
    // they are lifted out before the widget's recursive destroy.
    const view = callerView();
    const button = new PixiFancyButton({
      text: "Go",
      defaultView: view as never,
    });

    button.destroy();
    expect(view.detached).toBe(true);
    expect(view.destroyed).toBe(false);
  });

  it("spares a caller-supplied view nested in a group widget's items", () => {
    const checked = callerView();
    const group = new PixiRadioGroup({
      items: [{ text: "One", checkedView: checked as never }],
      type: "vertical",
      elementsMargin: 4,
    });

    group.destroy();
    expect(checked.detached).toBe(true);
    expect(checked.destroyed).toBe(false);
  });

  it("re-applies the label style when an empty translation rebuilt the text view", async () => {
    // @pixi/ui drops the text view on an empty string and builds a fresh,
    // unstyled one for the next non-empty value.
    const style = { fontSize: 22 };
    const btn = new PixiFancyButton({
      text: msg("label", undefined, "Label"),
      textStyle: style,
    });
    btn.attachLocalization(loc);

    await loc.setLocale("blank"); // catalog maps `label` to ""
    await loc.setLocale("it");

    const view = btn as unknown as { view: { textView?: { style: unknown } } };
    expect(view.view.textView?.style).toEqual(style);
  });

  it("plain-string labels are inert across locale changes", async () => {
    const btn = new PixiFancyButton({ text: "Static" });
    btn.attachLocalization(loc);
    await loc.setLocale("it");
    expect((btn as unknown as { view: { text: string } }).view.text).toBe("Static");
  });

  it("update() with a present-but-undefined label clears text and drops the binding", async () => {
    const btn = new PixiFancyButton({ text: msg("play", undefined, "Play") });
    btn.attachLocalization(loc);
    const view = (btn as unknown as { view: { text: string } }).view;
    expect(view.text).toBe("Play");

    // Reconciler synthesizes `text: undefined` when the prop is removed.
    btn.update({ text: undefined });
    expect(view.text).toBe("");

    // Binding dropped: a later locale change must not revive the old label.
    await loc.setLocale("it");
    expect(view.text).toBe("");
  });

  it("update({ selected }) refreshes the shown label immediately", () => {
    const select = new PixiSelect({
      closedBG: undefined as never,
      openBG: undefined as never,
      items: [msg("red", undefined, "Red"), msg("blue", undefined, "Blue")],
      selected: 0,
    });
    select.attachLocalization(loc);
    const view = (select as unknown as {
      view: { openButton: { text: string }; closeButton: { text: string }; value: number };
    }).view;
    expect(view.openButton.text).toBe("Red");

    select.update({ selected: 1 });
    expect(view.value).toBe(1);
    expect(view.openButton.text).toBe("Blue");
    expect(view.closeButton.text).toBe("Blue");
  });

  it("destroy() disconnects item-press handlers so a late press can't reach the wrapper", () => {
    const onSelect = vi.fn();
    const select = new PixiSelect({
      closedBG: undefined as never,
      openBG: undefined as never,
      items: [msg("red", undefined, "Red"), msg("blue", undefined, "Blue")],
      selected: 0,
      onSelect,
    });
    select.attachLocalization(loc);
    const view = (select as unknown as {
      view: { scrollBox: { items: { onPress: { emit(): void } }[] } };
    }).view;

    select.destroy();

    // Firing a stale button press must not invoke the caller's onSelect.
    view.scrollBox.items[0]?.onPress.emit();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
