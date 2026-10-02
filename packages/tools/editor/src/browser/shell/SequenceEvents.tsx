import type {
  SequenceDocument,
  SequenceMarker,
} from "@yagejs-addons/sequence/document";
import { useState } from "react";
import { markerPayload } from "../../shared/sequence/authoring.js";
import { SequenceNumber, SequenceValueField } from "./SequenceFields.js";
import { Button } from "./controls.js";

export function SequenceEvents({
  clip,
  actor,
  frame,
  selected,
  onSelect,
  onChange,
  onDelete,
}: {
  clip: SequenceDocument;
  actor: string;
  frame: number;
  selected: string | undefined;
  onSelect: (id: string) => void;
  onChange: (marker: SequenceMarker) => void;
  onDelete: (id: string) => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState("");
  const names = Object.keys(clip.targets[actor]?.events ?? {}),
    event = names.includes(choice) ? choice : names[0];
  const marker = clip.events.find((e) => e.id === selected);
  return (
    <section aria-label="Event markers">
      <h4>Events for {actor}</h4>
      <label>
        Event type
        <select
          aria-label="Event type"
          value={event ?? ""}
          onChange={(e) => setChoice(e.target.value)}
        >
          {!event ? <option value="">No declared events</option> : null}
          {names.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <Button
        disabled={!event}
        onClick={() => {
          if (!event) return;
          const id = crypto.randomUUID();
          onChange({
            id,
            frame: Math.round(frame),
            target: actor,
            event,
            payload: markerPayload(clip, actor, event),
          });
          onSelect(id);
        }}
      >
        Add event at cursor
      </Button>
      {!event ? <p>Add an event in Actor contract first.</p> : null}
      {clip.events.map((e) => (
        <Button
          key={e.id}
          pressed={e.id === selected}
          onClick={() => onSelect(e.id)}
        >
          {e.frame}: {e.target}.{e.event}
        </Button>
      ))}
      {marker ? (
        <div className="ye-sequence__fields">
          <SequenceNumber
            label="Event frame"
            value={marker.frame}
            min={0}
            max={clip.duration}
            integer
            onCommit={(n) => onChange({ ...marker, frame: n })}
          />
          <label>
            Marker actor
            <select
              aria-label="Marker actor"
              value={marker.target}
              onChange={(e) => {
                const target = e.target.value,
                  name = Object.keys(clip.targets[target]!.events)[0];
                if (name)
                  onChange({
                    ...marker,
                    target,
                    event: name,
                    payload: markerPayload(clip, target, name),
                  });
              }}
            >
              {Object.entries(clip.targets)
                .filter(([, c]) => Object.keys(c.events).length)
                .map(([name]) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
          </label>
          <label>
            Marker event
            <select
              aria-label="Marker event"
              value={marker.event}
              onChange={(e) =>
                onChange({
                  ...marker,
                  event: e.target.value,
                  payload: markerPayload(clip, marker.target, e.target.value),
                })
              }
            >
              {Object.keys(clip.targets[marker.target]!.events).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          {Object.entries(
            clip.targets[marker.target]!.events[marker.event]!,
          ).map(([name, definition]) => (
            <SequenceValueField
              key={name}
              label={`Payload ${name}`}
              definition={definition}
              value={marker.payload[name]!}
              onCommit={(value) =>
                onChange({
                  ...marker,
                  payload: { ...marker.payload, [name]: value },
                })
              }
            />
          ))}
          <Button onClick={() => onDelete(marker.id)}>Delete event</Button>
        </div>
      ) : null}
    </section>
  );
}
