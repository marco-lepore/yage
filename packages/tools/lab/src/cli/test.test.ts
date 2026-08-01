import type { Browser } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { LAB_GLOBAL } from "../runner/labGlobal.js";
import { driveScenarios, type ScenarioResult } from "./test.js";

/**
 * The lab as a driver finds it: a `LabApi` on the page's global, and a URL that
 * decides which scenario is mounted.
 *
 * The fake page runs the driver's own in-page functions in this process,
 * against this object. They only ever reach `globalThis`, so the same source
 * that Playwright serializes into a browser runs here unchanged.
 */
interface StubScenario {
  id: string;
  title: string;
  hasDrive?: boolean;
  /** What `run()` resolves with, or what it throws. */
  run?: () => Promise<{
    ok: boolean;
    error?: string;
    framesUsed: number;
    durationMs: number;
    captures: { label?: string; dataUrl: string }[];
  }>;
  /** What `run()` rejects with, the way a rebuild that threw makes it. */
  runRejects?: string;
  /** Errors the engine has recorded by the time the driver looks. */
  errors?: { kind: string; error: string; scene?: string }[];
  /** Never settles, so the driver's deadline is the only way out. */
  hangs?: boolean;
}

interface StubOptions {
  scenarios: StubScenario[];
  problems?: { path: string; message: string }[];
  /** Never settles, so the driver's deadline is the only way out. */
  neverStarts?: boolean;
  /** What `ready` rejects with when the engine failed to start. */
  bootError?: string;
  /** Fails the screenshot, the way a harness with no renderer does. */
  captureFails?: boolean;
}

function stubLab(opts: StubOptions) {
  const stepped: string[] = [];
  let current: StubScenario | undefined;

  const ready = (): Promise<void> => {
    if (opts.neverStarts === true) return new Promise<void>(() => {});
    if (opts.bootError !== undefined) {
      return Promise.reject(new Error(opts.bootError));
    }
    return Promise.resolve();
  };

  const api = {
    ready: ready(),
    scenarios: opts.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      hasDrive: scenario.hasDrive ?? false,
    })),
    problems: opts.problems ?? [],
    current: () =>
      current === undefined
        ? undefined
        : { id: current.id, hasDrive: current.hasDrive ?? false },
    clock: {
      step: async (frames: number) => {
        if (current?.hangs === true) return new Promise<void>(() => {});
        stepped.push(`${current?.id ?? "(none)"}:${frames}`);
        return Promise.resolve();
      },
    },
    run: () => {
      if (current?.hangs === true) return new Promise(() => {});
      if (current?.runRejects !== undefined) {
        return Promise.reject(new Error(current.runRejects));
      }
      return (
        current?.run?.() ??
        Promise.resolve({
          ok: true,
          framesUsed: 10,
          durationMs: 5,
          captures: [],
        })
      );
    },
    engine: {
      inspector: {
        time: { getFrame: () => (current === undefined ? 0 : 42) },
        getErrors: () => ({ callbackErrors: current?.errors ?? [] }),
        capture: {
          dataURL: () =>
            opts.captureFails === true
              ? Promise.reject(new Error("no renderer"))
              : Promise.resolve("data:image/png;base64,AAA"),
        },
      },
    },
  };

  const page = {
    on: () => undefined,
    close: () => Promise.resolve(),
    goto: (url: string) => {
      const id = new URL(url).searchParams.get("scenario");
      current = opts.scenarios.find((scenario) => scenario.id === id);
      (globalThis as Record<string, unknown>)[LAB_GLOBAL] = api;
      return Promise.resolve();
    },
    waitForFunction: () => Promise.resolve(),
    // The driver's callbacks take one argument and read only `globalThis`.
    evaluate: (fn: (arg: unknown) => unknown, arg: unknown) =>
      Promise.resolve(fn(arg)),
  };

  const browser = { newPage: () => Promise.resolve(page) };
  return { browser: browser as unknown as Browser, stepped };
}

function run(
  opts: StubOptions,
  timeoutMs = 1_000,
): Promise<readonly ScenarioResult[]> {
  const { browser } = stubLab(opts);
  return driveScenarios({
    browser,
    baseUrl: "http://localhost:5210/",
    timeoutMs,
    capture: false,
  });
}

afterEach(() => {
  (globalThis as Record<string, unknown>)[LAB_GLOBAL] = undefined;
});

