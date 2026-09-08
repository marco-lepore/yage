import { PNG } from "pngjs";
import { request as httpRequest } from "node:http";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FeedbackService } from "./FeedbackService.js";
import { startFeedbackServer } from "../../server.js";
import type { FeedbackUpload } from "../../shared/protocol.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
function upload(): FeedbackUpload {
  const id = randomUUID();
  const png = new PNG({ width: 1, height: 1 });
  png.data = Buffer.from([255, 128, 0, 255]);
  return {
    capture: {
      version: 1,
      id,
      sessionId: randomUUID(),
      created: new Date().toISOString(),
      frame: 12,
      url: "http://localhost:5213",
      width: 1,
      height: 1,
      context: { host: "runtime" },
      snapshot: { frame: 12 },
      entities: [],
    },
    image: "data:image/png;base64," + PNG.sync.write(png).toString("base64"),
    comment: {
      id: randomUUID(),
      captureId: id,
      text: "This feels empty",
      created: new Date().toISOString(),
      target: { kind: "area", rect: { x: 0, y: 0, width: 1, height: 1 } },
      status: "open",
    },
  };
}
async function store(): Promise<FeedbackService> {
  const directory = await mkdtemp(path.join(tmpdir(), "yage-feedback-test-"));
  directories.push(directory);
  return new FeedbackService(directory);
}
it("persists complete evidence across independent store instances and retries", async () => {
  const first = await store();
  const data = upload();
  await first.save(data);
  await first.save(data);
  const reopened = new FeedbackService(first.directory);
  expect(await reopened.list()).toHaveLength(1);
  const detail = await reopened.show(data.comment.id);
  expect(detail.capture).toEqual(data.capture);
  expect(detail.comment).toEqual({ ...data.comment, revision: 0, history: [] });
  expect(
    (await readFile(detail.screenshotPath)).subarray(1, 4).toString(),
  ).toBe("PNG");
});
it("serializes concurrent comments sharing a capture and rejects conflicting IDs", async () => {
  const target = await store();
  const first = upload();
  const second = structuredClone(first);
  second.comment.id = randomUUID();
  second.comment.text = "Add detail here";
  await Promise.all([target.save(first), target.save(second)]);
  expect(await target.list()).toHaveLength(2);
  await expect(
    target.save({ ...first, comment: { ...first.comment, text: "Overwrite" } }),
  ).rejects.toThrow("conflict");
  await expect(
    target.save({
      ...second,
      capture: { ...second.capture, frame: 13, snapshot: { frame: 13 } },
    }),
  ).rejects.toThrow("conflict");
  expect((await target.show(first.comment.id)).comment.text).toBe(
    first.comment.text,
  );
});
it("rejects bad dimensions, missing entity targets, and paths before persisting", async () => {
  const target = await store();
  const data = upload();
  await expect(
    target.save({ ...data, capture: { ...data.capture, width: 20 } }),
  ).rejects.toThrow("dimensions");
  await expect(
    target.save({
      ...data,
      comment: { ...data.comment, target: { kind: "entities", entities: [] } },
    }),
  ).rejects.toThrow("entities");
  await expect(target.show("../../outside")).rejects.toThrow("ID");
  await expect(
    target.save({
      ...data,
      capture: { ...data.capture, snapshot: { frame: 999 } },
    }),
  ).rejects.toThrow("snapshot frame");
  expect(await target.list()).toEqual([]);
});

