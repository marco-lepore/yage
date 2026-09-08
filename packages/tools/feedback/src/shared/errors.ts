export type FeedbackErrorCode = "invalid" | "conflict" | "stale" | "not-found";
export class FeedbackError extends Error {
  constructor(
    readonly code: FeedbackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FeedbackError";
  }
}
