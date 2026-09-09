import { afterEach, expect, it } from "vitest";
import { createServer, build } from "vite";
import type { ViteDevServer } from "vite";
import { mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { yageFeedback } from "./vite.js";
import { FeedbackClient } from "../client/FeedbackClient.js";
import { startFeedbackServer } from "../server/http/server.js";
import type { FeedbackUpload } from "../shared/protocol.js";

const roots: string[] = [];
const servers: ViteDevServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root(): Promise<string> {
  const value = await realpath(
    await mkdtemp(path.join(tmpdir(), "feedback-vite-")),
  );
  roots.push(value);
  await writeFile(
    path.join(value, "index.html"),
    "<!doctype html><html><head><title>Game</title></head><body>Game</body></html>",
  );
  return value;
}
async function dev(directory: string, port = 0): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: false,
    root: directory,
    base: "/game/",
    logLevel: "silent",
    plugins: [yageFeedback()],
    server: { host: "127.0.0.1", port, watch: null },
  });
  servers.push(server);
  await server.listen();
  return server;
}
function origin(server: ViteDevServer): string {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}
function upload(): FeedbackUpload {
  const captureId = randomUUID();
  const created = new Date().toISOString();
  const png = new PNG({ width: 1, height: 1 });
  png.data = Buffer.from([0, 128, 255, 255]);
  return {
    capture: {
      version: 1,
      id: captureId,
      sessionId: randomUUID(),
      created,
      frame: 4,
      url: "http://localhost/game/",
      width: 1,
      height: 1,
      context: {},
      snapshot: { frame: 4 },
      entities: [],
    },
    image: "data:image/png;base64," + PNG.sync.write(png).toString("base64"),
    comment: {
      id: randomUUID(),
      captureId,
      created,
      text: "<script>unsafe</script> More detail here",
      target: { kind: "global" },
      status: "open",
    },
  };
}
it("shares Vite's selected port, preserves nested paths and evidence, and releases ownership on restart", async () => {
  const firstRoot = await root();
  const first = await dev(firstRoot);
  const address = first.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const second = await dev(await root(), address.port);
  expect(origin(second)).not.toBe(origin(first));
  const base = origin(first) + "/game/__yage/feedback/api";
  const client = new FeedbackClient(base);
  const html = await (await fetch(origin(first) + "/game/")).text();
  expect(html).toContain('content="/game/__yage/feedback/api/"');
  const data = upload();
  const saved = await client.save(data);
  expect(saved.screenshotUrl).toBe(
    `/game/__yage/feedback/api/captures/${data.capture.id}/screenshot.png`,
  );
  const png = await fetch(new URL(saved.screenshotUrl, base));
  expect(png.status).toBe(200);
  expect(png.headers.get("content-type")).toBe("image/png");
  expect((await client.show(data.comment.id)).capture.snapshot).toEqual({
    frame: 4,
  });
  expect(
    await new FeedbackClient(
      origin(second) + "/game/__yage/feedback/api/",
    ).list(),
  ).toEqual([]);
  const gallery = await fetch(client.galleryUrl);
  expect(gallery.url).toBe(origin(first) + "/game/__yage/feedback/");
  expect(await gallery.text()).toContain(
    'content="/game/__yage/feedback/api/"',
  );
  expect((await client.session()).project).toBe(firstRoot);
  expect(
    (
      await fetch(base + "/comments", {
        headers: { Origin: "https://foreign.example" },
      })
    ).status,
  ).toBe(403);
  await expect(
    startFeedbackServer({
      directory: path.join(firstRoot, ".yage/feedback"),
      port: 0,
    }),
  ).rejects.toThrow("locked");
  const before = first.config;
  await first.restart();
  expect(first.config).not.toBe(before);
  expect(await client.list()).toHaveLength(1);
  await first.close();
  const standalone = await startFeedbackServer({
    directory: path.join(firstRoot, ".yage/feedback"),
    port: 0,
    basePath: "/review/api/",
  });
  try {
    const reopened = new FeedbackClient(standalone.url);
    expect(await reopened.list()).toHaveLength(1);
    expect((await reopened.show(data.comment.id)).screenshotUrl).toContain(
      "/review/api/captures/",
    );
    await reopened.transition(data.comment.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "ingest",
      actor: "integration-test",
    });
    expect((await reopened.list("ingested"))[0]?.revision).toBe(1);
  } finally {
    await standalone.close();
  }
}, 20_000);

it("does not install feedback routes or discovery metadata in a production build", async () => {
  const directory = await root();
  await build({
    configFile: false,
    root: directory,
    logLevel: "silent",
    plugins: [yageFeedback()],
  });
  expect(
    await readFile(path.join(directory, "dist/index.html"), "utf8"),
  ).not.toContain("yage-feedback");
  await expect(
    readFile(path.join(directory, ".yage/feedback/.server.lock")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("leaves no directory lock when the port is already in use", async () => {
  const first = await dev(await root());
  const address = first.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const directory = await root();
  const failed = await createServer({
    configFile: false,
    root: directory,
    logLevel: "silent",
    plugins: [yageFeedback()],
    server: {
      host: "127.0.0.1",
      port: address.port,
      strictPort: true,
      watch: null,
    },
  });
  servers.push(failed);
  await expect(failed.listen()).rejects.toThrow("already in use");
  await expect(
    readFile(path.join(directory, ".yage/feedback/.server.lock")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const reopened = await startFeedbackServer({
    directory: path.join(directory, ".yage/feedback"),
    port: 0,
  });
  await reopened.close();
});

it("rejects listen while another server owns the directory", async () => {
  const directory = await root();
  const first = await dev(directory);
  const second = await createServer({
    configFile: false,
    root: directory,
    logLevel: "silent",
    plugins: [yageFeedback()],
    server: { host: "127.0.0.1", port: 0, watch: null },
  });
  servers.push(second);
  await expect(second.listen()).rejects.toThrow("locked");
  const health = await fetch(
    origin(first) + "/game/__yage/feedback/api/health",
  );
  expect(health.status).toBe(200);
});
