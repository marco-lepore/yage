import type {
  SequenceCurve,
  SequenceProperty,
  SequenceValue,
  Point,
} from "@yagejs-addons/sequence/document";
import { TextField } from "./controls.js";

/** Numeric edits share the editor's Enter/blur commit and Escape cancellation. */
export function SequenceNumber({
  label,
  value,
  onCommit,
  min,
  max,
  integer = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
}): React.JSX.Element {
  return (
    <TextField
      label={label}
      testId={`sequence-${label}`}
      value={String(value)}
      numeric
      onCommit={(s) => onCommit(Number(s))}
      reject={(s) => {
        const n = Number(s);
        if (!s.trim() || !Number.isFinite(n)) return "Enter a finite number";
        if (integer && !Number.isInteger(n)) return "Enter a whole frame";
        if (min !== undefined && n < min) return `Minimum: ${min}`;
        if (max !== undefined && n > max) return `Maximum: ${max}`;
        return undefined;
      }}
    />
  );
}
export function SequenceValueField({
  label,
  definition,
  value,
  onCommit,
}: {
  label: string;
  definition: SequenceProperty;
  value: SequenceValue;
  onCommit: (v: SequenceValue) => void;
}): React.JSX.Element {
  switch (definition.kind) {
    case "boolean":
      return (
        <label>
          {label}
          <input
            aria-label={label}
            type="checkbox"
            checked={value as boolean}
            onChange={(e) => onCommit(e.target.checked)}
          />
        </label>
      );
    case "enum":
      return (
        <label>
          {label}
          <select
            aria-label={label}
            value={value as string}
            onChange={(e) => onCommit(e.target.value)}
          >
            {definition.values.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      );
    case "position":
    case "vector": {
      const p = value as Point;
      return (
        <fieldset className="ye-sequence__fields">
          <legend>{label}</legend>
          {(["x", "y"] as const).map((axis) => (
            <SequenceNumber
              key={axis}
              label={`${label} ${axis.toUpperCase()}`}
              value={p[axis]}
              onCommit={(n) => onCommit({ ...p, [axis]: n })}
            />
          ))}
        </fieldset>
      );
    }
    case "color":
      return (
        <label>
          {label}
          <input
            aria-label={label}
            type="color"
            value={`#${(value as number).toString(16).padStart(6, "0")}`}
            onChange={(e) => onCommit(parseInt(e.target.value.slice(1), 16))}
          />
        </label>
      );
    default:
      return (
        <SequenceNumber
          label={label}
          value={value as number}
          onCommit={onCommit}
        />
      );
  }
}
export function SequenceBezier({
  curve,
  onCommit,
}: {
  curve: Extract<SequenceCurve, object>;
  onCommit: (curve: SequenceCurve) => void;
}): React.JSX.Element {
  const [x1, y1, x2, y2] = curve.bezier;
  return (
    <fieldset className="ye-sequence__fields">
      <legend>Bezier controls</legend>
      <svg
        viewBox="-30 -60 160 220"
        height="140"
        width="100%"
        role="img"
        aria-label="Bezier easing curve"
      >
        <path
          d="M0 100 H100 V0 H0 Z"
          fill="none"
          stroke="currentColor"
          opacity=".3"
        />
        <path
          d={`M0 100 L${x1 * 100} ${100 - y1 * 100} M100 0 L${x2 * 100} ${100 - y2 * 100}`}
          stroke="currentColor"
          opacity=".5"
        />
        <path
          d={`M0 100 C${x1 * 100} ${100 - y1 * 100} ${x2 * 100} ${100 - y2 * 100} 100 0`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
        />
      </svg>
      {curve.bezier.map((v, i) => (
        <SequenceNumber
          key={i}
          label={["Bezier X1", "Bezier Y1", "Bezier X2", "Bezier Y2"][i]!}
          value={v}
          {...(i % 2 === 0 ? { min: 0, max: 1 } : {})}
          onCommit={(n) => {
            const values = [...curve.bezier] as [
              number,
              number,
              number,
              number,
            ];
            values[i] = n;
            onCommit({ bezier: values });
          }}
        />
      ))}
    </fieldset>
  );
}
