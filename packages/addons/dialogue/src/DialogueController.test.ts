import { describe, expect, it } from "vitest";
import { createMockScene } from "@yagejs/core";

import { DialogueController } from "./DialogueController.js";
import type {
  ChoicePresenter,
  ChromePresenter,
  TextPresenter,
} from "./chrome/DialogueUiAdapter.js";
import type { DialogueScript } from "./core/index.js";
import type { InputBinding } from "./input/index.js";

class StubChrome implements ChromePresenter {
  mount(): void {}
  dispose(): void {}
  setNameplate(): void {}
  setContinueVisible(): void {}
  setVisible(): void {}
  update(): void {}
}

class StubText implements TextPresenter {
  onRevealComplete?: () => void;
  mount(): void {}
  dispose(): void {}
  present(): void {}
  completeReveal(): void {}
  isRevealComplete(): boolean {
    return true;
  }
  isRevealing(): boolean {
    return false;
  }
  setSpeedMultiplier(): void {}
  update(): void {}
  clear(): void {}
}

class StubChoices implements ChoicePresenter {
  onChoiceChosen?: (position: number) => void;
  mount(): void {}
  dispose(): void {}
  present(): void {}
  highlight(): void {}
  clear(): void {}
}

const noopBinding: InputBinding = { bind() {}, poll() {} };

const SCRIPT: DialogueScript = {
  id: "guard",
  start: "a",
  nodes: { a: { id: "a", steps: [{ kind: "say", text: "hi" }] } },
};

function makeController(): DialogueController {
  return new DialogueController({
    chrome: new StubChrome(),
    text: new StubText(),
    choices: new StubChoices(),
    input: noopBinding,
  });
}

describe("DialogueController — play() lifecycle guards (F49)", () => {
  it("play() before the component is added throws a clear error", () => {
    const controller = makeController();
    expect(() => controller.play(SCRIPT)).toThrow(
      /before the component was added/,
    );
  });

  it("play() after the component is removed refuses instead of running into disposed presenters", () => {
    const { scene } = createMockScene();
    const host = scene.spawn("dialogue-host");
    const controller = host.add(makeController());

    controller.play(SCRIPT);
    expect(controller.isActive()).toBe(true);

    host.remove(DialogueController); // runs onRemove + onDestroy

    controller.play(SCRIPT); // a stale ref (e.g. an interact closure)
    expect(controller.isActive()).toBe(false);
  });
});
