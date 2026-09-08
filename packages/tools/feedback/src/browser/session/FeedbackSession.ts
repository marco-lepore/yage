import type { FeedbackClient } from "../../client/FeedbackClient.js";
import type {
  FeedbackCapture,
  FeedbackComment,
  FeedbackTarget,
  FeedbackUpload,
} from "../../shared/protocol.js";

export interface FeedbackObservation {
  capture: FeedbackCapture;
  image: string;
}
export interface FeedbackHost {
  capture(): FeedbackObservation;
  release(): void;
  freeze(): void;
  toggleFreeze(): boolean;
}

/** Owns observation lifetime and retry identity independently of DOM rendering. */
export class FeedbackSession {
  private observation: FeedbackObservation | undefined;
  private abort: AbortController | undefined;
  private draft: FeedbackUpload | undefined;
  private readonly saved: FeedbackComment[] = [];
  constructor(
    private readonly host: FeedbackHost,
    private readonly client: FeedbackClient,
  ) {}
  get pending(): boolean {
    return this.draft !== undefined;
  }
  get draftComment(): FeedbackUpload["comment"] | undefined {
    return this.draft?.comment;
  }
  get comments(): readonly FeedbackComment[] {
    return this.saved;
  }
  open(): FeedbackObservation {
    if (this.observation) return this.observation;
    if (this.draft) {
      this.host.freeze();
      this.observation = {
        capture: this.draft.capture,
        image: this.draft.image,
      };
    } else this.observation = this.host.capture();
    return this.observation;
  }
  async save(text: string, target: FeedbackTarget): Promise<boolean> {
    if (!this.observation) throw new Error("Open feedback before saving.");
    if (this.abort) return false;
    if (!this.draft) {
      if (!text.trim() || text.trim().length > 10000)
        throw new Error("Write a comment of 1–10000 characters.");
      this.draft = {
        ...this.observation,
        comment: {
          id: crypto.randomUUID(),
          captureId: this.observation.capture.id,
          created: new Date().toISOString(),
          text: text.trim(),
          target: structuredClone(target),
          status: "open",
        },
      };
    }
    const abort = new AbortController();
    this.abort = abort;
    try {
      const detail = await this.client.save(this.draft, abort.signal);
      if (this.abort !== abort) return false;
      this.saved.push(detail.comment);
      this.draft = undefined;
      return true;
    } catch (error) {
      if (this.abort !== abort) return false;
      throw error;
    } finally {
      if (this.abort === abort) this.abort = undefined;
    }
  }
  discard(): void {
    if (this.abort)
      throw new Error("Wait for the current save before discarding.");
    this.draft = undefined;
  }
  toggleFreeze(): boolean {
    return this.host.toggleFreeze();
  }
  cancelSave(): void {
    this.abort?.abort();
    this.abort = undefined;
  }
  close(): void {
    this.cancelSave();
    this.observation = undefined;
    this.host.release();
  }
}
