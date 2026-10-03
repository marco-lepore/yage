import { SequenceClip } from "@yagejs-addons/sequence";
import { removeSequenceKeys } from "../../shared/sequence/authoring.js";
import { formatEditorDocument } from "../../shared/document/index.js";
import {
  SequenceNumber,
  SequenceValueField,
  SequenceBezier,
} from "./SequenceFields.js";
import { EVENT_FLAG_SIZE, sequenceEventRows } from "./sequenceEventRows.js";
import { SequenceEvents } from "./SequenceEvents.js";
import { Button, TextField } from "./controls.js";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type {
  SequenceCurve,
  SequenceDocument,
  SequenceKey,
} from "@yagejs-addons/sequence/document";
import { reduceSequenceCommand } from "../../shared/sequence/commands.js";
import type { CommandController } from "../commands/index.js";
import type { EditorStore } from "../store/index.js";
import { openingView } from "../store/view.js";
import { useEditorState } from "./useEditorSlice.js";

interface Drag {
  kind: "keys" | "events";
  pointer: number;
  x: number;
  width: number;
  ids: string[];
  start: SequenceDocument;
  invalid: boolean;
  delta: number;
}
const CURVES = [
  "linear",
  "hold",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutCubic",
  "easeOutBack",
  "bezier",
];
export function SequencePanel({
  store,
  commands,
}: {
  store: EditorStore;
  commands: CommandController;
}): React.JSX.Element | null {
  const state = useEditorState(store),
    document = state.document,
    view = state.sequence;
  const [selection, setSelection] = useState<string[]>([]),
    [error, setError] = useState("");
  const [height, setHeight] = useState(280);
  const [zoom, setZoom] = useState(1);
  const [eventSelection, setEventSelection] = useState<string>();
  const [dragLabel, setDragLabel] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [ghost, setGhost] = useState<
    { ids: string[]; delta: number } | undefined
  >();
  const drag = useRef<Drag | undefined>(undefined),
    scrubbing = useRef(false);
  const lane = useRef<HTMLDivElement>(null);
  const [laneWidth, setLaneWidth] = useState(0);
  useEffect(() => {
    const element = lane.current;
    if (!element) return;
    const resize = new ResizeObserver(() => setLaneWidth(element.clientWidth));
    resize.observe(element);
    return () => resize.disconnect();
  }, [document.format]);
  const cancel = () => {
    drag.current = undefined;
    scrubbing.current = false;
    setGhost(undefined);
    setDragLabel("");
    store.dispatch({
      type: "sequence-view",
      patch: { draft: undefined, draftBase: undefined },
    });
  };
  useEffect(() => {
    setSelection([]);
    setEventSelection(undefined);
    setError("");
    cancel();
  }, [state.file?.path]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
    };
  }, [store]);
  if (document.format !== "yage-sequence-workspace" || !view) return null;
  const clip = view.draft ?? document.sequence;
  const eventRows = sequenceEventRows(clip.events, clip.duration, laneWidth);
  const selectedIds = selection.filter((id) =>
    clip.tracks.some((t) => t.keys.some((k) => k.id === id)),
  );
  const selectedTrack = clip.tracks.find((t) =>
    t.keys.some((k) => selectedIds.includes(k.id)),
  );
  const selectedKey = selectedTrack?.keys.find((k) =>
    selectedIds.includes(k.id),
  );
  const edit = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const cursor = (e: PointerEvent) => {
    const rect = lane.current?.getBoundingClientRect();
    if (!rect) return;
    commands.seekSequence(
      Math.round(
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) *
          clip.duration,
      ),
    );
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (scrubbing.current) cursor(e);
      return;
    }
    if (e.pointerId !== d.pointer) return;
    if (JSON.stringify(document.sequence) !== JSON.stringify(d.start)) {
      cancel();
      setError("The sequence changed while dragging. Retry the edit.");
      return;
    }
    const keys = d.start.tracks
      .flatMap((t) => t.keys)
      .filter((k) => d.ids.includes(k.id));
    const delta = Math.round(((e.clientX - d.x) / d.width) * d.start.duration);
    d.delta = delta;
    const frames = (
      d.kind === "keys"
        ? keys
        : d.start.events.filter((e) => d.ids.includes(e.id))
    ).map((k) => k.frame + delta);
    setDragLabel(`Frame ${frames.join(", ")}`);
    try {
      if (d.kind === "keys" && keys.some((k) => k.frame === 0) && delta !== 0)
        throw new Error("Frame-zero keys stay at frame zero");
      const next = reduceSequenceCommand(d.start, {
        kind: d.kind === "keys" ? "move-keys" : "move-events",
        ids: d.ids,
        delta,
      });
      d.invalid = false;
      setGhost(undefined);
      setError("");
      store.dispatch({
        type: "sequence-view",
        patch: { draft: next, draftBase: d.start, playing: false },
      });
    } catch (err) {
      d.invalid = true;
      store.dispatch({
        type: "sequence-view",
        patch: { draft: undefined, draftBase: undefined },
      });
      setGhost({ ids: d.ids, delta });
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const end = (e: PointerEvent) => {
    if (drag.current?.invalid) cancel();
    else {
      drag.current = undefined;
      setDragLabel("");
      scrubbing.current = false;
      setGhost(undefined);
      void commands.settleEdits();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const editKey = (next: SequenceKey) => {
    if (selectedTrack)
      edit(() =>
        commands.editSequence({
          kind: "set-key",
          track: selectedTrack.id,
          key: next,
        }),
      );
  };
  const playback = () => {
    const path = store.getState().file?.path;
    void commands
      .settleEdits()
      .then(() => {
        const current = store.getState();
        if (current.file?.path !== path || !current.sequence) return;
        store.dispatch({
          type: "sequence-view",
          patch: { playing: !current.sequence.playing },
        });
      })
      .catch((e: unknown) => setError(String(e)));
  };
  const removeKeys = () =>
    edit(() =>
      commands.editSequence({
        kind: "replace",
        document: removeSequenceKeys(clip, selectedIds),
      }),
    );
  const download = async (workspace: boolean) => {
    try {
      const doc = await commands.exportSequence();
      const text = workspace
        ? formatEditorDocument(doc)
        : JSON.stringify(doc.sequence, null, 2) + "\n";
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${doc.sequence.name.replace(/[^a-z0-9_-]/gi, "-") || "sequence"}.${workspace ? "yage-sequence-workspace" : "yage-sequence"}.json`;
      window.document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  };
  const actor =
    Object.entries(document.bindings).find(([, id]) =>
      state.selection.has(id),
    )?.[0] ?? Object.keys(clip.targets)[0];
  return (
    <section
      className="ye-sequence"
      style={{ height }}
      data-testid="sequence-panel"
      aria-label="Sequence timeline"
      tabIndex={0}
      onKeyDown={(e) => {
        if (
          e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select")
        )
          return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          if (eventSelection)
            edit(() =>
              commands.editSequence({
                kind: "remove-event",
                id: eventSelection,
              }),
            );
          else if (selectedIds.length) removeKeys();
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          commands.seekSequence(
            view.frame +
              (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1),
          );
        }
        if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          e.stopPropagation();
          playback();
        }
      }}
    >
      <div
        className="ye-sequence__divider"
        role="separator"
        aria-label="Resize timeline"
        aria-orientation="horizontal"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") setHeight((h) => Math.min(600, h + 20));
          if (e.key === "ArrowDown") setHeight((h) => Math.max(150, h - 20));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            setHeight(
              Math.max(
                150,
                Math.min(
                  window.innerHeight * 0.65,
                  window.innerHeight - e.clientY,
                ),
              ),
            );
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      />
      <div className="ye-bar">
        <strong>Sequence</strong>
        <button
          onClick={() =>
            store.dispatch({
              type: "view-changed",
              view: {
                ...openingView(
                  state.viewport
                    ? { ...state.viewport, design: view }
                    : undefined,
                ),
                center: { x: view.width / 2, y: view.height / 2 },
              },
            })
          }
        >
          Fit frame
        </button>
        <Button
          ariaLabel="Previous frame"
          onClick={() => commands.seekSequence(view.frame - 1)}
        >
          ◀
        </Button>
        <Button
          ariaLabel="Next frame"
          onClick={() => commands.seekSequence(view.frame + 1)}
        >
          ▶
        </Button>
        <Button onClick={playback} testId="sequence-play">
          {view.playing ? "Pause" : "Play"}
        </Button>
        <button onClick={() => commands.seekSequence(0)}>Stop</button>
        <label>
          Frame{" "}
          <input
            aria-label="Cursor frame"
            type="number"
            min={0}
            max={clip.duration}
            value={view.frame.toFixed(1)}
            onChange={(e) => commands.seekSequence(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={view.loop}
            onChange={(e) =>
              store.dispatch({
                type: "sequence-view",
                patch: { loop: e.target.checked, playing: false },
              })
            }
          />
          Loop
        </label>
        <span>
          {clip.duration} frames · {clip.fps} fps
        </span>
        <label>
          Zoom
          <select
            aria-label="Timeline zoom"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        {dragLabel ? (
          <output role="status" data-testid="sequence-drag-frame">
            {dragLabel}
          </output>
        ) : null}
        <details>
          <summary>Files</summary>
          <div className="ye-sequence__settings">
            <label>
              Import clip
              <input
                aria-label="Import sequence clip"
                type="file"
                accept=".json"
                disabled={fileBusy || !store.writable}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setFileBusy(true);
                  void commands
                    .importSequence(() => file.text())
                    .then(() => {
                      setSelection([]);
                      setEventSelection(undefined);
                      setError("");
                    })
                    .catch((error: unknown) => setError(String(error)))
                    .finally(() => setFileBusy(false));
                }}
              />
            </label>
            <p>
              Imports runtime animation data. Matching slots keep their
              previews; missing slots can be assigned a preview in the actor
              panel. A workspace file supplies its nested clip.
            </p>
            <Button onClick={() => void download(false)}>
              Export runtime clip
            </Button>
            <Button onClick={() => void download(true)}>
              Export workspace
            </Button>
          </div>
        </details>
        <details>
          <summary>Settings</summary>
          <div className="ye-sequence__settings">
            <TextField
              label="Sequence name"
              testId="sequence-name"
              value={clip.name}
              onCommit={(name) =>
                edit(() =>
                  commands.editSequence({
                    kind: "set-settings",
                    settings: { name },
                  }),
                )
              }
            />
            {(["duration", "fps"] as const).map((field) => (
              <label key={field}>
                {field}
                <input
                  aria-label={field}
                  type="number"
                  defaultValue={clip[field]}
                  key={`${field}:${clip[field]}`}
                  onBlur={(e) =>
                    edit(() =>
                      commands.editSequence({
                        kind: "set-settings",
                        settings: { [field]: Number(e.target.value) },
                      }),
                    )
                  }
                />
              </label>
            ))}
            {(["width", "height"] as const).map((dimension) => (
              <label key={dimension}>
                Authored {dimension}
                <input
                  aria-label={`Authored ${dimension}`}
                  type="number"
                  defaultValue={clip.frame[dimension]}
                  key={clip.frame[dimension]}
                  onBlur={(e) =>
                    edit(() =>
                      commands.editSequence({
                        kind: "set-settings",
                        settings: {
                          frame: {
                            ...clip.frame,
                            [dimension]: Number(e.target.value),
                          },
                        },
                      }),
                    )
                  }
                />
              </label>
            ))}
            <label>
              Preview width
              <input
                type="number"
                aria-label="Preview width"
                value={view.width}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0)
                    store.dispatch({
                      type: "sequence-view",
                      patch: { width: n, playing: false },
                    });
                }}
              />
            </label>
            <label>
              Preview height
              <input
                type="number"
                aria-label="Preview height"
                value={view.height}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0)
                    store.dispatch({
                      type: "sequence-view",
                      patch: { height: n, playing: false },
                    });
                }}
              />
            </label>
            <select
              aria-label="Frame fit"
              value={view.fit}
              onChange={(e) =>
                store.dispatch({
                  type: "sequence-view",
                  patch: {
                    fit: e.target.value as "stretch" | "contain",
                    playing: false,
                  },
                })
              }
            >
              <option>stretch</option>
              <option>contain</option>
            </select>
            <label>
              Speed
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={view.speed}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0)
                    store.dispatch({
                      type: "sequence-view",
                      patch: { speed: n, playing: false },
                    });
                }}
              />
            </label>
            <JsonField
              label="Runtime clip JSON"
              value={document.sequence}
              onCommit={(value) =>
                edit(() =>
                  commands.editSequence({ kind: "replace", document: value }),
                )
              }
            />
          </div>
        </details>
      </div>
      <div className="ye-sequence__content">
        <div
          className="ye-sequence__tracks"
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={cancel}
          onLostPointerCapture={() => {
            if (drag.current || scrubbing.current) cancel();
          }}
        >
          <div className="ye-sequence__row" style={{ width: `${zoom * 100}%` }}>
            <span>Actor / property</span>
            <div
              ref={lane}
              className="ye-sequence__lane"
              data-testid="sequence-ruler"
              onPointerDown={(e) => {
                scrubbing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                cursor(e);
              }}
            >
              {Array.from({ length: 7 }, (_, i) => (
                <small key={i} style={{ left: `${(i / 6) * 100}%` }}>
                  {Math.round((i / 6) * clip.duration)}
                </small>
              ))}
            </div>
          </div>
          {clip.tracks.map((track) => (
            <div
              className="ye-sequence__row"
              key={track.id}
              style={{ width: `${zoom * 100}%` }}
            >
              <button
                className="ye-sequence__label"
                onClick={() => {
                  const id = document.bindings[track.target];
                  if (id)
                    store.dispatch({ type: "selection-changed", ids: [id] });
                  setEventSelection(undefined);
                  setSelection(track.keys[0] ? [track.keys[0].id] : []);
                }}
              >
                {track.target} · {track.property}
              </button>
              <div
                className="ye-sequence__lane"
                data-track={track.id}
                onPointerDown={(e) => {
                  scrubbing.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  cursor(e);
                }}
              >
                <i
                  className="ye-sequence__cursor"
                  style={{ left: `${(view.frame / clip.duration) * 100}%` }}
                />
                {track.keys.map((key) => (
                  <button
                    key={key.id}
                    className={`ye-sequence__key ${selectedIds.includes(key.id) ? "selected" : ""}`}
                    data-key={key.id}
                    data-frame={key.frame}
                    aria-label={`${track.target} ${track.property} frame ${key.frame}`}
                    style={{ left: `${(key.frame / clip.duration) * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (store.getState().gesture || !store.writable) return;
                      const ids = e.shiftKey
                        ? [...new Set([...selectedIds, key.id])]
                        : selectedIds.includes(key.id)
                          ? selectedIds
                          : [key.id];
                      setSelection(ids);
                      setEventSelection(undefined);
                      e.currentTarget.focus();
                      const id = document.bindings[track.target];
                      if (id)
                        store.dispatch({
                          type: "selection-changed",
                          ids: [id],
                        });
                      store.dispatch({
                        type: "sequence-view",
                        patch: { playing: false },
                      });
                      drag.current = {
                        kind: "keys",
                        pointer: e.pointerId,
                        x: e.clientX,
                        width: lane.current?.clientWidth ?? 1,
                        ids,
                        start: document.sequence,
                        invalid: false,
                        delta: 0,
                      };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                  >
                    ◆
                  </button>
                ))}
                {ghost
                  ? track.keys
                      .filter((k) => ghost.ids.includes(k.id))
                      .map((k) => (
                        <i
                          key={k.id}
                          className="ye-sequence__ghost"
                          style={{
                            left: `${(((drag.current?.start.tracks.flatMap((t) => t.keys).find((o) => o.id === k.id)?.frame ?? k.frame) + ghost.delta) / clip.duration) * 100}%`,
                          }}
                        >
                          ◇
                        </i>
                      ))
                  : null}
              </div>
            </div>
          ))}
          <div className="ye-sequence__row" style={{ width: `${zoom * 100}%` }}>
            <span>Events</span>
            <div
              className="ye-sequence__lane"
              style={{ height: eventRows.count * EVENT_FLAG_SIZE }}
            >
              {clip.events.map((marker) => (
                <button
                  key={marker.id}
                  style={{
                    position: "absolute",
                    left: `${(marker.frame / clip.duration) * 100}%`,
                    top: eventRows.rows.get(marker.id)! * EVENT_FLAG_SIZE,
                    width: EVENT_FLAG_SIZE,
                    height: EVENT_FLAG_SIZE,
                    padding: 0,
                    transform: "translateX(-50%)",
                  }}
                  title={`${marker.target}.${marker.event} @ ${marker.frame}`}
                  aria-label={`${marker.target} ${marker.event} event frame ${marker.frame}`}
                  className={eventSelection === marker.id ? "selected" : ""}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (store.getState().gesture || !store.writable) return;
                    e.currentTarget.focus();
                    setSelection([]);
                    setEventSelection(marker.id);
                    store.dispatch({
                      type: "sequence-view",
                      patch: { playing: false },
                    });
                    drag.current = {
                      kind: "events",
                      pointer: e.pointerId,
                      x: e.clientX,
                      width: lane.current?.clientWidth ?? 1,
                      ids: [marker.id],
                      start: document.sequence,
                      invalid: false,
                      delta: 0,
                    };
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                >
                  ⚑
                </button>
              ))}
              {ghost && drag.current?.kind === "events"
                ? drag.current.start.events
                    .filter((e) => ghost.ids.includes(e.id))
                    .map((e) => (
                      <i
                        key={e.id}
                        className="ye-sequence__ghost"
                        style={{
                          left: `${((e.frame + ghost.delta) / clip.duration) * 100}%`,
                          top:
                            (eventRows.rows.get(e.id) ?? 0) * EVENT_FLAG_SIZE,
                        }}
                      >
                        ◇
                      </i>
                    ))
                : null}
            </div>
          </div>
        </div>
        <div className="ye-sequence__inspector">
          {actor ? (
            <label>
              Add property track
              <select
                aria-label="Add property track"
                value=""
                onChange={(e) => {
                  const property = e.target.value;
                  if (!property) return;
                  edit(() => commands.addSequenceTrack(actor, property));
                }}
              >
                <option value="">Choose property…</option>
                {Object.keys(clip.targets[actor]!.properties)
                  .filter(
                    (p) =>
                      !clip.tracks.some(
                        (t) => t.target === actor && t.property === p,
                      ),
                  )
                  .map((p) => (
                    <option key={p}>{p}</option>
                  ))}
              </select>
            </label>
          ) : null}
          {clip.tracks.length === 0 ? (
            <p>
              Add an actor, then choose a property track. Move, Rotate and Scale
              create keys at the cursor.
            </p>
          ) : null}
          {selectedKey && selectedTrack ? (
            <>
              <strong>
                {selectedTrack.target} · {selectedTrack.property}
              </strong>
              <SequenceNumber
                label="Key frame"
                value={selectedKey.frame}
                min={0}
                max={clip.duration}
                integer
                onCommit={(frame) => editKey({ ...selectedKey, frame })}
              />
              <SequenceValueField
                key={selectedKey.id}
                label="Key value"
                definition={
                  clip.targets[selectedTrack.target]!.properties[
                    selectedTrack.property
                  ]!
                }
                value={selectedKey.value}
                onCommit={(value) => editKey({ ...selectedKey, value })}
              />
              <label>
                Easing
                <select
                  aria-label="Key easing"
                  value={
                    typeof selectedKey.curve === "string"
                      ? selectedKey.curve
                      : "bezier"
                  }
                  onChange={(e) =>
                    editKey({
                      ...selectedKey,
                      curve:
                        e.target.value === "bezier"
                          ? { bezier: [0.25, 0.1, 0.25, 1] }
                          : (e.target.value as SequenceCurve),
                    })
                  }
                >
                  {(["boolean", "enum"].includes(
                    clip.targets[selectedTrack.target]!.properties[
                      selectedTrack.property
                    ]!.kind,
                  )
                    ? ["hold"]
                    : CURVES
                  ).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {typeof selectedKey.curve !== "string" ? (
                <SequenceBezier
                  curve={selectedKey.curve}
                  onCommit={(curve) => editKey({ ...selectedKey, curve })}
                />
              ) : null}
              {clip.targets[selectedTrack.target]?.properties[
                selectedTrack.property
              ]?.kind === "position" ? (
                <>
                  <label>
                    Position mode
                    <select
                      aria-label="Position mode"
                      value={selectedTrack.position?.mode ?? "proportional"}
                      onChange={(e) =>
                        edit(() =>
                          commands.setSequencePositionMode(
                            selectedTrack.id,
                            e.target.value as "proportional" | "anchored",
                          ),
                        )
                      }
                    >
                      <option>proportional</option>
                      <option>anchored</option>
                    </select>
                  </label>
                  {selectedTrack.position?.mode === "anchored" ? (
                    <SequenceValueField
                      definition={{ kind: "vector" }}
                      label="Anchor"
                      value={selectedTrack.position.anchor}
                      onCommit={(value) =>
                        edit(() =>
                          commands.editSequence({
                            kind: "set-track",
                            track: {
                              ...selectedTrack,
                              position: {
                                mode: "anchored",
                                anchor: value as { x: number; y: number },
                              },
                            },
                          }),
                        )
                      }
                    />
                  ) : null}
                </>
              ) : null}
              <button
                onClick={() => {
                  const frame = Math.round(view.frame),
                    prior = selectedTrack.keys.find((k) => k.frame === frame);
                  const sampler = new SequenceClip(clip);
                  const value = sampler
                    .sample(frame)
                    .find(
                      (s) =>
                        s.target === selectedTrack.target &&
                        s.property === selectedTrack.property,
                    )!.value;
                  editKey({
                    ...selectedKey,
                    id: prior?.id ?? crypto.randomUUID(),
                    frame,
                    value: selectedTrack.position
                      ? sampler.unmapPosition(
                          selectedTrack.id,
                          value as { x: number; y: number },
                        )
                      : value,
                  });
                }}
              >
                Add key at cursor
              </button>
              <button
                disabled={selectedKey.frame === 0}
                onClick={() =>
                  edit(() =>
                    commands.editSequence({
                      kind: "remove-key",
                      track: selectedTrack.id,
                      id: selectedKey.id,
                    }),
                  )
                }
              >
                Delete key
              </button>
              {selectedIds.length > 1 ? (
                <Button onClick={removeKeys}>
                  Delete {selectedIds.length} selected keys
                </Button>
              ) : null}
              <Button
                onClick={() =>
                  edit(() => {
                    commands.editSequence({
                      kind: "remove-track",
                      id: selectedTrack.id,
                    });
                    setSelection([]);
                  })
                }
              >
                Remove track
              </Button>
            </>
          ) : (
            <p>
              Select a key to edit its value and easing. Use the viewport tools
              to key an actor at the cursor.
            </p>
          )}
          {actor ? (
            <SequenceEvents
              clip={clip}
              actor={actor}
              frame={view.frame}
              selected={eventSelection}
              onSelect={(id) => {
                setEventSelection(id);
                setSelection([]);
              }}
              onChange={(event) =>
                edit(() => commands.editSequence({ kind: "set-event", event }))
              }
              onDelete={(id) =>
                edit(() => {
                  commands.editSequence({ kind: "remove-event", id });
                  setEventSelection(undefined);
                })
              }
            />
          ) : null}
          <details>
            <summary>Event log ({view.events.length})</summary>
            <Button
              onClick={() =>
                store.dispatch({ type: "sequence-view", patch: { events: [] } })
              }
            >
              Clear event log
            </Button>
            {view.events.map((e, i) => (
              <p key={i}>
                {e.frame}: {e.target}.{e.event} {JSON.stringify(e.payload)}
              </p>
            ))}
          </details>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
export function JsonField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: unknown;
  onCommit: (v: unknown) => void;
}): React.JSX.Element {
  const text = JSON.stringify(value),
    [draft, setDraft] = useState(text),
    [error, setError] = useState("");
  useEffect(() => setDraft(text), [text]);
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try {
            if (draft !== text) onCommit(JSON.parse(draft) as unknown);
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      {error ? <span role="alert">{error}</span> : null}
    </label>
  );
}
