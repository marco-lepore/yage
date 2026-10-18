import { describe, expect, it } from "vitest";
import { reportFor } from "./lifecycle.js";

describe("reportFor on iOS", () => {
  it("reads appStateChange as the app's activity", () => {
    expect(
      reportFor("ios", { name: "appStateChange", isActive: false }),
    ).toEqual({ activity: "inactive" });
    expect(
      reportFor("ios", { name: "appStateChange", isActive: true }),
    ).toEqual({ activity: "active" });
  });

  it("reads pause and resume as the window leaving and coming back", () => {
    expect(reportFor("ios", { name: "pause" })).toEqual({
      visibility: "hidden",
    });
    expect(reportFor("ios", { name: "resume" })).toEqual({
      visibility: "visible",
    });
  });
});

describe("reportFor on Android", () => {
  it("reads pause and resume as the activity's", () => {
    expect(reportFor("android", { name: "pause" })).toEqual({
      activity: "inactive",
    });
    expect(reportFor("android", { name: "resume" })).toEqual({
      activity: "active",
      visibility: "visible",
    });
  });

  it("reads appStateChange as the activity being stopped and started", () => {
    expect(
      reportFor("android", { name: "appStateChange", isActive: false }),
    ).toEqual({ visibility: "hidden" });
    expect(
      reportFor("android", { name: "appStateChange", isActive: true }),
    ).toEqual({ activity: "active", visibility: "visible" });
  });
});

describe("reportFor with a payload the bridge mangled", () => {
  it("names the value it got", () => {
    expect(() =>
      reportFor("ios", { name: "appStateChange", isActive: "yes" }),
    ).toThrow(
      "CapacitorHostPlugin: appStateChange reported isActive " +
        '"yes", expected a boolean.',
    );
    expect(() =>
      reportFor("android", { name: "appStateChange", isActive: undefined }),
    ).toThrow(
      "CapacitorHostPlugin: appStateChange reported isActive undefined, " +
        "expected a boolean.",
    );
  });
});
