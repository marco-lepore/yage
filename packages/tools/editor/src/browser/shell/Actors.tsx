import { useEffect, useState } from "react";
import type { PlaceableType } from "../project/index.js";
import { isEditable, type EditorStore } from "../store/index.js";
import { Panel, PanelEmpty } from "./Panel.js";
import { Button } from "./controls.js";
import {
  atlasFrame,
  atlasPathFor,
  declaredFrame,
  framePlacement,
  type ThumbnailFrame,
} from "./thumbnailFrame.js";
import { useEditorSlice } from "./useEditorSlice.js";

export interface ActorsProps {
  readonly store: EditorStore;
  /**
   * What can be placed, read on each render rather than passed as a value:
   * the shell mounts before the project's modules are evaluated, and the first
   * render after a level opens is the first one that can place anything.
   */
  readonly placeables: () => readonly PlaceableType[];
  /**
   * Every asset path the project has. It is what says whether an atlas sits
   * beside a type's texture, so a thumbnail can cut one frame out of a sheet
   * instead of drawing the whole strip. Empty until the listing arrives.
   */
  readonly assetPaths: readonly string[];
  readonly onPlace: (typeId: string) => void;
}

/**
 * What can be placed, one button each. A click puts the type in the middle of
 * the view and selects it, so the next thing the developer does is drag it.
 *
 * Each entry shows the default art of the type's first texture parameter, so
 * choosing what to place is looking rather than reading type ids.
 *
 * The project's own types come first and the packages' after, each package
 * under its name: a project with a tilemap and a renderer contributing types
 * otherwise lists them interleaved by whatever order the catalog was built in.
 *
 * It is the strip along the bottom of the viewport, and it starts closed: a
 * developer picks what to place at the start of a piece of work and then
 * spends the rest of it in the viewport, so the height belongs to the viewport
 * by default. Closed it is still a labelled header the Tab key reaches and
 * Enter opens. Nothing remembers whether it was open — reloading the page
 * closes it again. Open, the entries wrap into rows and the strip scrolls
 * down past a few of them, never sideways: a sideways scroll on a trackpad or
 * a touchscreen is the browser's back gesture.
 *
 * Whether a click can place anything is read from the store here, the same way
 * what it can place is read on each render: neither is handed down as a value.
 */
