import { describe, expect, it, vi, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockSignal {
    connect(): void {}
    disconnect(): void {}
  }
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    visible = true;
    eventMode = "auto";
    cursor = "default";
    width = 0;
    height = 0;
    position = { x: 0, y: 0, set: (): void => undefined };
    scale = { x: 1, y: 1, set: (): void => undefined };
    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    on(): this {
      return this;
    }
    off(): this {
      return this;
    }
    destroy(): void {}
  }
  class MockFancyButton extends MockContainer {
    onPress = new MockSignal();
    textView = { style: {} };
    text = "";
    constructor(options?: { text?: string }) {
      super();
      this.text = options?.text ?? "";
    }
  }
  /** Mirrors @pixi/ui Input: a protected placeholder Text, hidden while the
   *  field has content or is being edited. `YageInput` writes it directly. */
  class MockInput extends MockContainer {
    onChange = new MockSignal();
    onEnter = new MockSignal();
    protected placeholder = { text: "", visible: false };
    protected editing = false;
    private _value = "";
    secure = false;
    padding: number | number[] = 0;
    constructor(options?: { placeholder?: string; value?: string }) {
      super();
      this.placeholder.text = options?.placeholder ?? "";
      this.placeholder.visible = !!options?.placeholder;
      this.value = options?.value ?? "";
    }
    get value(): string {
      return this._value;
    }
    set value(text: string) {
      this._value = text;
      this.placeholder.visible = text.length === 0 && !this.editing;
    }
  }
  class MockCheckBox extends MockContainer {
    onCheck = new MockSignal();
    checked = false;
    text = "";
    constructor(options?: { checked?: boolean; text?: string }) {
      super();
      this.checked = options?.checked ?? false;
      this.text = options?.text ?? "";
    }
    forceCheck(checked: boolean): void {
      this.checked = checked;
    }
  }
  class MockRadioGroup extends MockContainer {
    protected items: MockCheckBox[];
    protected options: { items: MockCheckBox[]; selectedItem?: number };
    onChange = new MockSignal();
    selected: number;
    value = "";
    constructor(options?: { items?: MockCheckBox[]; selectedItem?: number }) {
      super();
      this.items = options?.items ?? [];
      this.selected = options?.selectedItem ?? 0;
      this.options = { items: this.items, selectedItem: this.selected };
    }
    /** The labels currently shown, in row order. */
    get labels(): string[] {
      return this.items.map((item) => item.text);
    }
    addItems(items: MockCheckBox[]): void {
      this.items.push(...items);
    }
    removeItems(ids: number[]): void {
      for (const id of ids) this.items.splice(id, 1);
    }
    selectItem(selected: number): void {
      this.selected = selected;
      this.items.forEach((item, index) => item.forceCheck(index === selected));
    }
  }
  return {
    mocks: {
      MockContainer,
      MockFancyButton,
      MockInput,
      MockCheckBox,
      MockRadioGroup,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockContainer,
  Sprite: mocks.MockContainer,
  Texture: class MockTexture {
    readonly mock = true;
  },
}));

vi.mock("@pixi/ui", () => ({
  FancyButton: mocks.MockFancyButton,
  Input: mocks.MockInput,
  CheckBox: mocks.MockCheckBox,
  RadioGroup: mocks.MockRadioGroup,
  Select: mocks.MockContainer,
  Slider: mocks.MockContainer,
  ProgressBar: mocks.MockContainer,
}));

import Yoga from "yoga-layout";
import { setYoga } from "@yagejs/ui";
import { msg } from "../core/message.js";
import { LocalizedPixiCheckbox } from "./LocalizedPixiCheckbox.js";
import { LocalizedPixiFancyButton } from "./LocalizedPixiFancyButton.js";
import { LocalizedPixiInput } from "./LocalizedPixiInput.js";
import { LocalizedPixiRadioGroup } from "./LocalizedPixiRadioGroup.js";

beforeAll(() => {
  setYoga(Yoga);
});

const italian = (m: { key: string }): string => `it:${m.key}`;
/** The two box textures every `PixiCheckbox` requires. */
const boxes = (): { checkedView: string; uncheckedView: string } => ({
  checkedView: "checked",
  uncheckedView: "unchecked",
});
const view = (element: { displayObject: unknown }): Record<string, unknown> =>
  element.displayObject as Record<string, unknown>;

