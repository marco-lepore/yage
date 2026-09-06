import { describe, expect, it } from "vitest";
import {
  isRevision,
  parseCommandRequest,
  parseLevelCreateRequest,
  parseLevelDeleteRequest,
  parseLevelDuplicateRequest,
  parseRevisionedRequest,
  parseSaveRequest,
} from "./parse.js";

const COMMAND = {
  kind: "set-poses",
  commandId: "drag-1",
  poses: [
    {
      id: "crate-1",
      transform: {
        position: { x: 1, y: 2 },
        rotation: 0,
        scale: { x: 1, y: 1 },
      },
    },
  ],
};

const COMMAND_REQUEST = {
  epoch: "epoch-1",
  expectedDraftRevision: 3,
  command: COMMAND,
};

const SAVE_REQUEST = {
  epoch: "epoch-1",
  expectedDraftRevision: 3,
  expectedDiskRevision: "a".repeat(64),
};

describe("parseCommandRequest", () => {
  it("returns the request when every field is what it claims to be", () => {
    expect(parseCommandRequest(COMMAND_REQUEST)).toEqual(COMMAND_REQUEST);
  });

  it.each([
    ["a missing epoch", { ...COMMAND_REQUEST, epoch: undefined }],
    ["an empty epoch", { ...COMMAND_REQUEST, epoch: "" }],
    ["an epoch that is not a string", { ...COMMAND_REQUEST, epoch: 1 }],
    [
      "a revision that is not an integer",
      { ...COMMAND_REQUEST, expectedDraftRevision: 1.5 },
    ],
    ["a negative revision", { ...COMMAND_REQUEST, expectedDraftRevision: -1 }],
    [
      "a revision sent as a string",
      { ...COMMAND_REQUEST, expectedDraftRevision: "3" },
    ],
    [
      "a command this version does not know",
      { ...COMMAND_REQUEST, command: {} },
    ],
    // An extra field means the two sides disagree about what a request is,
    // which is worth a rejection rather than a partial read.
    [
      "a field the request does not have",
      { ...COMMAND_REQUEST, label: "drag" },
    ],
    ["a body that is not an object", "epoch-1"],
    ["a null body", null],
    ["an array", [COMMAND_REQUEST]],
  ])("refuses %s", (_name, body) => {
    expect(parseCommandRequest(body)).toBeUndefined();
  });
});

describe("parseSaveRequest", () => {
  it("returns the request when every field is what it claims to be", () => {
    expect(parseSaveRequest(SAVE_REQUEST)).toEqual(SAVE_REQUEST);
  });

  it.each([
    ["a missing epoch", { ...SAVE_REQUEST, epoch: undefined }],
    [
      "a disk revision that is not a string",
      { ...SAVE_REQUEST, expectedDiskRevision: 12 },
    ],
    [
      "a revision that is not a revision",
      { ...SAVE_REQUEST, expectedDraftRevision: Number.NaN },
    ],
    ["a field the request does not have", { ...SAVE_REQUEST, document: {} }],
    ["a command request", COMMAND_REQUEST],
    ["a null body", null],
  ])("refuses %s", (_name, body) => {
    expect(parseSaveRequest(body)).toBeUndefined();
  });
});

describe("parseRevisionedRequest", () => {
  const REQUEST = { epoch: "epoch-1", expectedDraftRevision: 3 };

  it("returns the request when every field is what it claims to be", () => {
    expect(parseRevisionedRequest(REQUEST)).toEqual(REQUEST);
  });

  it.each([
    ["a missing epoch", { expectedDraftRevision: 3 }],
    ["an empty epoch", { ...REQUEST, epoch: "" }],
    ["a missing revision", { epoch: "epoch-1" }],
    ["a negative revision", { ...REQUEST, expectedDraftRevision: -1 }],
    // Undo carries no document and no command. A body that has one is a
    // browser sending something this route would silently ignore.
    ["a command request", COMMAND_REQUEST],
    ["a save request", SAVE_REQUEST],
    ["a body that is not an object", "epoch-1"],
    ["a null body", null],
  ])("refuses %s", (_name, body) => {
    expect(parseRevisionedRequest(body)).toBeUndefined();
  });
});

describe("isRevision", () => {
  it.each([
    [0, true],
    [7, true],
    [Number.MAX_SAFE_INTEGER, true],
    [-1, false],
    [1.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
    ["3", false],
    [null, false],
  ])("reads %s as %s", (value, expected) => {
    expect(isRevision(value)).toBe(expected);
  });
});

describe("parseLevelCreateRequest", () => {
  it("reads a boot and a level id", () => {
    expect(
      parseLevelCreateRequest({ epoch: "epoch-1", levelId: "meadow" }),
    ).toEqual({ epoch: "epoch-1", levelId: "meadow" });
  });

  it.each([
    ["a missing level id", { epoch: "epoch-1" }],
    ["an empty level id", { epoch: "epoch-1", levelId: "" }],
    ["an empty epoch", { epoch: "", levelId: "meadow" }],
    // The path is in the query, so a body carrying one is a browser naming a
    // level this route would never read.
    ["a path in the body", { epoch: "epoch-1", levelId: "m", path: "a.json" }],
    ["a body that is not an object", "epoch-1"],
  ])("refuses %s", (_name, body) => {
    expect(parseLevelCreateRequest(body)).toBeUndefined();
  });
});

describe("parseLevelDuplicateRequest", () => {
  it("reads a boot, a level id, and the level being copied", () => {
    expect(
      parseLevelDuplicateRequest({
        epoch: "epoch-1",
        levelId: "meadow",
        sourcePath: "levels/forest.yage-level.json",
      }),
    ).toEqual({
      epoch: "epoch-1",
      levelId: "meadow",
      sourcePath: "levels/forest.yage-level.json",
    });
  });

  it.each([
    ["a missing source", { epoch: "epoch-1", levelId: "meadow" }],
    ["an empty source", { epoch: "epoch-1", levelId: "m", sourcePath: "" }],
    ["a source that is not text", { epoch: "e", levelId: "m", sourcePath: 1 }],
  ])("refuses %s", (_name, body) => {
    expect(parseLevelDuplicateRequest(body)).toBeUndefined();
  });
});

describe("parseLevelDeleteRequest", () => {
  it("reads the boot and nothing else", () => {
    expect(parseLevelDeleteRequest({ epoch: "epoch-1" })).toEqual({
      epoch: "epoch-1",
    });
  });

  it.each([
    ["an empty epoch", { epoch: "" }],
    [
      "a revision it would ignore",
      { epoch: "epoch-1", expectedDraftRevision: 0 },
    ],
    ["a null body", null],
  ])("refuses %s", (_name, body) => {
    expect(parseLevelDeleteRequest(body)).toBeUndefined();
  });
});
