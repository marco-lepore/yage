import type { EngineContext, Plugin } from "@yagejs/core";
import type { Json } from "../shared/protocol.js";
import { FeedbackClient } from "../client/FeedbackClient.js";
import { FeedbackSession } from "./session/FeedbackSession.js";
import { RuntimeFeedbackHost } from "./runtime/RuntimeFeedbackHost.js";
import { FeedbackPanel } from "./ui/FeedbackPanel.js";

export interface FeedbackOptions {
  /** Use the same debug flag supplied to Engine. Disabled plugins mount no UI. */
  enabled: boolean;
  server?: string;
  /** F8 opens feedback; F9 toggles freeze. Disable for hosts that own shortcuts. */
  shortcuts?: boolean;
  context?: () => Json;
}
/** Composes the runtime adapter, session, transport, and DOM interface. */
export class FeedbackPlugin implements Plugin {
  readonly name = "feedback";
  readonly version = "0.0.0";
  readonly dependencies = ["renderer", "debug"] as const;
  private context: EngineContext | undefined;
  private panel: FeedbackPanel | undefined;
  private readonly client: FeedbackClient;
  constructor(private readonly options: FeedbackOptions) {
    this.client = new FeedbackClient(options.server);
  }
  install(context: EngineContext): void {
    this.context = context;
  }
  onStart(): void {
    if (!this.options.enabled || !this.context) return;
    const host = new RuntimeFeedbackHost(this.context, this.options.context);
    this.panel = new FeedbackPanel(
      new FeedbackSession(host, this.client),
      this.options.shortcuts ?? true,
    );
  }
  onDestroy(): void {
    this.panel?.destroy();
    this.panel = undefined;
  }
}
