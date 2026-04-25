import { describe, it, expect, vi } from "vitest";
import { Process, ProcessSystem } from "@yagejs/core";
import { makeProcessSystemHost } from "./ProcessSystemHost.js";

describe("makeProcessSystemHost", () => {
  it("forwards run() to ProcessSystem.add", () => {
    const ps = new ProcessSystem();
    const add = vi.spyOn(ps, "add");
    const host = makeProcessSystemHost(ps);
    const p = new Process({ duration: 100 });
    host.run(p);
    expect(add).toHaveBeenCalledWith(p);
  });

  it("cancelAll cancels only processes this host enqueued", () => {
    const ps = new ProcessSystem();
    const hostA = makeProcessSystemHost(ps);
    const hostB = makeProcessSystemHost(ps);
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    hostA.run(a);
    hostB.run(b);
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    hostA.cancelAll();
    expect(aCancel).toHaveBeenCalledOnce();
    expect(bCancel).not.toHaveBeenCalled();
  });

  it("cancelAll skips already-completed processes", () => {
    const ps = new ProcessSystem();
    const host = makeProcessSystemHost(ps);
    const p = new Process({ duration: 100 });
    host.run(p);
    p.cancel();
    const cancel = vi.spyOn(p, "cancel");
    host.cancelAll();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("prunes completed processes lazily on run()", () => {
    const ps = new ProcessSystem();
    const host = makeProcessSystemHost(ps);
    const a = new Process({ duration: 100 });
    const b = new Process({ duration: 100 });
    host.run(a);
    a.cancel();
    host.run(b); // sweep happens here
    const aCancel = vi.spyOn(a, "cancel");
    const bCancel = vi.spyOn(b, "cancel");
    host.cancelAll();
    expect(aCancel).not.toHaveBeenCalled();
    expect(bCancel).toHaveBeenCalledOnce();
  });
});
