import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { FeedbackService } from "../service/FeedbackService.js";
import { FeedbackError } from "../../shared/errors.js";
import { acquireDirectoryLock } from "../files/DirectoryLock.js";

export interface FeedbackServerOptions {
  directory: string;
  port?: number;
  origins?: string[];
}
export interface FeedbackServer {
  readonly url: string;
  /** Stops HTTP and waits for accepted writes before releasing the directory. */
  close(): Promise<void>;
}
export async function startFeedbackServer(
  options: FeedbackServerOptions,
): Promise<FeedbackServer> {
  const store = new FeedbackService(options.directory);
  const origins = options.origins ?? [
    "http://127.0.0.1:5213",
    "http://127.0.0.1:5214",
    "http://localhost:5214",
  ];
  const send = (
    response: ServerResponse,
    status: number,
    body: unknown,
  ): void => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  };
  async function route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    // Same-origin GET requests can omit Origin. Validate authority first.
    const host = request.headers.host;
    if (
      !host ||
      !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(host)
    ) {
      send(response, 403, {
        code: "invalid-host",
        error: "Expected a loopback Host header.",
      });
      return;
    }
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) {
      send(response, 403, {
        error: "Origin is not allowed. Pass --origin to the feedback server.",
      });
      return;
    }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/comments") {
      send(
        response,
        200,
        await store.list(url.searchParams.get("status") ?? undefined),
      );
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/comments/")) {
      send(response, 200, await store.show(url.pathname.slice(10)));
      return;
    }
    const image = /^\/captures\/([^/]+)\/screenshot\.png$/.exec(url.pathname);
    if (request.method === "GET" && image?.[1]) {
      const bytes = await store.image(image[1]);
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      });
      response.end(bytes);
      return;
    }
    const transition = /^\/comments\/([^/]+)\/transitions$/.exec(url.pathname);
    if (
      request.method === "POST" &&
      (url.pathname === "/comments" || transition)
    ) {
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        send(response, 415, { error: "Expected application/json." });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 24 * 1024 * 1024) {
          send(response, 413, { error: "Capture exceeds 24 MiB." });
          return;
        }
        chunks.push(bytes);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString());
      send(
        response,
        200,
        transition?.[1]
          ? await store.transition(transition[1], data)
          : await store.save(data),
      );
      return;
    }
    send(response, 404, { error: "Unknown feedback route." });
  }
  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as NodeJS.ErrnoException).code;
      const status =
        error instanceof FeedbackError
          ? { invalid: 400, conflict: 409, stale: 409, "not-found": 404 }[
              error.code
            ]
          : code === "ENOENT"
            ? 404
            : error instanceof SyntaxError
              ? 400
              : 500;
      send(response, status, {
        error: message,
        code:
          error instanceof FeedbackError
            ? error.code
            : code === "ENOENT"
              ? "not-found"
              : status === 400
                ? "invalid"
                : "internal",
      });
    });
  });
  const release = acquireDirectoryLock(store.directory);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 5212, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    release();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Feedback server has no TCP address.");
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      closing ??= (async () => {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await store.idle();
        release();
      })();
      return closing;
    },
  };
}
