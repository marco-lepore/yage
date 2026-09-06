import { describe, expect, it } from "vitest";
import {
  EDITOR_API_PREFIX,
  EDITOR_TOKEN_HEADER,
} from "../../shared/protocol/index.js";
import { EditorApiClient, EditorApiError } from "./EditorApiClient.js";

interface Recorded {
  readonly url: string;
  readonly method: string | undefined;
  readonly token: unknown;
  readonly body: string | undefined;
}

function clientAnswering(answer: () => Response | Promise<Response>): {
  client: EditorApiClient;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const client = new EditorApiClient({
    token: "secret-token",
    fetch: (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method,
        token: (init?.headers as Record<string, string> | undefined)?.[
          EDITOR_TOKEN_HEADER
        ],
        body: init?.body === undefined ? undefined : String(init.body),
      });
      return Promise.resolve(answer());
    },
  });
  return { client, calls };
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200 });

describe("EditorApiClient", () => {
  it("names the level in the query and carries the project token", async () => {
    const { client, calls } = clientAnswering(() =>
      json({ status: "accepted", snapshot: { path: "a" } }),
    );
    await client.fetchSnapshot("levels/forest.yage-level.json");

    expect(calls[0]?.url).toBe(
      `${EDITOR_API_PREFIX}/draft?path=levels%2Fforest.yage-level.json`,
    );
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.token).toBe("secret-token");
  });

  it("returns the open-level answer as the outcome the route sends", async () => {
    const { client } = clientAnswering(() =>
      json({ status: "rejected", code: "missing-file", message: "gone" }),
    );

    // The route answers an envelope, not a document. Reading it as a document
    // is what put an undefined level in the store.
    await expect(
      client.fetchSnapshot("levels/forest.yage-level.json"),
    ).resolves.toMatchObject({ status: "rejected", code: "missing-file" });
  });

  it("asks for the asset listing with no query and the project token", async () => {
    const { client, calls } = clientAnswering(() =>
      json({ paths: ["sprites/crate.png"], truncated: false }),
    );

    const listing = await client.listAssets();

    expect(calls[0]?.url).toBe(`${EDITOR_API_PREFIX}/assets`);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.token).toBe("secret-token");
    expect(listing).toEqual({ paths: ["sprites/crate.png"], truncated: false });
  });

  it("throws when the asset listing answers a status", async () => {
    const { client } = clientAnswering(
      () => new Response("nope", { status: 500 }),
    );

    await expect(client.listAssets()).rejects.toBeInstanceOf(EditorApiError);
  });

  it("sends a command as a JSON body", async () => {
    const { client, calls } = clientAnswering(() =>
      json({ status: "accepted" }),
    );
    await client.sendCommand("levels/forest.yage-level.json", {
      epoch: "epoch-1",
      expectedDraftRevision: 3,
      command: { kind: "set-poses", commandId: "c1", poses: [] },
    });

    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "")).toMatchObject({
      expectedDraftRevision: 3,
    });
  });

  it("returns a refusal the server chose rather than throwing", async () => {
    const { client } = clientAnswering(() =>
      json({ status: "rejected", code: "stale-disk", message: "moved" }),
    );

    await expect(
      client.save("levels/forest.yage-level.json", {
        epoch: "epoch-1",
        expectedDraftRevision: 1,
        expectedDiskRevision: "disk-1",
      }),
    ).resolves.toMatchObject({ status: "rejected", code: "stale-disk" });
  });

  it("throws when the request never reached the server", async () => {
    const client = new EditorApiClient({
      token: "t",
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await expect(client.bootstrap()).rejects.toBeInstanceOf(EditorApiError);
  });

  it("throws on a status the editor routes never answer with", async () => {
    const { client } = clientAnswering(
      () => new Response("no route", { status: 404 }),
    );

    await expect(client.bootstrap()).rejects.toThrow("status 404");
  });

  it("throws when the answer is not JSON", async () => {
    const { client } = clientAnswering(
      () => new Response("<html>dev server</html>", { status: 200 }),
    );

    await expect(client.bootstrap()).rejects.toThrow("did not answer JSON");
  });
});