it("serves persisted evidence over real HTTP and rejects disallowed origins and conflicting writes", async () => {
  const target = await store();
  const server = await startFeedbackServer({
    directory: target.directory,
    port: 0,
    origins: ["http://localhost:5213"],
  });
  try {
    const base = server.url;
    const data = upload();
    const send = (body: unknown, origin = "http://localhost:5213") =>
      fetch(`${base}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(body),
      });
    expect((await send(data, "https://example.com")).status).toBe(403);
    expect((await send(null)).status).toBe(400);
    expect((await send(data)).status).toBe(200);
    expect((await send(data)).status).toBe(200);
    expect(
      (
        await send({
          ...data,
          comment: { ...data.comment, text: "Conflicting write" },
        })
      ).status,
    ).toBe(409);
    const listing = await fetch(`${base}/comments`);
    expect(await listing.json()).toEqual([
      { ...data.comment, revision: 0, history: [] },
    ]);
    const detail = await fetch(`${base}/comments/${data.comment.id}`);
    expect(await detail.json()).toMatchObject({
      capture: data.capture,
      comment: data.comment,
    });
    const png = await fetch(
      `${base}/captures/${data.capture.id}/screenshot.png`,
    );
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await png.arrayBuffer())).toEqual(
      Buffer.from(data.image.slice(data.image.indexOf(",") + 1), "base64"),
    );
    expect((await fetch(`${base}/comments/${randomUUID()}`)).status).toBe(404);
  } finally {
    await server.close();
  }
});

it("records the lifecycle, rejects stale ingestion, and preserves status across upload retries and restarts", async () => {
  const target = await store();
  const data = upload();
  await target.save(data);
  const request = {
    requestId: randomUUID(),
    expectedRevision: 0,
    action: "ingest",
    actor: "codex/session-a",
  };
  const competing = {
    ...request,
    requestId: randomUUID(),
    actor: "claude/session-b",
  };
  const results = await Promise.allSettled([
    target.transition(data.comment.id, request),
    target.transition(data.comment.id, competing),
  ]);
  expect(results[0].status).toBe("fulfilled");
  expect(results[1].status).toBe("rejected");
  expect((await target.save(data)).comment.status).toBe("ingested");
  expect(
    (await target.transition(data.comment.id, request)).comment.history,
  ).toHaveLength(1);
  await expect(
    target.transition(data.comment.id, { ...request, actor: "different" }),
  ).rejects.toThrow("Request ID conflict");
  await expect(
    target.transition(data.comment.id, {
      ...request,
      requestId: randomUUID(),
      expectedRevision: 1,
      action: "resolve",
    }),
  ).rejects.toThrow("Cannot resolve");
  for (const [revision, action] of [
    [1, "address"],
    [2, "resolve"],
    [3, "reopen"],
  ] as const) {
    await target.transition(data.comment.id, {
      requestId: randomUUID(),
      expectedRevision: revision,
      action,
      actor: "codex/session-a",
      note: action,
    });
  }
  const reopened = new FeedbackService(target.directory);
  const detail = await reopened.show(data.comment.id);
  expect(detail.comment).toMatchObject({ status: "open", revision: 4 });
  expect(detail.comment.history.map((entry) => entry.to)).toEqual([
    "ingested",
    "addressed",
    "resolved",
    "open",
  ]);
  expect(
    (await reopened.transition(data.comment.id, request)).comment.revision,
  ).toBe(4);
  expect((await reopened.save(data)).comment.revision).toBe(4);
  expect(detail.capture).toEqual(data.capture);
  expect(await reopened.list("ingested")).toEqual([]);
  expect(await reopened.list("open")).toHaveLength(1);
});

it("reads original MVP comments without modifying their files", async () => {
  const target = await store();
  const data = upload();
  await target.save(data);
  const file = path.join(
    target.directory,
    "comments",
    `${data.comment.id}.json`,
  );
  const { writeFile } = await import("node:fs/promises");
  const legacy = JSON.stringify(data.comment);
  await writeFile(file, legacy);
  expect((await target.show(data.comment.id)).comment.revision).toBe(0);
  await target.list();
  expect(await readFile(file, "utf8")).toBe(legacy);
  await target.transition(data.comment.id, {
    requestId: randomUUID(),
    expectedRevision: 0,
    action: "ingest",
    actor: "agent",
  });
  expect((await target.show(data.comment.id)).comment.text).toBe(
    data.comment.text,
  );
});

it("allows one server per directory and releases ownership on close and failed startup", async () => {
  const target = await store();
  const first = await startFeedbackServer({
    directory: target.directory,
    port: 0,
  });
  try {
    await expect(
      startFeedbackServer({ directory: target.directory, port: 0 }),
    ).rejects.toThrow("locked");
    const other = await store();
    await expect(
      startFeedbackServer({
        directory: other.directory,
        port: Number(new URL(first.url).port),
      }),
    ).rejects.toThrow();
    const retry = await startFeedbackServer({
      directory: other.directory,
      port: 0,
    });
    await retry.close();
  } finally {
    await first.close();
  }
  const restarted = await startFeedbackServer({
    directory: target.directory,
    port: 0,
  });
  await restarted.close();
});

it("accepts equivalent reordered evidence and entity targets without rewriting files", async () => {
  const target = await store();
  const data = upload();
  const entity = {
    id: "1",
    sceneId: "scene-1",
    generation: 0,
    name: "Scout",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  };
  data.capture.entities = [entity];
  data.comment.target = { kind: "entities", entities: [entity] };
  const first = await target.save(data);
  const capturePath = path.join(
    target.directory,
    "captures",
    data.capture.id,
    "capture.json",
  );
  const originalBytes = await readFile(capturePath);
  const reverse = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverse)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, entry]) => [key, reverse(entry)]),
          )
        : value;
  const equivalent = reverse(data) as FeedbackUpload;
  // Membership must not depend on the target object's property order either.
  equivalent.comment.target = data.comment.target;
  expect(await target.save(equivalent)).toEqual(first);
  expect(await readFile(capturePath)).toEqual(originalBytes);
  expect(await target.list()).toHaveLength(1);
});

it("rejects incomplete, corrupt and oversized screenshots before publishing evidence", async () => {
  const target = await store();
  const data = upload();
  const valid = Buffer.from(data.image.split(",")[1]!, "base64");
  const corrupt = Buffer.from(valid);
  corrupt[29] = corrupt[29]! ^ 1;
  const missingEnd = valid.subarray(0, valid.length - 12);
  const duplicateHeader = Buffer.concat([
    valid.subarray(0, 33),
    valid.subarray(8),
  ]);
  for (const bytes of [
    valid.subarray(0, 33),
    corrupt,
    missingEnd,
    duplicateHeader,
  ]) {
    await expect(
      target.save({
        ...data,
        image: "data:image/png;base64," + bytes.toString("base64"),
      }),
    ).rejects.toThrow(/PNG/);
  }
  const huge = Buffer.from(valid);
  huge.writeUInt32BE(100000, 16);
  huge.writeUInt32BE(100000, 20);
  await expect(
    target.save({
      ...data,
      capture: { ...data.capture, width: 100000, height: 100000 },
      image: "data:image/png;base64," + huge.toString("base64"),
    }),
  ).rejects.toThrow("16777216 pixels");
  expect(await target.list()).toEqual([]);
  await expect(target.show(data.comment.id)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects foreign authorities even without Origin and permits loopback CLI reads", async () => {
  const target = await store();
  const server = await startFeedbackServer({
    directory: target.directory,
    port: 0,
  });
  const get = (host: string, method = "GET") =>
    new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        server.url + "/comments",
        { method, headers: { Host: host } },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.end();
    });
  try {
    for (const host of [
      "rebound.example:5212",
      "localhost.evil:5212",
      "127.0.0.1@evil",
      "localhost:80/path",
    ])
      expect(await get(host)).toBe(403);
    expect(await get("rebound.example:5212", "OPTIONS")).toBe(403);
    for (const host of [
      new URL(server.url).host,
      "localhost:5212",
      "[::1]:5212",
    ])
      expect(await get(host)).toBe(200);
    expect((await fetch(server.url + "/comments")).status).toBe(200);
  } finally {
    await server.close();
  }
});

it("rejects missing context and non-string capture timestamps", async () => {
  const target = await store();
  const data = upload();
  await expect(
    target.save({ ...data, capture: { ...data.capture, created: 1 } }),
  ).rejects.toThrow("timestamp");
  const capture: Record<string, unknown> = { ...data.capture };
  delete capture.context;
  await expect(target.save({ ...data, capture })).rejects.toThrow("JSON");
  expect(await target.list()).toEqual([]);
});
