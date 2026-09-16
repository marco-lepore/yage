import { describe, expect, it, vi, beforeAll } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    visible = true;
    eventMode = "auto";
    cursor = "default";
    zIndex = 0;
    position = { x: 0, y: 0, set: (): void => undefined };
    scale = { x: 1, y: 1, set: (): void => undefined };
    private readonly listeners = new Map<
      string,
      Set<(...a: unknown[]) => void>
    >();
    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    addChildAt(child: MockContainer, index: number): MockContainer {
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parent = null;
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    setMask(): void {}
    on(event: string, fn: (...a: unknown[]) => void): this {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(fn);
      return this;
    }
    off(): this {
      return this;
    }
    once(event: string, fn: (...a: unknown[]) => void): this {
      return this.on(event, fn);
    }
    destroy(): void {
      this.removeFromParent();
    }
  }
  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    constructor(options: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = options.text ?? "";
      this.style = { ...options.style };
    }
    get width(): number {
      return this.text.length * 8;
    }
    get height(): number {
      return 16;
    }
  }
  class MockGraphics extends MockContainer {
    clear(): this {
      return this;
    }
    rect(): this {
      return this;
    }
    roundRect(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    stroke(): this {
      return this;
    }
    moveTo(): this {
      return this;
    }
    lineTo(): this {
      return this;
    }
    circle(): this {
      return this;
    }
  }
  class MockRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }
  class MockSplitText extends MockText {
    chars: MockContainer[] = [];
    words: MockContainer[] = [];
    lines: MockContainer[] = [];
  }
  return {
    mocks: {
      MockContainer,
      MockText,
      MockGraphics,
      MockRectangle,
      MockSplitText,
    },
  };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Text: mocks.MockText,
  BitmapText: mocks.MockText,
  Graphics: mocks.MockGraphics,
  Sprite: mocks.MockContainer,
  NineSliceSprite: mocks.MockContainer,
  Rectangle: mocks.MockRectangle,
  SplitText: mocks.MockSplitText,
  SplitBitmapText: mocks.MockSplitText,
  BitmapFontManager: { getFont: () => undefined },
}));

import Yoga from "yoga-layout";
import { setYoga, UIPanel } from "@yagejs/ui";
import { msg } from "../core/message.js";
import { UILocalizedText } from "./UILocalizedText.js";
import { UILocalizedButton } from "./UILocalizedButton.js";
import { UILocalizedCheckbox } from "./UILocalizedCheckbox.js";
import { UILocalizedSplitText } from "./UILocalizedSplitText.js";
import { LocalizedUISurface } from "./LocalizedUISurface.js";

beforeAll(() => {
  setYoga(Yoga);
});

/** The string a UIText shows (its Pixi text is private). */
function shown(element: { displayObject: unknown }): string {
  return (element.displayObject as { text: string }).text;
}

describe("UILocalizedText", () => {
  it("shows the fallback by default, the resolver's text otherwise, and follows relocalize", () => {
    const plain = new UILocalizedText({
      message: msg("k", "Fallback {n}", { n: 2 }),
    });
    expect(shown(plain)).toBe("Fallback 2");

    const text = new UILocalizedText({
      message: msg("k", "Fallback"),
      resolve: (m) => `en:${m.key}`,
    });
    expect(shown(text)).toBe("en:k");
    text.setMessage(msg("other", "x"));
    expect(shown(text)).toBe("en:other");
    text.relocalize((m) => `it:${m.key}`);
    expect(shown(text)).toBe("it:k".replace("k", "other"));
    expect(text.message.key).toBe("other");
  });
});

describe("LocalizedUISurface", () => {
  it("builds localized text and button labels, in nested panels too, and relocalizes the whole tree", () => {
    const surface = new LocalizedUISurface();
    const title = surface.text(msg("title", "Title"), { fontSize: 20 });
    const plain = surface.text("Plain");
    const button = surface.button(msg("start", "Start"), {
      textStyle: { fontSize: 12 },
    });
    const nested = surface.panel();
    const inner = surface.text(msg("inner", "Inner"), undefined, nested);

    expect(title).toBeInstanceOf(UILocalizedText);
    expect(shown(title)).toBe("Title");
    expect(shown(plain)).toBe("Plain");
    expect(nested.children).toContain(inner);
    expect(button).toBeInstanceOf(UILocalizedButton);
    const label = button.children[0] as UILocalizedText;
    expect(shown(label)).toBe("Start");

    surface.relocalize((m) => `it:${m.key}`);
    expect(shown(title)).toBe("it:title");
    expect(shown(plain)).toBe("Plain");
    expect(shown(label)).toBe("it:start");
    expect(shown(inner)).toBe("it:inner");
    // Later builders use the resolver from the last relocalize.
    expect(shown(surface.text(msg("late", "Late")))).toBe("it:late");
    expect(surface.root).toBeInstanceOf(UIPanel);
  });
});

describe("UILocalizedButton", () => {
  it("localizes its own label and keeps the button's text style", () => {
    const button = new UILocalizedButton({
      message: msg("start", "Start"),
      textStyle: { fontSize: 12 },
    });
    const label = (): string => shown(button.children[0] as UILocalizedText);

    expect(label()).toBe("Start");
    button.relocalize((m) => `it:${m.key}`);
    expect(label()).toBe("it:start");
    button.setMessage(msg("stop", "Stop"));
    expect(label()).toBe("it:stop");
    expect(button.message.key).toBe("stop");
  });
});

describe("UILocalizedSplitText", () => {
  it("re-splits on a locale change", () => {
    const split = new UILocalizedSplitText({
      message: msg("line", "One two"),
      autoSplit: false,
    });
    expect(split.splitText.text).toBe("One two");

    split.relocalize((m) => `it:${m.key}`);
    expect(split.splitText.text).toBe("it:line");
  });
});

describe("UILocalizedCheckbox", () => {
  it("localizes its label and leaves the checked state alone", () => {
    const checkbox = new UILocalizedCheckbox({
      label: msg("sound", "Sound"),
      checked: true,
    });
    expect(checkbox.message.key).toBe("sound");

    checkbox.relocalize((m) => `it:${m.key}`);
    expect(checkbox.checked).toBe(true);
    checkbox.setMessage(msg("music", "Music"));
    expect(checkbox.message.key).toBe("music");
  });
});

describe("LocalizedUISurface insertion", () => {
  it("resolves an element added by hand, at the surface's current locale", () => {
    const surface = new LocalizedUISurface();
    surface.relocalize((m) => `it:${m.key}`);

    const added = new UILocalizedText({ message: msg("added", "Added") });
    surface.addElement(added);
    expect(shown(added)).toBe("it:added");

    const panel = surface.panel();
    const nested = new UILocalizedText({ message: msg("nested", "Nested") });
    surface.addElement(nested, panel);
    expect(shown(nested)).toBe("it:nested");
    expect(panel.children).toContain(nested);

    // The plain UIPanel path still shows the fallback until the next pass.
    const raw = new UILocalizedText({ message: msg("raw", "Raw") });
    panel.addElement(raw);
    expect(shown(raw)).toBe("Raw");
    surface.relocalize((m) => `it:${m.key}`);
    expect(shown(raw)).toBe("it:raw");
  });
});
