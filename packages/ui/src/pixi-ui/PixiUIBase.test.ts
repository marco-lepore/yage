import { beforeAll, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockSignal {
    callbacks = new Set<(...args: never[]) => void>();
    connect(callback: (...args: never[]) => void): void {
      this.callbacks.add(callback);
    }
    disconnect(callback: (...args: never[]) => void): void {
      this.callbacks.delete(callback);
    }
  }

  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    worldTransform = {
      clone: () => ({ invert: () => ({ append: () => ({}) }) }),
    };
    visible = true;
    enabled = true;
    destroyed = false;
    width = 20;
    height = 10;
    zIndex = 0;
    rotation = 0;
    addChild(child: MockContainer): MockContainer {
      child.removeFromParent();
      this.children.push(child);
      child.parent = this;
      return child;
    }
    addChildAt(child: MockContainer, index: number): MockContainer {
      child.removeFromParent();
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }
    getChildIndex(child: MockContainer): number {
      return this.children.indexOf(child);
    }
    removeChild(child: MockContainer): MockContainer {
      const index = this.children.indexOf(child);
      if (index !== -1) this.children.splice(index, 1);
      child.parent = null;
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    setFromMatrix(): void {}
    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }

  class MockFancyButton extends MockContainer {
    onPress = new MockSignal();
    textView = { style: {} };
    text = "";
  }

  class MockSlider extends MockContainer {
    onChange = new MockSignal();
    onUpdate = new MockSignal();
    value = 0;
    min = 0;
    max = 100;
    step = 1;
  }

  class MockInput extends MockContainer {
    onChange = new MockSignal();
    onEnter = new MockSignal();
    value = "";
    secure = false;
    padding: number | number[] = 0;
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

  class MockProgressBar extends MockContainer {
    progress = 0;
    constructor(options?: { progress?: number }) {
      super();
      this.progress = options?.progress ?? 0;
    }
  }

  class MockSelect extends MockContainer {
    protected view = new MockContainer();
    protected scrollBox = { removeItems: vi.fn() };
    protected openButton = { text: "" };
    protected closeButton = { text: "" };
    onSelect = new MockSignal();
    value = 0;
    addedItems: unknown;
    constructor(options?: { selected?: number; items?: unknown }) {
      super();
      this.value = options?.selected ?? 0;
      this.addedItems = options?.items;
      const items = (options?.items as { items?: string[] } | undefined)?.items;
      this.openButton.text = items?.[this.value] ?? "";
      this.closeButton.text = this.openButton.text;
      this.addChild(this.view);
    }
    addItems(items: unknown, selected = 0): void {
      this.addedItems = items;
      this.value = selected;
    }
    toggle(): void {}
    open(): void {}
    close(): void {}
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
      this.options = { items: this.items, selectedItem: options?.selectedItem };
      this.selected = options?.selectedItem ?? 0;
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
      MockSlider,
      MockInput,
      MockCheckBox,
      MockProgressBar,
      MockSelect,
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
  Slider: mocks.MockSlider,
  Input: mocks.MockInput,
  CheckBox: mocks.MockCheckBox,
  ProgressBar: mocks.MockProgressBar,
  Select: mocks.MockSelect,
  RadioGroup: mocks.MockRadioGroup,
}));

import Yoga, { Display } from "yoga-layout";
import { setYoga } from "../yoga-helpers.js";
import { PixiFancyButton } from "./PixiFancyButton.js";
import { PixiSlider } from "./PixiSlider.js";
import { PixiInput } from "./PixiInput.js";
import { PixiCheckbox } from "./PixiCheckbox.js";
import { PixiProgressBar } from "./PixiProgressBar.js";
import { PixiSelect } from "./PixiSelect.js";
import { PixiRadioGroup } from "./PixiRadioGroup.js";
import type { PixiUIBase } from "./PixiUIBase.js";

beforeAll(() => setYoga(Yoga));

const view = (): never => new mocks.MockContainer() as never;

function allWrappers(): PixiUIBase<mocks.MockContainer>[] {
  return [
    new PixiFancyButton({ defaultView: view(), disabled: true }),
    new PixiSlider({ bg: view(), fill: view(), slider: view(), value: 25 }),
    new PixiInput({ bg: view(), value: "hello", secure: true, padding: 4 }),
    new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
      checked: true,
    }),
    new PixiProgressBar({ bg: view(), fill: view(), value: 50 }),
    new PixiSelect({ closedBG: view(), openBG: view(), items: ["A", "B"] }),
    new PixiRadioGroup({
      items: [{ checkedView: view(), uncheckedView: view(), text: "A" }],
      type: "vertical",
      elementsMargin: 0,
    }),
  ] as unknown as PixiUIBase<mocks.MockContainer>[];
}

