// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  TiledAssetButton,
  type TiledAssetActions,
} from "./TiledAssetButton.js";

let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
});

async function mount(actions: TiledAssetActions) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  root = createRoot(host);
  const render = async (path: string, revision = 0) => {
    await act(async () => {
      root?.render(
        <TiledAssetButton path={path} revision={revision} actions={actions} />,
      );
    });
  };
  await render("maps/room.json");
  return { host, render };
}

it("opens the selected map and shows an actionable launch failure", async () => {
  const open = vi.fn(async () => ({
    ok: false as const,
    message: "Set YAGE_TILED_PATH.",
  }));
  const { host } = await mount({
    describe: async () => ({ source: "art/room.tmx" }),
    open,
  });
  expect(host.querySelector("button")?.title).toContain("art/room.tmx");
  await act(async () => {
    host.querySelector("button")?.click();
  });
  expect(open).toHaveBeenCalledWith("maps/room.json");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Set YAGE_TILED_PATH.",
  );
});

it("ignores stale descriptions and rechecks after an external asset edit", async () => {
  let finish!: (value: { source: string }) => void;
  const describe = vi.fn((path: string) =>
    path === "maps/room.json"
      ? new Promise<{ source: string }>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ source: null }),
  );
  const { host, render } = await mount({
    describe,
    open: async () => ({ ok: true }),
  });
  await render("maps/other.json");
  await act(async () => {
    finish({ source: "art/room.tmx" });
  });
  expect(host.querySelector("button")).toBeNull();
  await render("maps/other.json", 1);
  expect(describe).toHaveBeenCalledTimes(3);
});
