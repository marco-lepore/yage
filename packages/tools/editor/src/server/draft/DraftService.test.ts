import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatLevel,
  type LevelDocument,
  type LevelPlacement,
  type LevelTransform,
} from "@yagejs/level/document";
import type { DocumentCommand } from "../../shared/commands/index.js";
import type { DraftOutcome } from "../../shared/protocol/index.js";
import {
  createLevelFileService,
  type LevelFileService,
} from "../files/index.js";
import { DraftService } from "./DraftService.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const LEVEL = "src/levels/forest.yage-level.json";
const OTHER = "src/levels/cave.yage-level.json";
const EPOCH = "epoch-1";

function pose(x: number, y: number, scaleX = 1): LevelTransform {
  return { position: { x, y }, rotation: 0, scale: { x: scaleX, y: 1 } };
}

function crate(id: string): LevelPlacement {
  return {
    id,
    type: "Crate",
    typeVersion: 1,
    active: true,
    transform: pose(0, 0),
    params: {},
    extensions: {},
  };
}

function document(id: string): LevelDocument {
  return {
    format: "yage-level",
    version: 1,
    id,
    metadata: {},
    extensions: {},
    entities: [crate("crate-1")],
  };
}

function move(commandId: string, x: number, scaleX = 1): DocumentCommand {
  return {
    kind: "set-poses",
    commandId,
    poses: [{ id: "crate-1", transform: pose(x, 0, scaleX) }],
  };
}

function add(commandId: string, id: string, index: number): DocumentCommand {
  return {
    kind: "add-placements",
    commandId,
    inserts: [{ placement: crate(id), index }],
  };
}

function remove(commandId: string, ...ids: string[]): DocumentCommand {
  return { kind: "remove-placements", commandId, ids };
}

/**
 * A placement as the wire can deliver one: only what the command check reads.
 * Everything else is the level format's rule, and the format supplies a
 * default for each field left out here.
 */
function sparse(id: string, fields: object = {}): LevelPlacement {
  return {
    id,
    type: "Crate",
    typeVersion: 1,
    ...fields,
  } as unknown as LevelPlacement;
}

function idsOf(outcome: DraftOutcome): readonly string[] {
  return snapshotOf(outcome).document.entities.map((placement) => placement.id);
}

interface Fixture {
  root: string;
  files: LevelFileService;
  draft: DraftService;
}

async function fixture(options?: {
  levels?: Record<string, string>;
}): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "yage-editor-draft-"));
  roots.push(root);
  await mkdir(path.join(root, "src/levels"), { recursive: true });
  const levels = options?.levels ?? {
    [LEVEL]: JSON.stringify(document("forest")),
    [OTHER]: JSON.stringify(document("cave")),
  };
  for (const [relative, text] of Object.entries(levels)) {
    await writeFile(path.join(root, relative), text);
  }
  const files = await createLevelFileService({
    root,
    levels: ["src/levels/**/*.yage-level.json"],
    assets: [],
  });
  return {
    root,
    files,
    draft: new DraftService({ files, projectId: "fixture", epoch: EPOCH }),
  };
}

function snapshotOf(outcome: DraftOutcome) {
  if (outcome.status === "rejected") {
    throw new Error(`rejected: ${outcome.code} ${outcome.message}`);
  }
  return outcome.snapshot;
}

describe("opening a level", () => {
  it("reads the draft from disk on the first request", async () => {
    const { draft } = await fixture();

    const snapshot = snapshotOf(await draft.snapshot(LEVEL));

    expect(snapshot.draftRevision).toBe(0);
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.document.id).toBe("forest");
    expect(snapshot.epoch).toBe(EPOCH);
  });

  it("rejects a path with no level file", async () => {
    const { draft } = await fixture();

    const outcome = await draft.snapshot("src/levels/nothing.yage-level.json");

    expect(outcome).toMatchObject({ status: "rejected", code: "missing-file" });
  });

  it("rejects a structurally invalid file and keeps no draft for it", async () => {
    const { draft } = await fixture({
      levels: { [LEVEL]: '{"format":"yage-level","version":1}' },
    });

    const first = await draft.snapshot(LEVEL);
    const second = await draft.snapshot(LEVEL);

    expect(first).toMatchObject({
      status: "rejected",
      code: "structurally-invalid",
    });
    expect(second).toMatchObject({ status: "rejected" });
  });
});

