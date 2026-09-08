import { EngineKey, ErrorBoundaryKey, ServiceKey } from "@yagejs/core";
import type { Engine, EngineContext, InspectorTimeLease } from "@yagejs/core";
import { captureView } from "./capture.js";
import type {
  FeedbackHost,
  FeedbackObservation,
} from "../session/FeedbackSession.js";
import { copyJson } from "../../shared/protocol.js";
import type { Json } from "../../shared/protocol.js";

// @yagejs/input owns this optional infrastructure contract and service ID.
const InputKey = new ServiceKey<{ clearAll(): void }>("inputManager");
export class RuntimeFeedbackHost implements FeedbackHost {
  private readonly engine: Engine;
  private lease: InspectorTimeLease | undefined;
  private wasFrozen = false;
  private readonly sessionId = crypto.randomUUID();
  constructor(
    private readonly context: EngineContext,
    private readonly metadata?: () => Json,
  ) {
    this.engine = context.resolve(EngineKey);
  }
  capture(): FeedbackObservation {
    if (this.engine.inspector.time.isOwned())
      throw new Error(
        "Pause the lab or other clock owner, then click here to leave feedback.",
      );
    let metadata: Json = {};
    const callback = this.metadata;
    if (callback)
      this.context.resolve(ErrorBoundaryKey).wrapCallback(
        () => {
          metadata = copyJson(callback());
        },
        { kind: "Feedback context" },
      );
    this.freeze();
    try {
      const observation = captureView(this.engine, this.sessionId, metadata);
      this.context.tryResolve(InputKey)?.clearAll();
      return observation;
    } catch (error) {
      this.release();
      throw error;
    }
  }
  freeze(): void {
    this.lease = this.engine.inspector.time.acquire();
    this.wasFrozen = this.lease.isFrozen();
    this.lease.freeze();
    this.context.tryResolve(InputKey)?.clearAll();
  }
  toggleFreeze(): boolean {
    const time = this.engine.inspector.time;
    if (time.isOwned())
      throw new Error(
        "Pause the current clock owner before changing freeze state.",
      );
    const lease = time.acquire();
    if (lease.isFrozen()) lease.thaw();
    else lease.freeze();
    const frozen = lease.isFrozen();
    this.context.tryResolve(InputKey)?.clearAll();
    lease.release();
    return frozen;
  }
  release(): void {
    if (!this.lease) return;
    this.context.tryResolve(InputKey)?.clearAll();
    if (!this.wasFrozen) this.lease.thaw();
    this.lease.release();
    this.lease = undefined;
  }
}
