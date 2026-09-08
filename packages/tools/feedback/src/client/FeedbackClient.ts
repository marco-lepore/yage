import type {
  FeedbackComment,
  FeedbackDetail,
  FeedbackStatus,
  FeedbackTransition,
  FeedbackUpload,
} from "../shared/protocol.js";

/** Shared transport for the browser and CLI. Reading never acknowledges feedback. */
export class FeedbackClient {
  private readonly base: URL;
  constructor(
    server = "http://127.0.0.1:5212",
    private readonly timeoutMs = 30_000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 300_000
    )
      throw new Error(
        "Feedback request timeout must be an integer from 1 to 300000 ms.",
      );
    this.base = new URL(server);
    if (
      this.base.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname) ||
      this.base.username ||
      this.base.password
    )
      throw new Error(
        "Feedback server must be a loopback HTTP URL without credentials.",
      );
  }
  private async request<T>(
    route: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(new URL(route, this.base), {
      ...(body !== undefined
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok)
      throw new Error(
        `Feedback server returned ${response.status}: ${await response.text()}`,
      );
    return (await response.json()) as T;
  }
  list(status?: FeedbackStatus): Promise<FeedbackComment[]> {
    return this.request(`/comments${status ? `?status=${status}` : ""}`);
  }
  show(id: string): Promise<FeedbackDetail> {
    return this.request(`/comments/${encodeURIComponent(id)}`);
  }
  save(upload: FeedbackUpload, signal?: AbortSignal): Promise<FeedbackDetail> {
    return this.request("/comments", upload, signal);
  }
  transition(id: string, request: FeedbackTransition): Promise<FeedbackDetail> {
    return this.request(
      `/comments/${encodeURIComponent(id)}/transitions`,
      request,
    );
  }
}