describe("the per-level queue", () => {
  it("accepts exactly one of two commands sent against one revision", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    const request = { epoch: EPOCH, expectedDraftRevision: 0 };

    const [first, second] = await Promise.all([
      draft.command(LEVEL, { ...request, command: move("a", 10) }),
      draft.command(LEVEL, { ...request, command: move("b", 20) }),
    ]);

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("stale");
    const snapshot = snapshotOf(await draft.snapshot(LEVEL));
    expect(snapshot.draftRevision).toBe(1);
    expect(snapshot.document.entities[0]?.transform.position.x).toBe(10);
  });

  it("hands the loser the current state, so it can rebase without a refetch", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: move("a", 10),
    });

    const stale = await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: move("b", 20),
    });

    expect(stale.status).toBe("stale");
    expect(snapshotOf(stale).draftRevision).toBe(1);
    expect(snapshotOf(stale).document.entities[0]?.transform.position.x).toBe(
      10,
    );
  });

  it("opens a level once when two requests reach it together", async () => {
    const { draft } = await fixture();

    // Neither request has opened the level yet, so both would read it from
    // disk. A second read that published its own state would drop the command
    // the first request had already accepted.
    const [commanded, snapshot] = await Promise.all([
      draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: move("a", 10),
      }),
      draft.snapshot(LEVEL),
    ]);

    expect(commanded.status).toBe("accepted");
    expect(snapshotOf(snapshot).draftRevision).toBe(1);
    expect(snapshotOf(await draft.snapshot(LEVEL)).draftRevision).toBe(1);
  });

  it("lets different levels advance independently", async () => {
    const { draft } = await fixture();
    await Promise.all([draft.snapshot(LEVEL), draft.snapshot(OTHER)]);

    const [forest, cave] = await Promise.all([
      draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: move("a", 10),
      }),
      draft.command(OTHER, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: move("b", 20),
      }),
    ]);

    expect(forest.status).toBe("accepted");
    expect(cave.status).toBe("accepted");
    expect(snapshotOf(forest).draftRevision).toBe(1);
    expect(snapshotOf(cave).draftRevision).toBe(1);
  });

  it("holds a command while a save is parked in its file write", async () => {
    const { root, files } = await fixture();
    let release = (): void => undefined;
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let parkedOnce = false;
    const slowFiles: LevelFileService = {
      ...files,
      async writeLevel(...args) {
        if (!parkedOnce) {
          parkedOnce = true;
          await parked;
        }
        return files.writeLevel(...args);
      },
    };
    const draft = new DraftService({
      files: slowFiles,
      projectId: "fixture",
      epoch: EPOCH,
    });
    const opened = snapshotOf(await draft.snapshot(LEVEL));

    const settled: string[] = [];
    const saving = draft
      .save(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        expectedDiskRevision: opened.diskRevision,
      })
      .then((outcome) => {
        settled.push("save");
        return outcome;
      });
    const commanding = draft
      .command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: move("a", 10),
      })
      .then((outcome) => {
        settled.push("command");
        return outcome;
      });
    release();
    const [saved, commanded] = await Promise.all([saving, commanding]);

    // The command waited for the parked write instead of overtaking it, so the
    // file holds the revision the save promoted and the command applies on top.
    expect(settled).toEqual(["save", "command"]);
    expect(saved.status).toBe("accepted");
    expect(commanded.status).toBe("accepted");
    expect(snapshotOf(commanded).draftRevision).toBe(1);
    const onDisk = await readFile(path.join(root, LEVEL), "utf8");
    expect(onDisk).not.toContain('"x": 10');
  });
});

