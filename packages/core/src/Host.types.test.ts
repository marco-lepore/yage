import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  HostActivity,
  HostFocus,
  HostInfo,
  HostLifecycleReport,
  HostOS,
  HostPermission,
  HostSupport,
  HostVisibility,
} from "./Host.js";

// Type-level coverage for the status vocabulary: the two status unions are
// closed, the operating system union carries `"unknown"`, and `runtime` stays
// open so an adapter outside this repository can name itself. The assertions
// compile; `assertTypes` is never called, and the runtime test below only
// asserts that.

function assertTypes(): void {
  expectTypeOf<HostSupport>().toEqualTypeOf<
    "supported" | "unsupported" | "unknown"
  >();
  expectTypeOf<HostPermission>().toEqualTypeOf<
    "granted" | "denied" | "prompt" | "unknown"
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
}

describe("Host types", () => {
  it("compiles its type assertions", () => {
    expect(typeof assertTypes).toBe("function");
  });
});
