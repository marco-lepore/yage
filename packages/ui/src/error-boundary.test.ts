import { describe, expect, it } from "vitest";
import { ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { Container } from "pixi.js";
import { bindUIErrorBoundary, runUICallback } from "./error-boundary.js";

function boundary(): ErrorBoundary {
  return new ErrorBoundary(new Logger({ level: LogLevel.None }));
}

describe("UI callback attribution", () => {
  it("uses the boundary owned by each mounted UI tree", () => {
    const firstBoundary = boundary();
    const secondBoundary = boundary();
    const firstRoot = new Container();
    const secondRoot = new Container();
    const firstControl = new Container();
    const secondControl = new Container();
    firstRoot.addChild(firstControl);
    secondRoot.addChild(secondControl);
    bindUIErrorBoundary(firstRoot, firstBoundary);
    bindUIErrorBoundary(secondRoot, secondBoundary);

    expect(() =>
      runUICallback(firstControl, "first callback", () => {
        throw new Error("first failed");
      }),
    ).toThrow("first failed");
    expect(() =>
      runUICallback(secondControl, "second callback", () => {
        throw new Error("second failed");
      }),
    ).toThrow("second failed");

    expect(firstBoundary.getCallbackErrors()).toEqual([
      { kind: "first callback", error: "first failed" },
    ]);
    expect(secondBoundary.getCallbackErrors()).toEqual([
      { kind: "second callback", error: "second failed" },
    ]);
  });
});