describe("applying a command", () => {
  it("refuses an edit that would produce an invalid document", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);

    const outcome = await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      // A scale that is not a finite number is well-formed on the wire and not
      // a level the format allows, so nothing else would catch it before it
      // reached a file.
      command: move("a", 10, Number.NaN),
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "structurally-invalid",
    });
    const snapshot = snapshotOf(await draft.snapshot(LEVEL));
    expect(snapshot.draftRevision).toBe(0);
    expect(snapshot.dirty).toBe(false);
  });

  it("refuses a command for a placement that is not there", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);

    const outcome = await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: {
        kind: "set-poses",
        commandId: "a",
        poses: [{ id: "ghost", transform: pose(1, 1) }],
      },
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "invalid-command",
    });
  });

  it("refuses a value edit outside the structured inspector paths", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);

    const outcome = await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: {
        kind: "set-values",
        commandId: "a",
        edits: [
          {
            placementId: "crate-1",
            path: ["id"],
            expected: "crate-1",
            value: "renamed",
          },
        ],
      },
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "invalid-command",
    });
    expect(snapshotOf(await draft.snapshot(LEVEL))).toMatchObject({
      draftRevision: 0,
      history: { undoDepth: 0, redoDepth: 0 },
      document: { entities: [{ id: "crate-1" }] },
    });
  });

  it("saves a placement that named no activity as active", async () => {
    const { root, draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));

    const accepted = snapshotOf(
      await draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: {
          kind: "add-placements",
          commandId: "a",
          // Everything the writer needs except `active`, so nothing throws and
          // the only way to notice is the file. Committing the raw command
          // instead saves it dormant, because the writer reads an absent
          // `active` as false.
          inserts: [
            {
              placement: sparse("crate-2", {
                transform: pose(5, 5),
                params: {},
                extensions: {},
              }),
              index: 1,
            },
          ],
        },
      }),
    );
    await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 1,
      expectedDiskRevision: opened.diskRevision,
    });

    expect(accepted.document.entities[1]?.active).toBe(true);
    expect(await readFile(path.join(root, LEVEL), "utf8")).not.toContain(
      '"active": false',
    );
  });

  it("commits what the format read, not the object the command carried", async () => {
    const { root, draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));

    const accepted = snapshotOf(
      await draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: {
          kind: "add-placements",
          commandId: "a",
          inserts: [{ placement: sparse("crate-2"), index: 1 }],
        },
      }),
    );
    await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 1,
      expectedDiskRevision: opened.diskRevision,
    });

    // The structural check read this placement as active with an identity
    // transform. Committing the raw object instead would save it dormant,
    // because the writer reads an absent `active` as false.
    const added = accepted.document.entities[1];
    expect(added?.active).toBe(true);
    expect(added?.transform).toEqual(pose(0, 0));
    expect(added?.params).toEqual({});
    expect(await readFile(path.join(root, LEVEL), "utf8")).not.toContain(
      '"active": false',
    );
  });

  it("accepts a name and a key, and saves both", async () => {
    const { root, draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));

    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: {
        kind: "set-values",
        commandId: "a",
        edits: [
          {
            placementId: "crate-1",
            path: ["name"],
            expected: null,
            value: "Left crate",
          },
        ],
      },
    });
    const keyed = snapshotOf(
      await draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 1,
        command: {
          kind: "set-values",
          commandId: "b",
          edits: [
            {
              placementId: "crate-1",
              path: ["key"],
              expected: null,
              value: "door",
            },
          ],
        },
      }),
    );
    await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 2,
      expectedDiskRevision: opened.diskRevision,
    });

    expect(keyed.document.entities[0]).toMatchObject({
      name: "Left crate",
      key: "door",
    });
    const saved = await readFile(path.join(root, LEVEL), "utf8");
    expect(saved).toContain('"name": "Left crate"');
    expect(saved).toContain('"key": "door"');
  });

  it("takes a name back on undo, byte for byte", async () => {
    const { root, draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));

    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: {
        kind: "set-values",
        commandId: "a",
        edits: [
          {
            placementId: "crate-1",
            path: ["name"],
            expected: null,
            value: "Left crate",
          },
        ],
      },
    });
    const undone = snapshotOf(
      await draft.undo(LEVEL, { epoch: EPOCH, expectedDraftRevision: 1 }),
    );
    await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 2,
      expectedDiskRevision: opened.diskRevision,
    });

    expect(Object.hasOwn(undone.document.entities[0] ?? {}, "name")).toBe(
      false,
    );
    // The canonical bytes of the level as it was before the rename, which is
    // what the dirty indicator and a later save compare against.
    expect(await readFile(path.join(root, LEVEL), "utf8")).toBe(
      formatLevel(document("forest")),
    );
  });

  it("refuses a colliding key as a bad command, not a broken document", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: add("a", "crate-2", 1),
    });

    const outcome = await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 1,
      command: {
        kind: "set-values",
        commandId: "b",
        edits: [
          {
            placementId: "crate-2",
            path: ["key"],
            expected: null,
            value: "crate-1",
          },
        ],
      },
    });

    // The reducer owns the rule, so the developer is told which edit was
    // refused rather than that the document is structurally invalid.
    expect(outcome).toMatchObject({
      status: "rejected",
      code: "invalid-command",
    });
    expect(
      snapshotOf(await draft.snapshot(LEVEL)).document.entities[1]?.key,
    ).toBeUndefined();
  });

  it("marks the draft dirty once it differs from what was saved", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);

    const accepted = await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: move("a", 10),
    });

    expect(snapshotOf(accepted).dirty).toBe(true);
  });
});

