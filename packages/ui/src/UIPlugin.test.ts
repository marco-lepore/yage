import { describe, it, expect } from "vitest";
import type { EngineContext } from "@yagejs/core";
import { UIPlugin } from "./UIPlugin.js";
import { getUIDefaultTextStyle, setUIDefaultTextStyle } from "./text-defaults.js";

// install() only needs tryResolve (AssetManager is optional) and loads Yoga
// via dynamic import; a bare stub is enough to exercise the lifecycle.
const stubContext = { tryResolve: () => undefined } as unknown as EngineContext;

describe("UIPlugin default text style lifecycle", () => {
  it("sets the UI default on install and restores the prior value on destroy", async () => {
    setUIDefaultTextStyle({ fontFamily: "Prev" });
    const plugin = new UIPlugin({ defaultTextStyle: { fontFamily: "UI" } });

    await plugin.install(stubContext);
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "UI" });

    plugin.onDestroy();
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "Prev" });

    setUIDefaultTextStyle(undefined);
  });

  it("restores to undefined when there was no prior default", async () => {
    setUIDefaultTextStyle(undefined);
    const plugin = new UIPlugin({ defaultTextStyle: { fontFamily: "UI" } });

    await plugin.install(stubContext);
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "UI" });

    plugin.onDestroy();
    expect(getUIDefaultTextStyle()).toBeUndefined();
  });
});
