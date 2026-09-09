import { resolveShortcuts } from "../shared/shortcuts.js";
import type {
  FeedbackShortcuts,
  ResolvedFeedbackShortcuts,
} from "../shared/shortcuts.js";
import type { EngineContext, Plugin } from "@yagejs/core";
import type { Json } from "../shared/protocol.js";
import { FeedbackClient } from "../client/FeedbackClient.js";
import { FeedbackSession } from "./session/FeedbackSession.js";
import { RuntimeFeedbackHost } from "./runtime/RuntimeFeedbackHost.js";
import { FeedbackPanel } from "./ui/FeedbackPanel.js";

export interface FeedbackOptions {
  /** Use the same debug flag supplied to Engine. Disabled plugins mount no UI. */
  enabled: boolean;
  /** Full API base URL. Defaults to dev-server metadata, then localhost:5212. */
  server?: string;
  /** Defaults to F8/F9 for feedback/freeze and F10/Shift+F10 for stepping. Override individual bindings or pass false to disable all. */
  shortcuts?: boolean | FeedbackShortcuts;
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
  private readonly shortcuts: ResolvedFeedbackShortcuts;
  constructor(private readonly options: FeedbackOptions) {
    this.shortcuts = resolveShortcuts(options.shortcuts);
    const configured =
      typeof document === "undefined"
        ? undefined
        : document.querySelector<HTMLMetaElement>(
            'meta[name="yage-feedback-server"]',
          )?.content;
    this.client = new FeedbackClient(
      options.server ??
        (configured ? new URL(configured, location.href).href : undefined),
    );
  }
  install(context: EngineContext): void {
    this.context = context;
  }
  onStart(): void {
    if (!this.options.enabled || !this.context) return;
    const host = new RuntimeFeedbackHost(this.context, this.options.context);
    this.panel = new FeedbackPanel(
      new FeedbackSession(host, this.client),
      this.shortcuts,
      this.client.galleryUrl,
    );
  }
  onDestroy(): void {
    this.panel?.destroy();
    this.panel = undefined;
  }
}
