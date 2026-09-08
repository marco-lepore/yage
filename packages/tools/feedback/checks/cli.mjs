import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Uses a real saved browser capture. Adds one new acceptance comment;
// source comments and their workflow are never changed.
const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const server = process.argv[2] ?? "http://127.0.0.1:5212";
const run = async (...args) =>
  JSON.parse(
    (await execute(process.execPath, [cli, ...args, "--server", server]))
      .stdout,
  );
const comments = await run("list");
assert.ok(comments.length, "Save a browser comment before this check.");
const source = await run("show", comments.at(-1).id);
const image = Buffer.from(
  await (await fetch(new URL(source.screenshotUrl, server))).arrayBuffer(),
);
const upload = {
  capture: source.capture,
  image: `data:image/png;base64,${image.toString("base64")}`,
  comment: {
    id: randomUUID(),
    captureId: source.capture.id,
    created: new Date().toISOString(),
    text: "CLI lifecycle acceptance: independently read, ingest, address, resolve, and reopen this captured observation.",
    target: { kind: "global" },
    status: "open",
  },
};
const posted = await fetch(new URL("comments", server.replace(/\/?$/, "/")), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(upload),
});
assert.equal(posted.status, 200);
const id = upload.comment.id;
const first = await run("show", id);
assert.equal(first.comment.revision, 0);
assert.equal(first.capture.frame, first.capture.snapshot.frame);
const requests = [];
for (const [revision, action, status] of [
  [0, "ingest", "ingested"],
  [1, "address", "addressed"],
  [2, "resolve", "resolved"],
  [3, "reopen", "open"],
]) {
  const args = [
    action,
    id,
    "--revision",
    String(revision),
    "--by",
    "cli-acceptance",
    "--request-id",
    randomUUID(),
    "--note",
    `Verified ${action}`,
  ];
  requests.push(args);
  const detail = await run(...args);
  assert.equal(detail.comment.status, status);
  assert.equal(detail.comment.revision, revision + 1);
  assert.equal((await run(...args)).comment.history.length, revision + 1);
  assert.ok(
    (await run("list", "--status", status)).some(
      (comment) => comment.id === id,
    ),
  );
}
assert.equal((await run(...requests[0])).comment.revision, 4);
await assert.rejects(
  run(
    "ingest",
    id,
    "--revision",
    "0",
    "--by",
    "other-agent",
    "--request-id",
    randomUUID(),
  ),
  /current revision is 4/,
);
const retry = await fetch(new URL("comments", server.replace(/\/?$/, "/")), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(upload),
});
assert.equal((await retry.json()).comment.revision, 4);
const final = await run("show", id);
assert.deepEqual(final.capture, source.capture);
assert.deepEqual(
  (await run("show", source.comment.id)).comment,
  source.comment,
);
console.log(
  JSON.stringify(
    {
      id,
      captureId: source.capture.id,
      frame: source.capture.frame,
      revision: final.comment.revision,
      history: final.comment.history.map((entry) => entry.to),
      screenshotSha256: createHash("sha256").update(image).digest("hex"),
      sourceCommentUnchanged: true,
    },
    null,
    2,
  ),
);
