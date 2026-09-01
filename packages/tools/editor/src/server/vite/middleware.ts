import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EDITOR_API_PREFIX,
  EDITOR_ROUTES,
  EDITOR_TOKEN_HEADER,
  parseCommandRequest,
  parseRevisionedRequest,
  parseSaveRequest,
  type EditorRoute,
  type EditorRouteResponses,
} from "../../shared/protocol/index.js";
import type { DraftService } from "../draft/index.js";
import type { LevelFileService } from "../files/index.js";

export interface EditorMiddlewareOptions {
  readonly draft: DraftService;
  /**
   * The asset listing, which is a file read and takes no draft queue step.
   * Narrowed to that one method: every write still goes through `draft`, the
   * owner of unsaved work.
   */
  readonly files: Pick<LevelFileService, "listAssets">;
  /** The per-process project token every request must carry. */
  readonly token: string;
  /** Request failures go here, without tokens or document contents. */
  readonly log?: ((message: string) => void) | undefined;
}

export type EditorMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/** Bodies larger than this are refused unread. */
const MAX_BODY_BYTES = 1024 * 1024;

/** The routes, from the one list both halves read. */
const ENDPOINTS = new Set<string>(EDITOR_ROUTES);

function isEditorRoute(value: string): value is EditorRoute {
  return ENDPOINTS.has(value);
}

/**
 * The editor's HTTP routes, mounted on the Vite dev server.
 *
 * A handler decides nothing: it checks the token and the origin, parses the
 * request, calls one service method, and writes what comes back. Every
 * outcome the service produces — accepted, stale, rejected — is a 200 carrying
 * a typed body, because each is a normal answer the browser acts on. The HTTP
 * status codes are kept for the transport failing: a request that is not
 * addressed to this process, a body that is not a request at all.
 */
export function createEditorMiddleware(
  options: EditorMiddlewareOptions,
): EditorMiddleware {
  const { draft, files, token } = options;

  return (req, res, next) => {
    const rawUrl = req.url ?? "/";
    if (!rawUrl.startsWith(EDITOR_API_PREFIX)) {
      next();
      return;
    }
    const url = new URL(rawUrl, "http://editor.invalid");
    const route = url.pathname.slice(EDITOR_API_PREFIX.length);

    void handle(req, res, url, route).catch((error: unknown) => {
      // The request has already failed; the connection must still be closed,
      // and the message must not carry the document or the token.
      options.log?.(`${req.method ?? "?"} ${route} failed: ${describe(error)}`);
      send(res, 500, {
        error: "The editor server failed to handle a request.",
      });
    });
  };

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    route: string,
  ): Promise<void> {
    if (req.headers[EDITOR_TOKEN_HEADER] !== token) {
      send(res, 401, { error: "Missing or stale editor project token." });
      return;
    }
    if (!isSameOrigin(req)) {
      send(res, 403, { error: "Cross-origin requests are refused." });
      return;
    }

    const endpoint = `${req.method ?? "GET"} ${route}`;
    if (!isEditorRoute(endpoint)) {
      send(res, 404, { error: `No editor route ${endpoint}.` });
      return;
    }
    if (endpoint === "GET /bootstrap") {
      const body: EditorRouteResponses["GET /bootstrap"] =
        await draft.bootstrap();
      send(res, 200, body);
      return;
    }
    // Above the path check below, because the listing is about the project
    // rather than about one level. Below it every request would answer 400.
    if (endpoint === "GET /assets") {
      const body: EditorRouteResponses["GET /assets"] =
        await files.listAssets();
      send(res, 200, body);
      return;
    }

    // Every level-scoped route names its level in the query, so one place
    // answers "which level is this request about".
    const path = url.searchParams.get("path");
    if (path === null || path === "") {
      send(res, 400, { error: "A level path is required." });
      return;
    }

    if (endpoint === "GET /draft") {
      const body: EditorRouteResponses["GET /draft"] =
        await draft.snapshot(path);
      send(res, 200, body);
      return;
    }
    const body = await readBody(req, res);
    if (body === undefined) return;
    switch (endpoint) {
      case "POST /draft/command": {
        const request = parseCommandRequest(body);
        if (!request) {
          send(res, 400, { error: "Not a valid draft command request." });
          return;
        }
        const answer: EditorRouteResponses["POST /draft/command"] =
          await draft.command(path, request);
        send(res, 200, answer);
        return;
      }
      case "POST /draft/undo":
      case "POST /draft/redo": {
        const request = parseRevisionedRequest(body);
        if (!request) {
          send(res, 400, { error: "Not a valid draft history request." });
          return;
        }
        if (endpoint === "POST /draft/undo") {
          const answer: EditorRouteResponses["POST /draft/undo"] =
            await draft.undo(path, request);
          send(res, 200, answer);
          return;
        }
        const answer: EditorRouteResponses["POST /draft/redo"] =
          await draft.redo(path, request);
        send(res, 200, answer);
        return;
      }
      case "POST /draft/save": {
        const request = parseSaveRequest(body);
        if (!request) {
          send(res, 400, { error: "Not a valid draft save request." });
          return;
        }
        const answer: EditorRouteResponses["POST /draft/save"] =
          await draft.save(path, request);
        send(res, 200, answer);
        return;
      }
      default: {
        // A route added to the list with no handler here would hang the
        // request; this is where that becomes a compile error instead.
        const unhandled: never = endpoint;
        send(res, 404, { error: `No editor route ${String(unhandled)}.` });
      }
    }
  }

  /**
   * The parsed JSON body, or `undefined` once this function has answered the
   * request itself — an oversized or unparseable body never reaches a route.
   */
  async function readBody(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        send(res, 413, { error: "The request body is too large." });
        return undefined;
      }
      chunks.push(buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      send(res, 400, { error: "The request body is not JSON." });
      return undefined;
    }
  }
}

/**
 * A browser sends `Origin` on every cross-origin request, so a request that
 * carries one from somewhere else is refused. A request with no `Origin` is
 * same-origin or not from a browser at all, and the token is what covers it.
 */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "") return true;
  const host = req.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
