import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { net, resetFakeElectron } from "../test/fakeElectron.js";
import { serveGameFile } from "./gameProtocol.js";

const POLICY = "default-src 'self'";

let root: string;

beforeEach(async () => {
  resetFakeElectron();
  root = await mkdtemp(join(tmpdir(), "yage-web-"));
  await writeFile(join(root, "index.html"), "<!doctype html>", "utf8");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(join(root, "assets", "game.js"), "export {};", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

async function serve(url: string, method = "GET"): Promise<Response> {
  return serveGameFile(root, POLICY, request(url, method));
}

describe("serveGameFile", () => {
  it("serves the page at the root of the game origin", async () => {
    const response = await serve("yage://game/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("index.html");
  });

  it("serves a file in a directory", async () => {
    const response = await serve("yage://game/assets/game.js");
    expect(await response.text()).toContain(join("assets", "game.js"));
  });

  it("carries the policy on every answer", async () => {
    for (const [url, method] of [
      ["yage://game/", "GET"],
      ["yage://game/", "POST"],
      ["yage://other/", "GET"],
      ["yage://game/..%2Fsecret", "GET"],
      ["yage://game/%E0", "GET"],
    ] as const) {
      const response = await serve(url, method);
      expect(response.headers.get("Content-Security-Policy")).toBe(POLICY);
    }
  });

  it("keeps the status and the type of the file it served", async () => {
    net.respond = () =>
      Promise.resolve(
        new Response("body", {
          status: 206,
          headers: { "Content-Type": "text/javascript" },
        }),
      );
    const response = await serve("yage://game/assets/game.js");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Type")).toBe("text/javascript");
    expect(response.headers.get("Content-Security-Policy")).toBe(POLICY);
  });

  it("answers anything but a read of the game with a refusal", async () => {
    expect((await serve("yage://game/", "POST")).status).toBe(405);
    expect((await serve("yage://other/index.html")).status).toBe(404);
    expect((await serve("yage://game/..%2Fsecret")).status).toBe(403);
    expect((await serve("yage://game/a/..%2F..%2Fsecret")).status).toBe(403);
    expect((await serve("yage://game/%E0")).status).toBe(400);
  });

  it("answers 404 when the file is not there", async () => {
    net.respond = () => Promise.reject(new Error("no such file"));
    expect((await serve("yage://game/missing.js")).status).toBe(404);
  });
});
