import {
  EDITOR_API_PREFIX,
  EDITOR_TOKEN_HEADER,
  type AssetListing,
  type BootstrapResponse,
  type DraftCommandRequest,
  type DraftOutcome,
  type DraftSaveRequest,
  type EditorRouteResponses,
  type RevisionedRequest,
} from "../../shared/protocol/index.js";

export interface EditorApiClientOptions {
  /** The per-process project token, read from the page's meta tag. */
  readonly token: string;
  /** Defaults to the page's own `fetch`. Injected by tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The transport failed: the request never reached the editor server, or what
 * came back was not one of its answers. A refusal the server chose — stale,
 * rejected — is a returned value instead, because it is a normal answer the
 * editor acts on.
 */
export class EditorApiError extends Error {
  constructor(
    readonly route: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EditorApiError";
  }
}

/**
 * The only browser code that talks to the editor server.
 *
 * It attaches the token, encodes the request, and hands back the answer under
 * the type `EditorRouteResponses` gives that route — the same entry the server
 * annotates its response with, so the two halves cannot drift apart without a
 * compile error. It interprets no level document, retries nothing,
 * and decides nothing about what an outcome means — rebase and retry policy
 * belongs to the store and the coordinators, so the same stale response cannot
 * be handled two ways.
 */
export class EditorApiClient {
  private readonly token: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: EditorApiClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async bootstrap(): Promise<EditorRouteResponses["GET /bootstrap"]> {
    return await this.request<BootstrapResponse>("GET", "/bootstrap");
  }

  /**
   * Every project asset the picker may offer, read fresh. The picker pulls this
   * each time it opens, so a file added while the editor was running is listed
   * without the server having to announce it.
   */
  async listAssets(): Promise<EditorRouteResponses["GET /assets"]> {
    return await this.request<AssetListing>("GET", "/assets");
  }

  /**
   * Read one level's draft. Answers an outcome, not a document: a path with no
   * readable level is a refusal the editor reports, not a transport failure.
   */
  async fetchSnapshot(
    path: string,
  ): Promise<EditorRouteResponses["GET /draft"]> {
    return await this.request<DraftOutcome>("GET", "/draft", { path });
  }

  async sendCommand(
    path: string,
    request: DraftCommandRequest,
  ): Promise<EditorRouteResponses["POST /draft/command"]> {
    return await this.request<DraftOutcome>(
      "POST",
      "/draft/command",
      { path },
      request,
    );
  }

  /**
   * Replay the newest entry of a level's history backwards. The request names
   * the revision it applies to and carries nothing else: the server holds the
   * entry, so there is no command to send.
   */
  async undo(
    path: string,
    request: RevisionedRequest,
  ): Promise<EditorRouteResponses["POST /draft/undo"]> {
    return await this.request<DraftOutcome>(
      "POST",
      "/draft/undo",
      { path },
      request,
    );
  }

  /** Replay the newest undone entry forwards. */
  async redo(
    path: string,
    request: RevisionedRequest,
  ): Promise<EditorRouteResponses["POST /draft/redo"]> {
    return await this.request<DraftOutcome>(
      "POST",
      "/draft/redo",
      { path },
      request,
    );
  }

  async save(
    path: string,
    request: DraftSaveRequest,
  ): Promise<EditorRouteResponses["POST /draft/save"]> {
    return await this.request<DraftOutcome>(
      "POST",
      "/draft/save",
      { path },
      request,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    route: string,
    query: Record<string, string> = {},
    body?: unknown,
  ): Promise<T> {
    const search = new URLSearchParams(query).toString();
    const url = `${EDITOR_API_PREFIX}${route}${search === "" ? "" : `?${search}`}`;
    const headers: Record<string, string> = {
      [EDITOR_TOKEN_HEADER]: this.token,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new EditorApiError(route, `${route} could not be reached.`, {
        cause: error,
      });
    }

    if (!response.ok) {
      // The server answers a refusal with 200 and a typed body, so a status
      // here means the request itself was wrong or never handled.
      throw new EditorApiError(
        route,
        `${route} failed with status ${response.status}.`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new EditorApiError(route, `${route} did not answer JSON.`, {
        cause: error,
      });
    }
  }
}
