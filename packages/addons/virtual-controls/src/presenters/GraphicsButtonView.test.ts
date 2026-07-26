import { describe, expect, it, vi } from "vitest";

vi.mock("@yagejs/renderer", async () => {
  const { Component } =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");

  class MockGraphics {
    visible = true;

    clear(): this {
      return this;
    }

    circle(): this {
      return this;
    }

    fill(): this {
      return this;
    }

    stroke(): this {
      return this;
    }
  }

  class GraphicsComponent extends Component {
    readonly graphics = new MockGraphics();
  }

  class TextComponent extends Component {
    readonly text = { visible: true, alpha: 1 };

    constructor(options: { alpha?: number }) {
      super();
      this.text.alpha = options.alpha ?? 1;
    }

    mergeStyle(): void {}
  }

  return { GraphicsComponent, TextComponent };
});

import { createMockEntity } from "@yagejs/core";
import { VirtualControlsModel } from "../core/model.js";
import { GraphicsButtonView } from "./GraphicsButtonView.js";
import { defaultControlsTheme } from "./theme.js";

describe("GraphicsButtonView", () => {
  it("hides invisible buttons and dims disabled buttons", () => {
    const { scene } = createMockEntity();
    const model = new VirtualControlsModel({ buttons: [{ id: "a" }] });
    model.setViewport({ x: 0, y: 0, width: 800, height: 600 });
    const button = model.button("a")!;
    const theme = defaultControlsTheme();
    const view = new GraphicsButtonView(scene, button, theme);
    const visuals = view as unknown as {
      gfx: { graphics: { visible: boolean } };
      text: { text: { visible: boolean; alpha: number } };
    };

    view.setVisible(true);
    model.setButtonVisible("a", false);
    view.update(1 / 60);
    expect(visuals.gfx.graphics.visible).toBe(false);
    expect(visuals.text.text.visible).toBe(false);

    model.setButtonVisible("a", true);
    model.setButtonEnabled("a", false);
    view.update(1);
    expect(visuals.gfx.graphics.visible).toBe(true);
    expect(visuals.text.text.visible).toBe(true);
    expect(visuals.text.text.alpha).toBeLessThan(theme.labelAlpha);
  });
});
