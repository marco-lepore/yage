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
    text = "";
    textView: { style: unknown } | undefined = { style: {} };
    enabled = true;
    onPress = new FakeSignal();
    width = 0;
    height = 0;
    visible = true;
    constructor(opts?: { text?: string }) {
      if (opts?.text !== undefined) this.text = opts.text;
    }
    destroy(): void {}
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
    scrollBox: { items: FancyButton[] };
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
      this.scrollBox = { items: labels.map((t) => new FancyButton({ text: t })) };
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

  it("plain-string labels are inert across locale changes", async () => {
    const btn = new PixiFancyButton({ text: "Static" });
    btn.attachLocalization(loc);
    await loc.setLocale("it");
    expect((btn as unknown as { view: { text: string } }).view.text).toBe("Static");
  });
});
