import { FeedbackError } from "./errors.js";
import { copyJson, validId } from "./protocol.js";
import type {
  AuthoredComment,
  FeedbackAction,
  FeedbackComment,
  FeedbackStatus,
  FeedbackTransition,
} from "./protocol.js";

const destinations: Record<FeedbackAction, FeedbackStatus> = {
  ingest: "ingested",
  address: "addressed",
  resolve: "resolved",
  reopen: "open",
};
const predecessors: Record<FeedbackAction, FeedbackStatus[]> = {
  ingest: ["open"],
  address: ["ingested"],
  resolve: ["addressed"],
  reopen: ["ingested", "addressed", "resolved"],
};
export function isStatus(value: unknown): value is FeedbackStatus {
  return ["open", "ingested", "addressed", "resolved"].includes(String(value));
}
export function isAction(value: unknown): value is FeedbackAction {
  return typeof value === "string" && Object.hasOwn(destinations, value);
}
export function parseTransition(value: unknown): FeedbackTransition {
  const data = copyJson(value);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.requestId !== "string" ||
    !validId(data.requestId) ||
    typeof data.expectedRevision !== "number" ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 0 ||
    !isAction(data.action) ||
    typeof data.actor !== "string" ||
    !data.actor.trim() ||
    data.actor.length > 200 ||
    (data.note !== undefined &&
      (typeof data.note !== "string" || data.note.length > 10000))
  ) {
    throw new FeedbackError(
      "invalid",
      "Expected a request UUID, nonnegative revision, action, actor (1–200 characters), and optional note (up to 10000 characters).",
    );
  }
  return {
    requestId: data.requestId,
    expectedRevision: data.expectedRevision,
    action: data.action,
    actor: data.actor,
    ...(typeof data.note === "string" ? { note: data.note } : {}),
  };
}
export function authoredComment(comment: FeedbackComment): AuthoredComment {
  return {
    id: comment.id,
    captureId: comment.captureId,
    text: comment.text,
    created: comment.created,
    target: comment.target,
    status: "open",
  };
}

/** Legacy observations acquire a workflow in memory without rewriting evidence. */
export function readComment(value: unknown): FeedbackComment {
  const data = copyJson(value);
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string" ||
    !validId(data.id) ||
    typeof data.captureId !== "string" ||
    !validId(data.captureId) ||
    typeof data.text !== "string" ||
    !data.text.trim() ||
    data.text.length > 10000 ||
    typeof data.created !== "string" ||
    !Number.isFinite(Date.parse(data.created)) ||
    !data.target ||
    typeof data.target !== "object" ||
    Array.isArray(data.target) ||
    !["global", "entities", "area"].includes(String(data.target.kind))
  ) {
    throw new FeedbackError("invalid", "Invalid stored feedback comment.");
  }
  // Target geometry is checked against its capture when the upload is accepted.
  const authored = data as unknown as AuthoredComment;
  let comment: FeedbackComment = {
    ...authoredComment({ ...authored, revision: 0, history: [] }),
    status: "open",
    revision: 0,
    history: [],
  };
  if (
    data.revision === undefined &&
    data.history === undefined &&
    data.status === "open"
  )
    return comment;
  if (!Array.isArray(data.history))
    throw new FeedbackError("invalid", "Invalid feedback history.");
  for (const value of data.history) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.created !== "string" ||
      !Number.isFinite(Date.parse(value.created))
    )
      throw new FeedbackError("invalid", "Invalid feedback history entry.");
    const request = parseTransition(value);
    const previous = comment;
    comment = transitionComment(comment, request, value.created);
    if (
      comment === previous ||
      value.revision !== comment.revision ||
      value.from !== previous.status ||
      value.to !== comment.status
    )
      throw new FeedbackError("invalid", "Invalid feedback history sequence.");
  }
  if (data.status !== comment.status || data.revision !== comment.revision)
    throw new FeedbackError(
      "invalid",
      "Feedback status and revision must match history.",
    );
  return comment;
}

/** The caller supplies time. Replays never create a second history entry. */
export function transitionComment(
  comment: FeedbackComment,
  request: FeedbackTransition,
  created: string,
): FeedbackComment {
  const prior = comment.history.find(
    (entry) => entry.requestId === request.requestId,
  );
  if (prior) {
    if (
      prior.expectedRevision !== request.expectedRevision ||
      prior.action !== request.action ||
      prior.actor !== request.actor ||
      prior.note !== request.note
    )
      throw new FeedbackError(
        "conflict",
        "Request ID conflict: retry the original command unchanged.",
      );
    return comment;
  }
  if (request.expectedRevision !== comment.revision)
    throw new FeedbackError(
      "stale",
      `Expected revision ${request.expectedRevision}, current revision is ${comment.revision}. Read the comment again.`,
    );
  if (!predecessors[request.action].includes(comment.status))
    throw new FeedbackError(
      "conflict",
      `Cannot ${request.action} feedback with status ${comment.status}.`,
    );
  const status = destinations[request.action];
  const revision = comment.revision + 1;
  return {
    ...comment,
    status,
    revision,
    history: [
      ...comment.history,
      { ...request, created, revision, from: comment.status, to: status },
    ],
  };
}
