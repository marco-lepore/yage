import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Container,
  EventBoundary,
  EventSystem,
  extensions,
  FederatedContainer,
  Graphics,
  Rectangle,
} from "pixi.js";
import { getPointerConsumePolicy } from "@yagejs/core";
import Yoga from "yoga-layout";
import { setYoga } from "../yoga-helpers.js";
import { applyConsumeInput } from "../consume-input.js";
import { PixiProgressBar } from "./PixiProgressBar.js";
import { PixiFancyButton } from "./PixiFancyButton.js";

beforeAll(() => {
  setYoga(Yoga);
  extensions.mixin(Container, FederatedContainer);
  // The renderer normally installs the passive default with its event system.
  vi.spyOn(EventSystem, "defaultEventMode", "get").mockReturnValue("passive");
});
afterAll(() => vi.restoreAllMocks());

function face(): Graphics {
  return new Graphics().rect(0, 0, 100, 20).fill(0xffffff);
}

describe("Pixi widget consumption hit paths", () => {
  it.each([true, false])(
    "hits a progress bar with consumeInput=%s over the opposite root setting",
    (consumeInput) => {
      const root = new Container();
      root.hitArea = new Rectangle(0, 0, 200, 200);
      applyConsumeInput(root, !consumeInput);
      const bar = new PixiProgressBar({
        bg: face(),
        fill: face(),
        value: 50,
        consumeInput,
      });
      root.addChild(bar.displayObject);
      const boundary = new EventBoundary(root);

      expect(boundary.hitTest(10, 10)).toBe(bar.displayObject);
      expect(getPointerConsumePolicy(bar.displayObject)).toBe(consumeInput);
      bar.update({ consumeInput: undefined });
      expect(boundary.hitTest(10, 10)).toBe(bar.displayObject);
      expect(getPointerConsumePolicy(bar.displayObject)).toBe("inherit");

      bar.destroy();
      root.destroy();
    },
  );

  it("leaves disabled buttons out of the hit path when their policy changes", () => {
    const root = new Container();
    root.hitArea = new Rectangle(0, 0, 200, 200);
    applyConsumeInput(root, false);
    const button = new PixiFancyButton({
      defaultView: face(),
      disabled: true,
      consumeInput: true,
    });
    root.addChild(button.displayObject);
    const boundary = new EventBoundary(root);

    expect(boundary.hitTest(10, 10)).toBe(root);
    button.update({ consumeInput: false });
    button.update({ consumeInput: true });
    expect(boundary.hitTest(10, 10)).toBe(root);
    button.update({ disabled: false });
    expect(boundary.hitTest(10, 10)).not.toBe(root);

    button.destroy();
    root.destroy();
  });
});
