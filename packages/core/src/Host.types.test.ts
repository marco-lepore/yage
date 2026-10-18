import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  HostActivity,
  HostFocus,
  HostInfo,
  HostInfoInput,
  HostLifecycleReport,
  HostOS,
  HostSupport,
  HostVisibility,
} from "./Host.js";

// Type-level coverage for the status vocabulary: the support union is
// closed, the operating system union carries `"unknown"`, and `runtime` stays
// open so an adapter outside this repository can name itself. The assertions
// compile; `assertTypes` is never called, and the runtime test below only
// asserts that.

function assertTypes(): void {
  expectTypeOf<HostSupport>().toEqualTypeOf<
    "supported" | "unsupported" | "unknown"
  >();
  expectTypeOf<HostOS>().toEqualTypeOf<
    "macos" | "windows" | "linux" | "ios" | "android" | "unknown"
  >();
  expectTypeOf<HostInfo["runtime"]>().toEqualTypeOf<string>();
  expectTypeOf<HostActivity>().toEqualTypeOf<
    "active" | "inactive" | "unknown"
  >();
  expectTypeOf<HostVisibility>().toEqualTypeOf<
    "visible" | "hidden" | "unknown"
  >();
  expectTypeOf<HostFocus>().toEqualTypeOf<
    "focused" | "unfocused" | "unknown"
  >();
  // Every field of a report is optional: an adapter reports the ones that
  // changed.
  expectTypeOf<HostLifecycleReport>().toEqualTypeOf<{
    readonly activity?: HostActivity;
    readonly visibility?: HostVisibility;
    readonly focus?: HostFocus;
  }>();

  // @ts-expect-error — the support union has no "available".
  const support: HostSupport = "available";
  void support;

  // An adapter leaves out a version it has no value for; every field of
  // `host.info` is present, holding `undefined` where the host said nothing.
  const minimal: HostInfoInput = { runtime: "electron", os: "macos" };
  void minimal;
  expectTypeOf<HostInfoInput["appVersion"]>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<HostInfoInput>().toEqualTypeOf<{
    readonly runtime: string;
    readonly os: HostOS;
    readonly appVersion?: string;
    readonly appBuild?: string;
    readonly runtimeVersion?: string;
  }>();
  expectTypeOf<HostInfo>().toEqualTypeOf<{
    readonly runtime: string;
    readonly os: HostOS;
    readonly appVersion: string | undefined;
    readonly appBuild: string | undefined;
    readonly runtimeVersion: string | undefined;
  }>();

  // @ts-expect-error — `HostInfo` requires the three version keys.
  const missing: HostInfo = { runtime: "electron", os: "macos" };
  void missing;
}

describe("Host types", () => {
  it("compiles its type assertions", () => {
    expect(typeof assertTypes).toBe("function");
  });
});
