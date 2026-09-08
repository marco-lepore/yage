import { FeedbackFiles } from "../files/FeedbackFiles.js";
import { requireId, validateUpload } from "./validateUpload.js";
import {
  parseTransition,
  transitionComment,
  isStatus,
} from "../../shared/workflow.js";
import { FeedbackError } from "../../shared/errors.js";
import { copyJson } from "../../shared/protocol.js";
import type {
  FeedbackDetail,
  FeedbackComment,
  FeedbackUpload,
} from "../../shared/protocol.js";

/** The only writer of feedback state. All checks and commits share one queue. */
export class FeedbackService {
  private readonly files: FeedbackFiles;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(directory: string) {
    this.files = new FeedbackFiles(directory);
  }
  async idle(): Promise<void> {
    await this.tail;
  }
  get directory(): string {
    return this.files.directory;
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  save(value: unknown): Promise<FeedbackDetail> {
    return this.run(async () => {
      // Copy before awaiting IO so callers cannot change a validated upload.
      let data: FeedbackUpload;
      let bytes: Buffer;
      try {
        data = copyJson(value) as unknown as FeedbackUpload;
        bytes = validateUpload(data);
      } catch (error) {
        throw new FeedbackError(
          "invalid",
          error instanceof Error ? error.message : String(error),
        );
      }
      return this.files.save(data, bytes);
    });
  }
  async list(status?: string): Promise<FeedbackComment[]> {
    if (status !== undefined && !isStatus(status))
      throw new FeedbackError("invalid", "Unknown feedback status.");
    const comments = await this.files.list();
    return status
      ? comments.filter((comment) => comment.status === status)
      : comments;
  }
  async show(id: string): Promise<FeedbackDetail> {
    requireId(id);
    return this.files.show(id);
  }
  async image(id: string): Promise<Buffer> {
    requireId(id);
    return this.files.image(id);
  }
  transition(id: string, value: unknown): Promise<FeedbackDetail> {
    return this.run(async () => {
      requireId(id);
      const request = parseTransition(value);
      const detail = await this.files.show(id);
      const comment = transitionComment(
        detail.comment,
        request,
        new Date().toISOString(),
      );
      if (comment !== detail.comment) await this.files.writeComment(comment);
      return { ...detail, comment };
    });
  }
}
