import type { ErrorBoundary } from "@yagejs/core";
import { SequenceClip, SequencePlayer } from "@yagejs-addons/sequence";
import type { SequenceTargets } from "@yagejs-addons/sequence";
import type {
  SequenceDocument,
  SequenceValue,
  SequenceMarker,
} from "@yagejs-addons/sequence/document";
import type { EditorStore } from "../store/index.js";

/** The preview coordinator's marker traversal; callbacks never reach game code. */
export class SequencePreview {
  private player: SequencePlayer | undefined;
  private source: SequenceDocument | undefined;
  constructor(
    private readonly store: EditorStore,
    private readonly boundary: ErrorBoundary,
  ) {}
  stop(): void {
    this.player?.cancel("retain");
    this.player = undefined;
    this.source = undefined;
  }
  advance(dt: number): void {
    const state = this.store.getState(),
      doc = state.document,
      view = state.sequence;
    if (doc.format !== "yage-sequence-workspace" || !view) {
      this.stop();
      return;
    }
    if (!view.playing || state.gesture || state.poseDraft || view.draft) {
      this.stop();
      return;
    }
    if (this.source !== doc.sequence) {
      this.stop();
      this.source = doc.sequence;
      this.player = new SequencePlayer(this.boundary);
      let dispatchEvents =
        view.frame === 0 || view.frame >= doc.sequence.duration;
      const targets: SequenceTargets = Object.fromEntries(
        Object.entries(doc.sequence.targets).map(([id, contract]) => [
          id,
          {
            properties: Object.fromEntries(
              Object.entries(contract.properties).map(([name, definition]) => {
                let value: SequenceValue =
                  definition.kind === "boolean"
                    ? true
                    : definition.kind === "enum"
                      ? definition.values[0]!
                      : definition.kind === "vector" ||
                          definition.kind === "position"
                        ? { x: 0, y: 0 }
                        : 0;
                return [
                  name,
                  {
                    definition,
                    get: () => value,
                    set: (next: SequenceValue) => {
                      value = next;
                    },
                  },
                ];
              }),
            ),
            events: Object.fromEntries(
              Object.entries(contract.events).map(([name, payload]) => [
                name,
                {
                  payload,
                  dispatch: (_value: unknown, marker: SequenceMarker) => {
                    if (!dispatchEvents) return;
                    const events = this.store.getState().sequence?.events ?? [];
                    this.store.dispatch({
                      type: "sequence-view",
                      patch: { events: [...events, marker].slice(-100) },
                    });
                  },
                },
              ]),
            ),
          },
        ]),
      );
      this.player.play(new SequenceClip(doc.sequence), {
        targets,
        loop: view.loop,
        speed: view.speed,
        frame: { x: 0, y: 0, width: view.width, height: view.height },
        fit: view.fit,
      });
      if (view.frame > 0 && view.frame < doc.sequence.duration)
        this.player.seek(view.frame);
      dispatchEvents = true;
    }
    this.player!.advance(dt);
    this.store.dispatch({
      type: "sequence-view",
      patch: {
        frame: this.player!.frame,
        playing: this.player!.state === "playing",
      },
    });
  }
}
