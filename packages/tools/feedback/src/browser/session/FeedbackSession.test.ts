import { expect, it } from "vitest";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { FeedbackClient } from "../../client/FeedbackClient.js";
import { FeedbackSession } from "./FeedbackSession.js";
import type { FeedbackHost, FeedbackObservation } from "./FeedbackSession.js";
import type { FeedbackUpload } from "../../shared/protocol.js";

async function setup(timeout = 30000) {
  const requests: FeedbackUpload[] = [];
  let received: (() => void) | undefined;
  let respond = false;
  const responses: ServerResponse[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.from(chunk as Uint8Array));
    const data = JSON.parse(Buffer.concat(chunks).toString()) as FeedbackUpload;
    requests.push(data);
    responses.push(response);
    received?.();
    if (respond) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          comment: { ...data.comment, revision: 0, history: [] },
          capture: data.capture,
          screenshotPath: "/tmp/test.png",
          screenshotUrl: "/test.png",
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  let frozen = false;
  let captures = 0;
  const observation: FeedbackObservation = {
    image: "data:image/png;base64,fixture",
    capture: {
      id: randomUUID(),
      version: 1,
      sessionId: randomUUID(),
      created: new Date().toISOString(),
      frame: 42,
      url: "http://127.0.0.1",
      width: 1,
      height: 1,
      context: {},
      snapshot: { frame: 42 },
      entities: [],
    },
  };
  const host: FeedbackHost = {
    capture: () => {
      frozen = true;
      captures++;
      return observation;
    },
    freeze: () => {
      frozen = true;
    },
    release: () => {
      frozen = false;
    },
    toggleFreeze: () => (frozen = !frozen),
    canStep: () => frozen,
    step: () => {},
  };
  const session = new FeedbackSession(
    host,
    new FeedbackClient(`http://127.0.0.1:${address.port}`, timeout),
  );
  return {
    session,
    requests,
    responses,
    frozen: () => frozen,
    captures: () => captures,
    waitForRequest: () =>
      new Promise<void>((resolve) => {
        received = resolve;
      }),
    enableResponses: () => {
      respond = true;
    },
    close: async () => {
      session.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

it("cancels a stalled upload, releases time on close, and retries the same draft after reopening", async () => {
  const test = await setup();
  try {
    const observation = test.session.open();
    const received = test.waitForRequest();
    const saving = test.session.save("Keep this draft", { kind: "global" });
    await received;
    test.session.cancelSave();
    test.session.close();
    expect(await saving).toBe(false);
    expect(test.frozen()).toBe(false);
    expect(test.session.pending).toBe(true);
    expect(test.session.open()).toEqual(observation);
    expect(test.frozen()).toBe(true);
    expect(test.captures()).toBe(1);
    test.enableResponses();
    expect(
      await test.session.save("Replacement must be ignored", {
        kind: "global",
      }),
    ).toBe(true);
    expect(test.requests[1]).toEqual(test.requests[0]);
    expect(test.session.comments).toHaveLength(1);
  } finally {
    await test.close();
  }
});

it("times out a stalled HTTP response while retaining the retry payload", async () => {
  const test = await setup(100);
  try {
    test.session.open();
    await expect(
      test.session.save("Timeout evidence", { kind: "global" }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(test.session.pending).toBe(true);
    test.session.close();
    expect(test.frozen()).toBe(false);
    test.session.open();
    test.enableResponses();
    expect(await test.session.save("", { kind: "global" })).toBe(true);
    expect(test.requests[1]).toEqual(test.requests[0]);
  } finally {
    await test.close();
  }
});
