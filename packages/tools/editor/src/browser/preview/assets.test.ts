import type { AssetHandle, AssetManager } from "@yagejs/core";
import type { PreparedLevel, PreparedPlacement } from "@yagejs/level";
import { describe, expect, it } from "vitest";
import {
  PreviewAssetLease,
  assetKey,
  placementsMissingAssets,
} from "./assets.js";

function handle(path: string): AssetHandle<unknown> {
  return { type: "texture", path } as AssetHandle<unknown>;
}

/** Records what the engine was asked to load and release, and can fail a path. */
function createAssets(failing: readonly string[] = []): {
  assets: AssetManager;
  loaded: string[];
  unloaded: string[];
} {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  const assets = {
    loadAll(handles: readonly AssetHandle<unknown>[]) {
      for (const one of handles) {
        if (failing.includes(one.path)) {
          return Promise.reject(new Error(`${one.path} is missing.`));
        }
        loaded.push(one.path);
      }
      return Promise.resolve();
    },
    unload(one: AssetHandle<unknown>) {
      unloaded.push(one.path);
    },
  } as unknown as AssetManager;
  return { assets, loaded, unloaded };
}

describe("PreviewAssetLease", () => {
  it("takes one reference per asset however often it is asked", async () => {
    const { assets, loaded } = createAssets();
    const lease = new PreviewAssetLease(assets);

    await lease.acquire([handle("crate.png")]);
    await lease.acquire([handle("crate.png"), handle("torch.png")]);

    // A second reference for one key would need a second release, and the
    // engine destroys the asset when the last one goes.
    expect(loaded).toEqual(["crate.png", "torch.png"]);
  });

  it("keeps an asset the new level still needs", async () => {
    const { assets, unloaded } = createAssets();
    const lease = new PreviewAssetLease(assets);

    await lease.acquire([handle("crate.png"), handle("torch.png")]);
    await lease.acquire([handle("crate.png")]);
    lease.release();

    expect(unloaded).toEqual(["torch.png"]);
  });

  it("remembers a failure so the next rebuild does not retry it", async () => {
    const { assets, loaded } = createAssets(["gone.png"]);
    const lease = new PreviewAssetLease(assets);

    await lease.acquire([handle("gone.png")]);
    await lease.acquire([handle("gone.png")]);

    expect(loaded).toEqual([]);
    expect(lease.failures.get("texture:gone.png")).toBe("gone.png is missing.");
  });

  it("forgets a failure once the level stops asking for it", async () => {
    const { assets } = createAssets(["gone.png"]);
    const lease = new PreviewAssetLease(assets);

    await lease.acquire([handle("gone.png")]);
    await lease.acquire([]);
    lease.release();

    expect(lease.failures.size).toBe(0);
  });

  it("loads the new level's assets before releasing the old one's", async () => {
    const { assets, loaded, unloaded } = createAssets();
    const lease = new PreviewAssetLease(assets);
    await lease.acquire([handle("old.png")]);

    // The order the coordinator runs: everything the new level needs is held
    // before anything the old one held is let go, so a texture both use never
    // drops to zero references.
    await lease.acquire([handle("new.png")]);
    expect(unloaded).toEqual([]);
    expect(loaded).toEqual(["old.png", "new.png"]);

    lease.release();
    expect(unloaded).toEqual(["old.png"]);
  });

  it("releases against the open level, not the one that asked", async () => {
    const { assets, unloaded } = createAssets();
    const lease = new PreviewAssetLease(assets);

    // Two levels opened before either release runs. A release deferred from
    // the first must still keep what the third holds, or it would unload the
    // texture the level on screen is drawing with.
    await lease.acquire([handle("first.png")]);
    await lease.acquire([handle("second.png")]);
    await lease.acquire([handle("second.png"), handle("third.png")]);
    lease.release();
    lease.release();

    expect(unloaded).toEqual(["first.png"]);
  });

  it("releases everything it holds when the editor closes", async () => {
    const { assets, unloaded } = createAssets();
    const lease = new PreviewAssetLease(assets);

    await lease.acquire([handle("crate.png"), handle("torch.png")]);
    lease.releaseAll();

    expect(unloaded.sort()).toEqual(["crate.png", "torch.png"]);
    lease.releaseAll();
    expect(unloaded).toHaveLength(2);
  });
});

describe("placementsMissingAssets", () => {
  function prepared(
    entries: Array<{ id: string; assets: readonly string[] }>,
  ): PreparedLevel {
    const placements = entries.map(
      (entry) =>
        ({
          placement: {
            id: entry.id,
            type: "game.crate",
            typeVersion: 1,
            active: true,
            transform: {
              position: { x: 0, y: 0 },
              rotation: 0,
              scale: { x: 1, y: 1 },
            },
            params: {},
            extensions: {},
          },
          entry: {} as PreparedPlacement["entry"],
          assets: entry.assets.map(handle),
          references: [],
        }) satisfies PreparedPlacement,
    );
    return {
      document: {
        format: "yage-level",
        version: 1,
        id: "forest",
        metadata: {},
        entities: placements.map((one) => one.placement),
        extensions: {},
      },
      placements,
      diagnostics: [],
    };
  }

  it("names the placements whose assets did not load", () => {
    const blocked = placementsMissingAssets(
      prepared([
        { id: "crate", assets: ["crate.png"] },
        { id: "torch", assets: ["gone.png"] },
      ]),
      new Map([[assetKey(handle("gone.png")), "gone.png is missing."]]),
    );

    expect([...blocked.keys()]).toEqual(["torch"]);
    expect(blocked.get("torch")).toBe("gone.png is missing.");
  });

  it("names nobody when everything loaded", () => {
    const blocked = placementsMissingAssets(
      prepared([{ id: "crate", assets: ["crate.png"] }]),
      new Map(),
    );

    expect(blocked.size).toBe(0);
  });
});