export function Actors(props: ActorsProps): React.JSX.Element {
  const editable = useEditorSlice(props.store, isEditable);
  const [open, setOpen] = useState(false);
  const types = props.placeables();
  const groups = groupBySource(types);

  return (
    <Panel
      title="Actors"
      testId="actors"
      className="ye-panel--strip"
      note={types.length === 0 ? undefined : String(types.length)}
      open={open}
      onToggle={() => {
        setOpen(!open);
      }}
    >
      {types.length === 0 ? (
        <PanelEmpty>Nothing to place</PanelEmpty>
      ) : (
        <div className="ye-actors">
          {groups.map((group) => (
            <div className="ye-actors__section" key={group.name}>
              <p className="ye-actors__group">{group.name}</p>
              {group.types.map((type) => (
                <Button
                  key={type.typeId}
                  className="ye-actors__item"
                  testId={`place-${type.typeId}`}
                  // The name is cut with an ellipsis when the type id is
                  // longer than the entry, and this is the only way to read
                  // the rest of it.
                  title={type.typeId}
                  disabled={!editable}
                  onClick={() => {
                    props.onPlace(type.typeId);
                  }}
                >
                  <Thumbnail type={type} assetPaths={props.assetPaths} />
                  <span className="ye-actors__name">{type.typeId}</span>
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * The picture beside a type's name: its first texture parameter's default,
 * fetched the way the running level fetches it — the authored path is the
 * address the browser asks for.
 *
 * Which part of that file shows has three answers, in order: the frame grid
 * the parameter declares, an atlas the project ships beside the image, and
 * otherwise the whole image fitted. A declared grid is measured against the
 * image the browser actually loaded, so it needs the natural size and the
 * atlas is never requested.
 *
 * A type that declares no texture, and one whose default file is not there,
 * both get the same empty frame. A default can name a file the project no
 * longer has, and a broken-image glyph in a list of things to place says
 * nothing a developer can act on.
 */
function Thumbnail({
  type,
  assetPaths,
}: {
  type: PlaceableType;
  assetPaths: readonly string[];
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [atlas, setAtlas] = useState<ThumbnailFrame | undefined>(undefined);
  const [natural, setNatural] = useState<
    { width: number; height: number } | undefined
  >(undefined);
  const path = type.thumbnail;
  const declared = type.thumbnailFrames;
  const atlasPath =
    path === undefined || declared !== undefined
      ? undefined
      : atlasPathFor(path);
  // Looked up in the listing rather than fetched to find out. A request per
  // placeable type that mostly answers 404 fills the console with failures
  // that are not failures — and nothing about an image's own proportions says
  // whether it is a strip of frames or one wide prop, so the listing is the
  // only thing worth asking.
  const hasAtlas = atlasPath !== undefined && assetPaths.includes(atlasPath);

  useEffect(() => {
    // A declared grid answers first, so no atlas is asked for.
    if (!hasAtlas || atlasPath === undefined) return;
    let live = true;
    void (async () => {
      try {
        const answer = await fetch(atlasPath);
        if (!answer.ok) return;
        const read = atlasFrame(await answer.json());
        // An atlas that cannot be read is not worth reporting: the whole image
        // still shows.
        if (live && read) setAtlas(read);
      } catch {
        // Same reason.
      }
    })();
    return () => {
      live = false;
    };
  }, [hasAtlas, atlasPath]);

  if (path === undefined || failed) {
    return (
      <span
        className="ye-actors__thumb ye-actors__thumb--none"
        data-testid={`thumb-${type.typeId}`}
        aria-hidden="true"
      />
    );
  }

  const frame =
    declared !== undefined && natural !== undefined
      ? declaredFrame(declared, natural.width, natural.height)
      : atlas;
  const placement =
    frame === undefined ? undefined : framePlacement(frame, THUMB_PIXELS);

  return (
    <span className="ye-actors__thumb" aria-hidden="true">
      <img
        className={
          placement === undefined
            ? "ye-actors__thumb-img"
            : "ye-actors__thumb-img ye-actors__thumb-img--framed"
        }
        data-testid={`thumb-${type.typeId}`}
        src={path}
        alt=""
        {...(placement === undefined
          ? {}
          : {
              style: {
                width: `${String(placement.width)}px`,
                height: `${String(placement.height)}px`,
                left: `${String(placement.left)}px`,
                top: `${String(placement.top)}px`,
              },
            })}
        onLoad={(event) => {
          const image = event.currentTarget;
          setNatural({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        }}
        onError={() => {
          setFailed(true);
        }}
      />
    </span>
  );
}

/** The side of a thumbnail, matching `.ye-actors__thumb` in the stylesheet. */
const THUMB_PIXELS = 24;

interface ActorGroup {
  readonly name: string;
  readonly types: PlaceableType[];
}

const PROJECT_GROUP = "This project";
/** A package that contributed a type without naming itself. */
const UNNAMED_GROUP = "Other packages";

/**
 * The project's own types first, then one group per package.
 *
 * Within a group the catalog's order is kept: it is the order the project
 * declared its entities in, and re-sorting it would hide that. Only the
 * project group is lifted, and only because it is the one a developer is
 * looking for.
 */
function groupBySource(types: readonly PlaceableType[]): readonly ActorGroup[] {
  const byName = new Map<string, PlaceableType[]>();
  for (const type of types) {
    const name =
      type.source === "project"
        ? PROJECT_GROUP
        : (type.packageName ?? UNNAMED_GROUP);
    const group = byName.get(name) ?? [];
    group.push(type);
    byName.set(name, group);
  }
  const project = byName.get(PROJECT_GROUP);
  byName.delete(PROJECT_GROUP);
  const packages = [...byName].map(([name, group]) => ({
    name,
    types: group,
  }));
  return project
    ? [{ name: PROJECT_GROUP, types: project }, ...packages]
    : packages;
}
