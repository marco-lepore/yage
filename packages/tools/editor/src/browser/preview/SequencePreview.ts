import type { ErrorBoundary } from "@yagejs/core";
import { SequencePlayer } from "@yagejs-addons/sequence";
import type { SequenceTargets } from "@yagejs-addons/sequence";
import type {
  SequenceDocument,
  SequenceValue,
  SequenceMarker,
} from "@yagejs-addons/sequence/document";
import { defaultSequenceValue } from "../../shared/sequence/defaults.js";
import { sequenceClipOf } from "../store/index.js";
import type { EditorStore } from "../store/index.js";

/** The preview coordinator's marker traversal; callbacks never reach game code. */
export class SequencePreview {
  private player: SequencePlayer | undefined;
  private source: SequenceDocument | undefined;
  /** The cursor frame this preview last wrote to the view. */
  private frame: number | undefined;
  /** The view settings the current player started with. */
  private settings = "";
  constructor(
    private readonly store: EditorStore,
    private readonly boundary: ErrorBoundary,
  ) {}
  stop(): void {
    this.player?.cancel("retain");
    this.player = undefined;
    this.source = undefined;
    this.frame = undefined;
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
    const settings = JSON.stringify([
      view.loop,
      view.speed,
      view.width,
      view.height,
      view.fit,
    ]);
    // A cursor or setting changed outside this preview, even with no update
    // in between, starts a new player there.
    if (
      this.source !== doc.sequence ||
      view.frame !== this.frame ||
      settings !== this.settings
    ) {
      this.stop();
      this.source = doc.sequence;
      this.settings = settings;
      this.player = new SequencePlayer(this.boundary);
      let dispatchEvents =
        view.frame === 0 || view.frame >= doc.sequence.duration;
      const targets: SequenceTargets = Object.fromEntries(
        Object.entries(doc.sequence.targets).map(([id, contract]) => [
          id,
          {
            properties: Object.fromEntries(
              Object.entries(contract.properties).map(([name, definition]) => {
                let value = defaultSequenceValue(definition);
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
      this.player.play(sequenceClipOf(doc.sequence), {
        targets,
        loop: view.loop,
        speed: view.speed,
        rect: { x: 0, y: 0, width: view.width, height: view.height },
        fit: view.fit,
      });
      if (view.frame > 0 && view.frame < doc.sequence.duration)
        this.player.seek(view.frame);
      dispatchEvents = true;
    }
    this.player!.advance(dt);
    this.frame = this.player!.frame;
    this.store.dispatch({
      type: "sequence-view",
      patch: {
        frame: this.frame,
        playing: this.player!.state === "playing",
      },
    });
  }
}
