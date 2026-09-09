export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface FeedbackEntity {
  sceneId: string;
  id: string;
  generation: number;
  name: string;
  bounds: Rect;
}
export type FeedbackTarget =
  | { kind: "global" }
  | { kind: "entities"; entities: FeedbackEntity[] }
  | { kind: "area"; rect: Rect };
export interface FeedbackCapture {
  version: 1;
  id: string;
  sessionId: string;
  created: string;
  frame: number;
  url: string;
  width: number;
  height: number;
  context: Json;
  snapshot: Json;
  entities: FeedbackEntity[];
}
export interface AuthoredComment {
  id: string;
  captureId: string;
  text: string;
  created: string;
  target: FeedbackTarget;
  status: "open";
}
export type FeedbackStatus = "open" | "ingested" | "addressed" | "resolved";
export type FeedbackAction = "ingest" | "address" | "resolve" | "reopen";
export interface FeedbackTransition {
  requestId: string;
  expectedRevision: number;
  action: FeedbackAction;
  actor: string;
  note?: string;
}
export interface FeedbackHistoryEntry extends FeedbackTransition {
  revision: number;
  created: string;
  from: FeedbackStatus;
  to: FeedbackStatus;
}
export interface FeedbackComment extends Omit<AuthoredComment, "status"> {
  status: FeedbackStatus;
  revision: number;
  history: FeedbackHistoryEntry[];
}
export interface FeedbackUpload {
  capture: FeedbackCapture;
  image: string;
  comment: AuthoredComment;
}
export interface FeedbackDetail {
  comment: FeedbackComment;
  capture: FeedbackCapture;
  screenshotPath: string;
  screenshotUrl: string;
}

export const validId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

/** JSON metadata is copied at capture time; callbacks cannot mutate saved evidence. */
export function copyJson(value: unknown): Json {
  const seen = new Set<object>();
  function visit(item: unknown): Json {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || seen.has(item))
      throw new Error(
        "Feedback context must contain finite, acyclic JSON values.",
      );
    seen.add(item);
    let result: Json;
    if (Array.isArray(item)) result = item.map(visit);
    else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        throw new Error("Feedback context must contain plain JSON objects.");
      result = Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [key, visit(entry)]),
      );
    }
    seen.delete(item);
    return result;
  }
  return visit(value);
}