describe("PixiUI wrappers", () => {
  it("destroy is idempotent for every wrapper", () => {
    for (const wrapper of allWrappers()) {
      const free = vi.spyOn(wrapper.yogaNode, "free");
      const destroy = vi.spyOn(wrapper.displayObject, "destroy");
      wrapper.destroy();
      wrapper.destroy();
      expect(free).toHaveBeenCalledTimes(1);
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });

  it("a removed visible prop restores every wrapper to Flex", () => {
    for (const wrapper of allWrappers()) {
      wrapper.update({ visible: false });
      wrapper.update({ visible: undefined });
      expect(wrapper.visible).toBe(true);
      expect(wrapper.yogaNode.getDisplay()).toBe(Display.Flex);
      wrapper.destroy();
    }
  });

  it("removed mutable props restore their constructor defaults", () => {
    const button = new PixiFancyButton({ defaultView: view(), disabled: true });
    button.update({ disabled: undefined });
    expect(
      (button.displayObject as unknown as { enabled: boolean }).enabled,
    ).toBe(true);

    const slider = new PixiSlider({
      bg: view(),
      fill: view(),
      slider: view(),
      value: 25,
      min: 10,
      max: 50,
      step: 5,
    });
    slider.update({
      value: undefined,
      min: undefined,
      max: undefined,
      step: undefined,
    });
    expect(slider.displayObject).toMatchObject({
      value: 0,
      min: 0,
      max: 100,
      step: 1,
    });

    const input = new PixiInput({
      bg: view(),
      value: "hello",
      secure: true,
      padding: 4,
    });
    input.update({ value: undefined, secure: undefined, padding: undefined });
    expect(input.displayObject).toMatchObject({
      value: "",
      secure: false,
      padding: 0,
    });

    const checkbox = new PixiCheckbox({
      checkedView: view(),
      uncheckedView: view(),
      checked: true,
      text: "Label",
    });
    checkbox.update({ checked: undefined, text: undefined });
    expect(checkbox.displayObject).toMatchObject({ checked: false, text: "" });

    const progress = new PixiProgressBar({
      bg: view(),
      fill: view(),
      value: 50,
    });
    progress.update({ value: undefined });
    expect(progress.displayObject).toMatchObject({ progress: 0 });
  });

  it("applies item updates for selects and radio groups", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });
    select.update({ items: ["C", "D"], selected: 0 });
    expect(select.displayObject).toMatchObject({
      value: 0,
      addedItems: { items: ["C", "D"] },
    });

    const radio = new PixiRadioGroup({
      items: [{ checkedView: view(), uncheckedView: view(), text: "A" }],
      type: "vertical",
      elementsMargin: 0,
    });
    radio.update({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "B" },
        { checkedView: view(), uncheckedView: view(), text: "C" },
      ],
      selected: 1,
    });
    expect(radio.displayObject).toMatchObject({ selected: 1 });
  });

  it("keeps selection in range when item updates shrink a list", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });
    select.update({ items: ["C"] });
    expect(select.displayObject).toMatchObject({ value: 0 });

    const radio = new PixiRadioGroup({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "A" },
        { checkedView: view(), uncheckedView: view(), text: "B" },
      ],
      type: "vertical",
      elementsMargin: 0,
      selected: 1,
    });
    expect(() =>
      radio.update({
        items: [{ checkedView: view(), uncheckedView: view(), text: "C" }],
      }),
    ).not.toThrow();
    expect(radio.displayObject).toMatchObject({ selected: 0 });
  });

  it("clears a select when an item update empties the list", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });

    select.update({ items: [] });

    expect(select.displayObject).toMatchObject({
      value: -1,
      openButton: { text: "" },
      closeButton: { text: "" },
    });
  });

  it("resets selection when selected is removed with an item update", () => {
    const select = new PixiSelect({
      closedBG: view(),
      openBG: view(),
      items: ["A", "B"],
      selected: 1,
    });
    select.update({ items: ["C", "D"], selected: undefined });
    expect(select.displayObject).toMatchObject({ value: 0 });

    const radio = new PixiRadioGroup({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "A" },
        { checkedView: view(), uncheckedView: view(), text: "B" },
      ],
      type: "vertical",
      elementsMargin: 0,
      selected: 1,
    });
    radio.update({
      items: [
        { checkedView: view(), uncheckedView: view(), text: "C" },
        { checkedView: view(), uncheckedView: view(), text: "D" },
      ],
      selected: undefined,
    });
    expect(radio.displayObject).toMatchObject({ selected: 0 });
  });

  it("disconnects one callback shared by two signals", () => {
    const callback = vi.fn();
    const input = new PixiInput({
      bg: view(),
      onChange: callback,
      onEnter: callback,
    });
    const inputView = input.displayObject as unknown as {
      onChange: { callbacks: Set<unknown> };
      onEnter: { callbacks: Set<unknown> };
    };

    input.destroy();

    expect(inputView.onChange.callbacks).toHaveLength(0);
    expect(inputView.onEnter.callbacks).toHaveLength(0);
  });
});