describe("the undo history", () => {
  /** Every write names the revision it applies to; this is that request. */
  const at = (expectedDraftRevision: number) => ({
    epoch: EPOCH,
    expectedDraftRevision,
  });

  it("restores the document the edit applied to, at a new revision", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });

    const undone = snapshotOf(await draft.undo(LEVEL, at(1)));

    expect(undone.document.entities[0]?.transform.position.x).toBe(0);
    // Undo moves forward. Rewinding the revision instead would make one number
    // name two documents, and a save addresses a revision.
    expect(undone.draftRevision).toBe(2);
    expect(undone.history).toEqual({ undoDepth: 0, redoDepth: 1 });
  });

  it("undoes and redoes one atomic parameter and type-version reset", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    const command: DocumentCommand = {
      kind: "set-values",
      commandId: "values",
      edits: [
        {
          placementId: "crate-1",
          path: ["params"],
          expected: {},
          value: { asset: "textures/crate.png" },
        },
        {
          placementId: "crate-1",
          path: ["typeVersion"],
          expected: 1,
          value: 2,
        },
      ],
    };

    const applied = snapshotOf(
      await draft.command(LEVEL, { ...at(0), command }),
    );
    expect(applied.document.entities[0]).toMatchObject({
      params: { asset: "textures/crate.png" },
      typeVersion: 2,
    });

    const undone = snapshotOf(await draft.undo(LEVEL, at(1)));
    expect(undone.document.entities[0]).toMatchObject({
      params: {},
      typeVersion: 1,
    });
    expect(undone.history).toEqual({ undoDepth: 0, redoDepth: 1 });

    const redone = snapshotOf(await draft.redo(LEVEL, at(2)));
    expect(redone.document.entities[0]).toMatchObject({
      params: { asset: "textures/crate.png" },
      typeVersion: 2,
    });
    expect(redone.history).toEqual({ undoDepth: 1, redoDepth: 0 });
  });

  it("re-applies an undone edit", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });
    await draft.undo(LEVEL, at(1));

    const redone = snapshotOf(await draft.redo(LEVEL, at(2)));

    expect(redone.document.entities[0]?.transform.position.x).toBe(10);
    expect(redone.draftRevision).toBe(3);
    expect(redone.history).toEqual({ undoDepth: 1, redoDepth: 0 });
  });

  it("restores a removed placement where it was, not at the end", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: add("a", "crate-2", 0) });
    await draft.command(LEVEL, { ...at(1), command: remove("b", "crate-2") });

    const undone = await draft.undo(LEVEL, at(2));

    // Authored order is part of the file, so a restore that appended would
    // give back the same placements in a different document.
    expect(idsOf(undone)).toEqual(["crate-2", "crate-1"]);
  });

  it("takes back a placement it created", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: add("a", "crate-2", 1) });

    const undone = await draft.undo(LEVEL, at(1));

    expect(idsOf(undone)).toEqual(["crate-1"]);
  });

  it("discards what was undone once a new edit is accepted", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });
    await draft.undo(LEVEL, at(1));

    const branched = snapshotOf(
      await draft.command(LEVEL, { ...at(2), command: move("b", 20) }),
    );
    const redone = snapshotOf(await draft.redo(LEVEL, at(3)));

    // The document the undone edit would redo onto is gone.
    expect(branched.history).toEqual({ undoDepth: 1, redoDepth: 0 });
    expect(redone.document.entities[0]?.transform.position.x).toBe(20);
    expect(redone.draftRevision).toBe(3);
  });

  it("answers an undo with nothing to undo with the current draft", async () => {
    const { draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));

    const outcome = await draft.undo(LEVEL, at(0));

    // Not an error: the summary already said the stack was empty, and a
    // control that asks anyway learns the same thing.
    expect(outcome.status).toBe("accepted");
    expect(snapshotOf(outcome).draftRevision).toBe(opened.draftRevision);
    expect(snapshotOf(outcome).history).toEqual({
      undoDepth: 0,
      redoDepth: 0,
    });
  });

  it("replays two undone edits in the order they were undone", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });
    await draft.command(LEVEL, { ...at(1), command: move("b", 20) });
    await draft.undo(LEVEL, at(2));
    await draft.undo(LEVEL, at(3));

    const first = snapshotOf(await draft.redo(LEVEL, at(4)));
    const second = snapshotOf(await draft.redo(LEVEL, at(5)));

    // Newest undone is redone last. One test with a single entry cannot tell
    // the two ends of the stack apart.
    expect(first.document.entities[0]?.transform.position.x).toBe(10);
    expect(second.document.entities[0]?.transform.position.x).toBe(20);
  });

  it("records nothing for an edit that changes nothing", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });

    // The same pose again: it applies, and it is not an edit.
    const repeated = snapshotOf(
      await draft.command(LEVEL, { ...at(1), command: move("b", 10) }),
    );
    const undone = snapshotOf(await draft.undo(LEVEL, at(1)));

    expect(repeated.draftRevision).toBe(1);
    expect(repeated.history).toEqual({ undoDepth: 1, redoDepth: 0 });
    // One undo reaches the real edit, rather than spending itself on a drag
    // that ended where it started.
    expect(undone.document.entities[0]?.transform.position.x).toBe(0);
  });

  it("drops the oldest edit past the bound", async () => {
    const { files } = await fixture();
    const draft = new DraftService({
      files,
      projectId: "fixture",
      epoch: EPOCH,
      historyEntries: 2,
    });
    await draft.snapshot(LEVEL);
    for (let revision = 0; revision < 3; revision++) {
      await draft.command(LEVEL, {
        ...at(revision),
        command: move(`c${revision}`, revision + 1),
      });
    }

    const first = snapshotOf(await draft.undo(LEVEL, at(3)));
    const second = snapshotOf(await draft.undo(LEVEL, at(4)));
    const third = snapshotOf(await draft.undo(LEVEL, at(5)));

    expect(first.document.entities[0]?.transform.position.x).toBe(2);
    expect(second.document.entities[0]?.transform.position.x).toBe(1);
    // The edit that took it to 1 is no longer held, so the third undo has
    // nothing to do and costs no revision.
    expect(third.document.entities[0]?.transform.position.x).toBe(1);
    expect(third.draftRevision).toBe(5);
    expect(third.history).toEqual({ undoDepth: 0, redoDepth: 2 });
  });

  it("keeps one history per level", async () => {
    const { draft } = await fixture();
    await Promise.all([draft.snapshot(LEVEL), draft.snapshot(OTHER)]);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });

    const other = snapshotOf(await draft.undo(OTHER, at(0)));

    expect(other.history).toEqual({ undoDepth: 0, redoDepth: 0 });
    expect(snapshotOf(await draft.snapshot(LEVEL)).history).toEqual({
      undoDepth: 1,
      redoDepth: 0,
    });
  });

  it("accepts exactly one of an undo and a command against one revision", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });

    const [commanded, undone] = await Promise.all([
      draft.command(LEVEL, { ...at(1), command: move("b", 20) }),
      draft.undo(LEVEL, at(1)),
    ]);

    // A history consulted outside the queue step would let both through.
    const statuses = [commanded.status, undone.status];
    expect(statuses.filter((status) => status === "accepted")).toHaveLength(1);
    expect(statuses.filter((status) => status === "stale")).toHaveLength(1);
  });

  it("keeps the entry an undo lost the race for", async () => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });
    await draft.command(LEVEL, { ...at(1), command: move("b", 20) });

    const stale = await draft.undo(LEVEL, at(1));
    const undone = snapshotOf(await draft.undo(LEVEL, at(2)));

    expect(stale.status).toBe("stale");
    expect(snapshotOf(stale).history).toEqual({ undoDepth: 2, redoDepth: 0 });
    expect(undone.document.entities[0]?.transform.position.x).toBe(10);
  });

  it("survives a save, and leaves the draft dirty again", async () => {
    const { draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));
    await draft.command(LEVEL, { ...at(0), command: move("a", 10) });
    const saved = snapshotOf(
      await draft.save(LEVEL, {
        ...at(1),
        expectedDiskRevision: opened.diskRevision,
      }),
    );

    const undone = snapshotOf(await draft.undo(LEVEL, at(1)));

    // A save promotes a revision; it is not an edit, so it neither records an
    // entry nor consumes one.
    expect(saved.history).toEqual({ undoDepth: 1, redoDepth: 0 });
    expect(saved.dirty).toBe(false);
    expect(undone.dirty).toBe(true);
    expect(undone.document.entities[0]?.transform.position.x).toBe(0);
  });
});

