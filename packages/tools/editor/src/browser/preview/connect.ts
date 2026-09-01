import type { LevelCatalog } from "@yagejs/level";
import type { PoseEdit } from "../../shared/commands/index.js";
import {
  posesOf,
  type EditorStore,
  type EditorViewState,
} from "../store/index.js";
import type { PreviewRequest } from "./PreviewCoordinator.js";

/** What connecting a preview to the store needs from it. */
export interface PreviewTarget {
  requestRebuild(request: PreviewRequest): void;
  applyPoseDraft(poses: readonly PoseEdit[]): void;
  applyView(view: EditorViewState): void;
}

/**
 * Keep the preview showing the document the editor is showing.
 *
 * A local command says what it needs through the reduction's impact: a
 * rebuild, a pose write for the affected placements, or nothing. Rebuilding on
 * a moved placement would destroy and recreate every entity on each committed
 * drag, which throws away asset references and blinks the viewport for a
 * result the scene already has — that is what the pose write is for.
 *
 * Everything else that changes the document arrives without a local command:
 * a history step, a rebase onto a newer draft, a dropped edit. The browser
 * holds neither the inverse the step replayed nor what the newer draft
 * changed, so it cannot prove a cheaper update is enough and rebuilds.
 *
 * A change to which placements exist rebuilds regardless of how it arrived —
 * opening a level, and any projection whose membership changes.
 *
 * A pending number a field is stepping is drawn by the controller and dropped
 * by a reduction, which has no preview to put anything back with. Whenever the
 * store stops holding one, the placement it named goes back on the document's
 * pose here.
 *
 * The view is carried the same way and independently of all of it: it is one
 * value in the state, so a new one is a new camera and nothing else. It moves
 * before the document work below, which needs no catalog and must not wait on
 * one.
 *
 * Returns the function that stops listening.
 */
export function connectPreview(
  store: EditorStore,
  catalogOf: () => LevelCatalog | undefined,
  preview: PreviewTarget,
): () => void {
  let shown: string | undefined;
  let viewed: EditorViewState | undefined;
  /** The placement whose pending number the preview is drawing, if any. */
  let drafted: string | undefined;
  return store.subscribe((state, action) => {
    if (state.view !== viewed) {
      viewed = state.view;
      preview.applyView(state.view);
    }
    const catalog = catalogOf();
    if (!catalog) return;
    const rebuild = (): void => {
      preview.requestRebuild({ document: state.document, catalog });
    };

    // The pending number went away without a command behind it: a selection
    // moving on, a level switch. Nothing else will repaint, so the placement
    // goes back on what the document says. A draft the controller takes for a
    // command comes through here too, and the command's own pose write lands
    // on top of it in the same call.
    const draftId = state.poseDraft?.id;
    if (draftId !== drafted) {
      const dropped = drafted;
      drafted = draftId;
      if (dropped !== undefined) {
        preview.applyPoseDraft(posesOf(state, [dropped]));
      }
    }

    const ids = state.document.entities.map((entity) => entity.id).join("\n");
    if (ids !== shown) {
      shown = ids;
      rebuild();
      return;
    }
    switch (action.type) {
      case "level-opened":
        // The same level opened again reads as the same id list; what its
        // placements hold may not be.
        rebuild();
        return;
      case "command-applied":
        if (action.impact === "rebuild") rebuild();
        else if (action.impact === "pose") {
          preview.applyPoseDraft(posesOf(state, action.affected));
        }
        return;
      case "command-rebased":
      case "command-dropped":
      case "history-stepped":
        rebuild();
        return;
      case "command-accepted":
        // The accepted document is what the server normalized, so its poses
        // are read back rather than trusted from the command. Not while a
        // drag or a stepped number is open: that pose is in the preview and in
        // the store, never in the document, so writing the document's poses
        // would drag the placement back out from under the pointer or undraw
        // what the last arrow press did.
        if (state.gesture === undefined && state.poseDraft === undefined) {
          preview.applyPoseDraft(
            posesOf(
              state,
              state.document.entities.map((entity) => entity.id),
            ),
          );
        }
        return;
      default:
        return;
    }
  });
}
