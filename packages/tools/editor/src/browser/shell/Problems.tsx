import { useState } from "react";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";
import type { EditorStore } from "../store/index.js";
import { Panel } from "./Panel.js";
import { useEditorSlice } from "./useEditorSlice.js";

/**
 * Everything wrong with the level, from every source that reports, in one
 * list.
 *
 * It is the second band under the viewport, below the Actors strip and in the
 * same column: a finding arrives on its own schedule, often in the middle of a
 * drag, so its height comes off the viewport and leaves the hierarchy and the
 * inspector exactly as they were.
 *
 * The band appears with the first finding and leaves with the last, because
 * the count in its header is the only thing in the shell that says a finding
 * exists. The header collapses the list, which is what puts a long one away
 * without hiding that it is there. Nothing remembers the collapsed state —
 * reloading the page opens the band again.
 */
export function Problems({
  store,
}: {
  readonly store: EditorStore;
}): React.JSX.Element | null {
  const diagnostics = useEditorSlice(store, (state) => state.diagnostics);
  const [open, setOpen] = useState(true);
  const all: EditorDiagnostic[] = [...diagnostics.values()].flat();
  if (all.length === 0) return null;
  return (
    <div className="ye-problems">
      <Panel
        title="Problems"
        testId="problems"
        note={String(all.length)}
        open={open}
        onToggle={() => {
          setOpen((was) => !was);
        }}
      >
        <ul data-testid="diagnostics">
          {all.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${String(index)}`}>
              <code>{diagnostic.source}</code>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