describe("driveScenarios", () => {
  it("drives a scenario that declares one and steps one that does not", async () => {
    const { browser, stepped } = stubLab({
      scenarios: [
        { id: "drop", title: "Physics / Drop", hasDrive: true },
        { id: "shapes", title: "Render / Shapes" },
      ],
    });

    const results = await driveScenarios({
      browser,
      baseUrl: "http://localhost:5210/",
      timeoutMs: 1_000,
      capture: false,
    });

    expect(
      results.map((result) => [result.id, result.mode, result.ok]),
    ).toEqual([
      ["drop", "drive", true],
      ["shapes", "smoke", true],
    ]);
    // A scenario without a drive is still mounted and run, which is what makes
    // the command a smoke test for a project that has written none.
    expect(stepped).toEqual(["shapes:60"]);
  });

  it("fails on an assertion the run reported", async () => {
    const results = await run({
      scenarios: [
        {
          id: "drop",
          title: "T",
          hasDrive: true,
          run: () =>
            Promise.resolve({
              ok: false,
              error: "expected 1 to be 2",
              framesUsed: 3,
              durationMs: 1,
              captures: [],
            }),
        },
      ],
    });

    expect(results[0]).toMatchObject({
      ok: false,
      framesUsed: 3,
      failures: ["expected 1 to be 2"],
    });
  });

  it("fails a scenario the engine recorded an error for, driven or not", async () => {
    const errors = [
      { kind: "Scene onEnter hook", error: "setup exploded", scene: "drop" },
    ];

    const results = await run({
      scenarios: [
        { id: "drop", title: "T", errors },
        { id: "slime", title: "T", hasDrive: true, errors },
      ],
    });

    expect(results.map((result) => result.ok)).toEqual([false, false]);
    expect(results[0]?.failures).toEqual([
      "Scene onEnter hook: setup exploded (drop)",
    ]);
  });

  it("fails a scenario that outlives the deadline instead of waiting for it", async () => {
    const results = await run(
      { scenarios: [{ id: "drop", title: "T", hasDrive: true, hangs: true }] },
      20,
    );

    expect(results[0]).toMatchObject({ ok: false, framesUsed: 0 });
    expect(results[0]?.failures[0]).toMatch(/Timed out after 20 ms/);
  });

  it("fails a file the lab could not load", async () => {
    const results = await run({
      scenarios: [{ id: "drop", title: "T" }],
      problems: [
        { path: "/src/broken.scenario.ts", message: "no default export" },
      ],
    });

    expect(results[0]).toMatchObject({
      id: "/src/broken.scenario.ts",
      ok: false,
      mode: "skipped",
      failures: ["no default export"],
    });
    expect(results[1]?.ok).toBe(true);
  });

  it("reports each scenario as it finishes", async () => {
    const seen: string[] = [];
    const { browser } = stubLab({
      scenarios: [
        { id: "drop", title: "T" },
        { id: "shapes", title: "T" },
      ],
    });

    await driveScenarios({
      browser,
      baseUrl: "http://localhost:5210/",
      timeoutMs: 1_000,
      capture: false,
      onResult: (result) => seen.push(result.id),
    });

    expect(seen).toEqual(["drop", "shapes"]);
  });

  it("reports one line for a `setup` that throws, not three", async () => {
    // A driven scenario rebuilds before it runs, so the engine records the
    // throw twice, and the rejected rebuild carries the bare message a third
    // time. The attributed record is the one that says where it happened.
    const record = { kind: "Scene onEnter hook", error: "boom", scene: "drop" };

    const results = await run({
      scenarios: [
        {
          id: "drop",
          title: "T",
          hasDrive: true,
          runRejects: "boom",
          errors: [record, record],
        },
      ],
    });

    expect(results[0]?.failures).toEqual(["Scene onEnter hook: boom (drop)"]);
  });

  it("keeps a failure the engine did not record", async () => {
    // An assertion inside a `drive` never reaches the error boundary, so
    // collapsing it into a recorded line would lose the only report of it.
    const results = await run({
      scenarios: [
        {
          id: "drop",
          title: "T",
          hasDrive: true,
          run: () =>
            Promise.resolve({
              ok: false,
              error: "expected 1 to be 2",
              framesUsed: 1,
              durationMs: 1,
              captures: [],
            }),
          errors: [{ kind: "Component Health", error: "unrelated" }],
        },
      ],
    });

    expect(results[0]?.failures).toEqual([
      "expected 1 to be 2",
      "Component Health: unrelated",
    ]);
  });

  it("collects a screenshot only when one was asked for", async () => {
    const { browser } = stubLab({
      scenarios: [
        {
          id: "drop",
          title: "T",
          hasDrive: true,
          run: () =>
            Promise.resolve({
              ok: true,
              framesUsed: 1,
              durationMs: 1,
              captures: [
                { label: "mid", dataUrl: "data:image/png;base64,BBB" },
              ],
            }),
        },
      ],
    });

    const withCapture = await driveScenarios({
      browser,
      baseUrl: "http://localhost:5210/",
      timeoutMs: 1_000,
      capture: true,
    });
    const without = await driveScenarios({
      browser,
      baseUrl: "http://localhost:5210/",
      timeoutMs: 1_000,
      capture: false,
    });

    expect(withCapture[0]?.captures).toEqual([
      { label: "mid", dataUrl: "data:image/png;base64,BBB" },
      { dataUrl: "data:image/png;base64,AAA" },
    ]);
    // Every one of them crosses the bridge out of the page as base64 text, so
    // a run that writes none reads none — including the drive's own.
    expect(without[0]?.captures).toEqual([]);
  });

  it("warns about a screenshot it could not take without failing the run", async () => {
    // The scenario is what this command reports on. A screenshot is an
    // artifact of the run, so failing to take one must not turn the gate red.
    const { browser } = stubLab({
      scenarios: [{ id: "drop", title: "T" }],
      captureFails: true,
    });

    const [result] = await driveScenarios({
      browser,
      baseUrl: "http://localhost:5210/",
      timeoutMs: 1_000,
      capture: true,
    });

    expect(result?.ok).toBe(true);
    expect(result?.failures).toEqual([]);
    expect(result?.warnings).toEqual(["Screenshot failed: no renderer"]);
  });

  it("says the lab never started rather than blaming a scenario", async () => {
    await expect(
      run({ scenarios: [{ id: "drop", title: "T" }], neverStarts: true }, 20),
    ).rejects.toThrow(/did not finish starting within 20 ms/);
  });

  it("reports why the lab failed to start rather than a bare deadline", async () => {
    // `mount` publishes the API before the engine starts, so a boot that threw
    // still leaves a page that looks alive. `ready` is what carries the reason.
    await expect(
      run({
        scenarios: [{ id: "drop", title: "T" }],
        bootError: "WebGL context creation failed",
      }),
    ).rejects.toThrow(/WebGL context creation failed/);
  });
});
