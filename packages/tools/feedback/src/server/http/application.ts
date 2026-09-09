import type { IncomingMessage, ServerResponse } from "node:http";
import { FeedbackService } from "../service/FeedbackService.js";
import { acquireDirectoryLock } from "../files/DirectoryLock.js";
import { FeedbackError } from "../../shared/errors.js";
import { normalizeBasePath } from "../../shared/endpoint.js";
import type { FeedbackDetail } from "../../shared/protocol.js";
import { readGalleryScript } from "../files/GalleryAssets.js";
import galleryHtml from "../../gallery/gallery.html?raw";

export interface FeedbackApplicationOptions {
  directory: string;
  basePath?: string;
  galleryPath?: string;
  project?: string;
  origins?: string[];
}
export function createFeedbackApplication(
  options: FeedbackApplicationOptions,
): {
  handle(request: IncomingMessage, response: ServerResponse): void;
  close(): Promise<void>;
} {
  const basePath = normalizeBasePath(options.basePath ?? "/");
  const galleryPath = normalizeBasePath(
    options.galleryPath ?? basePath + "gallery/",
  );
  const store = new FeedbackService(options.directory);
  const release = acquireDirectoryLock(store.directory);
  const active = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
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
    const remote = request.socket.remoteAddress;
    if (!remote || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)) {
      send(response, 403, {
        error: "Feedback is only available on this machine.",
      });
      return;
    }
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
    if (closing) {
      send(response, 503, { error: "Feedback is shutting down." });
      return;
    }
    const origin = request.headers.origin;
    if (
      origin &&
      origin !== `http://${host}` &&
      !options.origins?.includes(origin)
    ) {
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
    if (
      request.method === "GET" &&
      (url.pathname === galleryPath.slice(0, -1) ||
        (url.pathname === basePath + "gallery/" &&
          galleryPath !== basePath + "gallery/"))
    ) {
      response.writeHead(302, { Location: galleryPath });
      response.end();
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === galleryPath + "gallery.js"
    ) {
      const script = await readGalleryScript();
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(script);
      return;
    }
    if (request.method === "GET" && url.pathname === galleryPath) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(galleryHtml.replace("FEEDBACK_API_PATH", basePath));
      return;
    }
    if (!url.pathname.startsWith(basePath)) {
      send(response, 404, { error: "Unknown feedback route." });
      return;
    }
    url.pathname = "/" + url.pathname.slice(basePath.length);
    if (request.method === "GET" && url.pathname === "/session") {
      send(response, 200, {
        directory: store.directory,
        project: options.project ?? process.cwd(),
        galleryPath,
      });
      return;
    }
    const detail = (value: FeedbackDetail): FeedbackDetail => ({
      ...value,
      screenshotUrl: basePath + value.screenshotUrl.replace(/^\//, ""),
    });
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
      send(response, 200, detail(await store.show(url.pathname.slice(10))));
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
        detail(
          transition?.[1]
            ? await store.transition(transition[1], data)
            : await store.save(data),
        ),
      );
      return;
    }
    send(response, 404, { error: "Unknown feedback route." });
  }
  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const operation = route(request, response).catch((error: unknown) => {
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
    active.add(operation);
    void operation.finally(() => active.delete(operation));
  };
  return {
    handle,
    close: () => {
      closing ??= (async () => {
        await Promise.all([...active]);
        await store.idle();
        release();
      })();
      return closing;
    },
  };
}