describe("LocalizedPixiFancyButton", () => {
  it("follows the locale and takes a new message", () => {
    const button = new LocalizedPixiFancyButton({
      text: msg("start", "Start"),
    });
    expect(view(button).text).toBe("Start");

    button.relocalize(italian);
    expect(view(button).text).toBe("it:start");
    button.setMessage(msg("stop", "Stop"));
    expect(view(button).text).toBe("it:stop");
  });
});

describe("LocalizedPixiCheckbox", () => {
  it("follows the locale without disturbing the checked state", () => {
    const checkbox = new LocalizedPixiCheckbox({
      ...boxes(),
      text: msg("sound", "Sound"),
      checked: true,
    });
    expect(view(checkbox).text).toBe("Sound");

    checkbox.relocalize(italian);
    expect(view(checkbox).text).toBe("it:sound");
    expect(view(checkbox).checked).toBe(true);
  });
});

describe("LocalizedPixiRadioGroup", () => {
  it("follows the locale and keeps the selected row", () => {
    const group = new LocalizedPixiRadioGroup({
      items: [
        { ...boxes(), text: msg("easy", "Easy") },
        { ...boxes(), text: msg("hard", "Hard") },
      ],
      selected: 1,
      type: "vertical",
      elementsMargin: 4,
    });
    expect((view(group) as { labels: string[] }).labels).toEqual([
      "Easy",
      "Hard",
    ]);

    group.relocalize(italian);
    expect((view(group) as { labels: string[] }).labels).toEqual([
      "it:easy",
      "it:hard",
    ]);
    expect(view(group).selected).toBe(1);

    group.setMessages([msg("calm", "Calm"), msg("brutal", "Brutal")]);
    expect((view(group) as { labels: string[] }).labels).toEqual([
      "it:calm",
      "it:brutal",
    ]);
    expect(group.messages.map((m) => m.key)).toEqual(["calm", "brutal"]);
    expect(view(group).selected).toBe(1);
  });

  it("replaces the rows through setItems, keeping the selected row", () => {
    const group = new LocalizedPixiRadioGroup({
      items: [
        { ...boxes(), text: msg("easy", "Easy") },
        { ...boxes(), text: msg("hard", "Hard") },
      ],
      selected: 1,
      type: "vertical",
      elementsMargin: 4,
    });
    group.relocalize(italian);

    group.setItems([
      { ...boxes(), text: msg("calm", "Calm") },
      { ...boxes(), text: msg("brutal", "Brutal") },
      { ...boxes(), text: msg("insane", "Insane") },
    ]);
    expect((view(group) as { labels: string[] }).labels).toEqual([
      "it:calm",
      "it:brutal",
      "it:insane",
    ]);
    expect(view(group).selected).toBe(1);

    // A locale change after a replacement follows the new rows.
    group.relocalize((m) => `de:${m.key}`);
    expect((view(group) as { labels: string[] }).labels).toEqual([
      "de:calm",
      "de:brutal",
      "de:insane",
    ]);
  });

  it("rejects a relabel that does not match the row count", () => {
    const group = new LocalizedPixiRadioGroup({
      items: [{ ...boxes(), text: msg("easy", "Easy") }],
      type: "vertical",
      elementsMargin: 4,
    });
    expect(() => group.setMessages([])).toThrow(
      "LocalizedPixiRadioGroup.setMessages: expected 1 messages, one per row, got 0.",
    );
  });
});

describe("LocalizedPixiInput", () => {
  it("follows the locale without touching text the player typed", () => {
    const input = new LocalizedPixiInput({
      bg: "field",
      placeholder: msg("search", "Search"),
    });
    const field = view(input) as {
      placeholder: { text: string; visible: boolean };
      value: string;
    };
    expect(field.placeholder).toEqual({ text: "Search", visible: true });

    input.update({ value: "gemma" });
    input.relocalize(italian);
    expect(field.placeholder.text).toBe("it:search");
    expect(field.value).toBe("gemma");
    // Hidden, because the field now holds the player's text.
    expect(field.placeholder.visible).toBe(false);

    input.setMessage(msg("filter", "Filter"));
    expect(field.placeholder.text).toBe("it:filter");
  });
});