describe("saving", () => {
  it("promotes the exact revision asked for and leaves a newer draft dirty", async () => {
    const { root, draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));
    const first = snapshotOf(
      await draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 0,
        command: move("a", 10),
      }),
    );
    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 1,
      command: move("b", 20),
    });

    const saved = snapshotOf(
      await draft.save(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: first.draftRevision,
        expectedDiskRevision: opened.diskRevision,
      }),
    );

    expect(saved.draftRevision).toBe(2);
    expect(saved.dirty).toBe(true);
    const onDisk = await readFile(path.join(root, LEVEL), "utf8");
    expect(onDisk).toContain('"x": 10');
    expect(onDisk).not.toContain('"x": 20');
  });

  it("keeps the draft when the file could not be written", async () => {
    const { files } = await fixture();
    const draft = new DraftService({
      files: {
        ...files,
        writeLevel: () =>
          Promise.resolve({ ok: false, reason: "write-failed" }),
      },
      projectId: "fixture",
      epoch: EPOCH,
    });
    const opened = snapshotOf(await draft.snapshot(LEVEL));
    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: move("a", 10),
    });

    const outcome = await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 1,
      expectedDiskRevision: opened.diskRevision,
    });

    expect(outcome).toMatchObject({ status: "rejected", code: "write-failed" });
    // The edit is still the draft, and still unsaved: a save that failed must
    // not look like one that worked.
    const after = snapshotOf(await draft.snapshot(LEVEL));
    expect(after.draftRevision).toBe(1);
    expect(after.dirty).toBe(true);
    expect(after.diskRevision).toBe(opened.diskRevision);
  });

  it("leaves the draft clean when the saved revision is the current one", async () => {
    const { draft } = await fixture();
    const opened = snapshotOf(await draft.snapshot(LEVEL));
    await draft.command(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      command: move("a", 10),
    });

    const saved = snapshotOf(
      await draft.save(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: 1,
        expectedDiskRevision: opened.diskRevision,
      }),
    );

    expect(saved.dirty).toBe(false);
  });

  it("refuses a save whose disk revision is stale and leaves the file alone", async () => {
    const { root, draft } = await fixture();
    await draft.snapshot(LEVEL);
    const before = await readFile(path.join(root, LEVEL), "utf8");

    const outcome = await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      expectedDiskRevision: "someone-else-wrote-this",
    });

    expect(outcome).toMatchObject({ status: "rejected", code: "stale-disk" });
    expect(await readFile(path.join(root, LEVEL), "utf8")).toBe(before);
  });

  it("refuses a revision that is no longer retained", async () => {
    const { files, root } = await fixture();
    const draft = new DraftService({
      files,
      projectId: "fixture",
      epoch: EPOCH,
      retainedRevisions: 2,
    });
    const opened = snapshotOf(await draft.snapshot(LEVEL));
    for (let revision = 0; revision < 3; revision++) {
      await draft.command(LEVEL, {
        epoch: EPOCH,
        expectedDraftRevision: revision,
        command: move(`c${revision}`, revision + 1),
      });
    }

    const outcome = await draft.save(LEVEL, {
      epoch: EPOCH,
      expectedDraftRevision: 0,
      expectedDiskRevision: opened.diskRevision,
    });

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "unretained-revision",
    });
    expect(await readFile(path.join(root, LEVEL), "utf8")).not.toContain(
      '"x": 1',
    );
  });
});

