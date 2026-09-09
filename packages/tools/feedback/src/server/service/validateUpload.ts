import { canonicalJson } from "../../shared/canonicalJson.js";
import { validatePng } from "./validatePng.js";
import { FeedbackError } from "../../shared/errors.js";
import { copyJson, validId } from "../../shared/protocol.js";
import type { FeedbackUpload, Rect } from "../../shared/protocol.js";
export function requireId(id: string): void {
  if (typeof id !== "string" || !validId(id))
    throw new FeedbackError("invalid", "Invalid feedback ID.");
}
function rectValid(rect: Rect, width: number, height: number): boolean {
  return (
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width <= width + 0.01 &&
    rect.y + rect.height <= height + 0.01
  );
}
export function validateUpload(data: FeedbackUpload): Buffer {
  copyJson(data);
  const { capture, comment, image } = data;
  if ("revision" in comment || "history" in comment)
    throw new Error("Uploads cannot supply workflow history.");
  copyJson(capture.context);
  requireId(capture.id);
  requireId(capture.sessionId);
  requireId(comment.id);
  if (
    capture.version !== 1 ||
    comment.captureId !== capture.id ||
    comment.status !== "open"
  )
    throw new Error("Invalid feedback version or capture reference.");
  if (
    typeof comment.text !== "string" ||
    !comment.text.trim() ||
    comment.text.length > 10000
  )
    throw new Error("Feedback text must contain 1–10000 characters.");
  if (
    !Number.isSafeInteger(capture.frame) ||
    capture.frame < 0 ||
    !Number.isSafeInteger(capture.width) ||
    !Number.isSafeInteger(capture.height) ||
    capture.width <= 0 ||
    capture.height <= 0
  )
    throw new Error("Invalid capture frame or dimensions.");
  if (
    typeof capture.snapshot !== "object" ||
    capture.snapshot === null ||
    Array.isArray(capture.snapshot) ||
    capture.snapshot["frame"] !== capture.frame
  )
    throw new Error("Inspector snapshot frame does not match capture frame.");
  if (
    typeof capture.url !== "string" ||
    typeof capture.created !== "string" ||
    typeof comment.created !== "string" ||
    !Number.isFinite(Date.parse(capture.created)) ||
    !Number.isFinite(Date.parse(comment.created))
  )
    throw new Error("Invalid feedback URL or timestamp.");
  if (
    !Array.isArray(capture.entities) ||
    capture.entities.some(
      (entity) =>
        typeof entity.id !== "string" ||
        typeof entity.sceneId !== "string" ||
        typeof entity.name !== "string" ||
        !Number.isSafeInteger(entity.generation) ||
        entity.generation < 0 ||
        !rectValid(entity.bounds, capture.width, capture.height),
    )
  )
    throw new Error("Invalid capture entities.");
  const target = comment.target;
  if (target.kind === "area") {
    if (!rectValid(target.rect, capture.width, capture.height))
      throw new Error("Invalid feedback area.");
  } else if (target.kind === "entities") {
    if (
      !Array.isArray(target.entities) ||
      target.entities.length === 0 ||
      target.entities.some(
        (entity) =>
          !capture.entities.some(
            (candidate) => canonicalJson(candidate) === canonicalJson(entity),
          ),
      )
    )
      throw new Error("Invalid feedback entities.");
  } else if (target.kind !== "global")
    throw new Error("Invalid feedback target.");
  if (
    typeof image !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
  )
    throw new Error("Expected PNG data URL.");
  const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  validatePng(bytes, capture.width, capture.height);
  return bytes;
}
