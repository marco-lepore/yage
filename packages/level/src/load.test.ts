import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLevelDocument } from "./load.js";

const LEVEL = {
  format: "yage-level",
  version: 1,
  id: "forest",
  entities: [],
};

function answering(body: unknown, init?: { ok?: boolean; status?: number }) {
  return vi.fn(() =>
    Promise.resolve({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      statusText: "OK",
      json: () => Promise.resolve(body),
    } as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLevelDocument", () => {
  it("reads a level from a URL", async () => {
    vi.stubGlobal("fetch", answering(LEVEL));

    const document = await loadLevelDocument("/levels/forest.yage-level.json");

    expect(document.id).toBe("forest");
  });

  it("never takes a cached copy", async () => {
    // A level being edited changes under the page, and a cached one would look
    // like an editor that had lost the change.
    const fetching = answering(LEVEL);
    vi.stubGlobal("fetch", fetching);

    await loadLevelDocument("/levels/forest.yage-level.json");

    expect(fetching).toHaveBeenCalledWith("/levels/forest.yage-level.json", {
      cache: "no-store",
    });
  });

  it("names the URL when the server refuses", async () => {
    vi.stubGlobal("fetch", answering({}, { ok: false, status: 404 }));

    await expect(
      loadLevelDocument("/levels/missing.yage-level.json"),
    ).rejects.toThrow("/levels/missing.yage-level.json answered 404");
  });

  it("names the URL when the network never answered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    await expect(
      loadLevelDocument("/levels/forest.yage-level.json"),
    ).rejects.toThrow("could not be reached");
  });

  it("says what is wrong when the file is not a level", async () => {
    vi.stubGlobal("fetch", answering({ format: "something-else" }));

    await expect(
      loadLevelDocument("/levels/forest.yage-level.json"),
    ).rejects.toThrow("is not a readable level");
  });

  it("says so when the answer is not JSON at all", async () => {
    // A dev server that answers a missing file with its index page.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        } as unknown as Response),
      ),
    );

    await expect(
      loadLevelDocument("/levels/forest.yage-level.json"),
    ).rejects.toThrow("did not answer with JSON");
  });
});