describe("the server epoch", () => {
  it.each([
    [
      "a command",
      (draft: DraftService) =>
        draft.command(LEVEL, {
          epoch: "epoch-0",
          expectedDraftRevision: 0,
          command: move("a", 10),
        }),
    ],
    [
      "a save",
      (draft: DraftService) =>
        draft.save(LEVEL, {
          epoch: "epoch-0",
          expectedDraftRevision: 0,
          expectedDiskRevision: "whatever",
        }),
    ],
    [
      "an undo",
      (draft: DraftService) =>
        draft.undo(LEVEL, { epoch: "epoch-0", expectedDraftRevision: 0 }),
    ],
    [
      "a redo",
      (draft: DraftService) =>
        draft.redo(LEVEL, { epoch: "epoch-0", expectedDraftRevision: 0 }),
    ],
  ])("refuses %s from an earlier boot", async (_name, operate) => {
    const { draft } = await fixture();
    await draft.snapshot(LEVEL);

    const outcome = await operate(draft);

    expect(outcome).toMatchObject({
      status: "rejected",
      code: "epoch-mismatch",
    });
  });
});

describe("bootstrap", () => {
  it("names the project, the epoch, and the configured levels", async () => {
    const { draft } = await fixture();

    const response = await draft.bootstrap();

    expect(response.projectId).toBe("fixture");
    expect(response.epoch).toBe(EPOCH);
    expect(response.levels.map((level) => level.path)).toEqual([OTHER, LEVEL]);
  });
});
