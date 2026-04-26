import ReactReconciler from "react-reconciler";
import type { Container } from "pixi.js";
import type { UIElement, UIContainerElement } from "@yagejs/ui";

// ---------------------------------------------------------------------------
// Root instance tracking
// ---------------------------------------------------------------------------

const rootInstanceMap = new WeakMap<Container, UIElement[]>();

export function getRootInstances(
  container: Container,
): UIElement[] | undefined {
  return rootInstanceMap.get(container);
}

/** Callbacks invoked after each React commit so UIRoots can re-run layout. */
const onCommitCallbacks = new Set<() => void>();

export function addOnCommit(cb: () => void): void {
  onCommitCallbacks.add(cb);
}

export function removeOnCommit(cb: () => void): void {
  onCommitCallbacks.delete(cb);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isContainer(el: UIElement): el is UIContainerElement {
  return "addElement" in el;
}

/** Strip reconciler-internal props before forwarding to UI elements. */
function stripInternal(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in props) {
    if (k !== "_ctor" && k !== "_consumesText") out[k] = props[k];
  }
  return out;
}

// Track current update priority (required by react-reconciler 0.31+)
let currentUpdatePriority = 0;
let nextTimeoutHandle = 1;
const scheduledTimeouts = new Map<number, { cancelled: boolean }>();

const noop = (): void => { /* noop */ };

/**
 * React's host config still asks renderers to provide timeout hooks even
 * though this renderer currently drives updates synchronously.
 *
 * We intentionally do NOT use wall-clock timers here. Runtime `setTimeout`
 * would reintroduce nondeterministic scheduling into the UI layer, which
 * conflicts with frozen-step inspector tests.
 *
 * This shim therefore degrades "timeout" to "defer until the current turn
 * finishes" by using a microtask and ignoring the requested delay.
 *
 * Limitation:
 * this is only correct for our current usage because roots are `LegacyRoot`
 * and all public renders flush synchronously. If we ever rely on real delayed
 * scheduling semantics (for example true concurrent work, Suspense-driven
 * retries, or any feature that expects an actual millisecond delay), this
 * needs to be replaced with a real scheduler rather than a microtask shim.
 */
function scheduleDeferredCallback(
  callback: (...args: unknown[]) => void,
  _delay?: number,
  ...args: unknown[]
): number {
  const handle = nextTimeoutHandle++;
  const entry = { cancelled: false };
  scheduledTimeouts.set(handle, entry);
  queueMicrotask(() => {
    const current = scheduledTimeouts.get(handle);
    if (!current || current.cancelled) return;
    scheduledTimeouts.delete(handle);
    callback(...args);
  });
  return handle;
}

function cancelDeferredCallback(handle: number): void {
  const entry = scheduledTimeouts.get(handle);
  if (!entry) return;
  entry.cancelled = true;
  scheduledTimeouts.delete(handle);
}

// ---------------------------------------------------------------------------
// Reconciler host config — GENERIC, zero per-type logic
// ---------------------------------------------------------------------------

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  supportsMicrotasks: false,
  warnsIfNotActing: false,

  // Priority methods required by react-reconciler 0.31+
  setCurrentUpdatePriority(newPriority: number) {
    currentUpdatePriority = newPriority;
  },
  getCurrentUpdatePriority() {
    return currentUpdatePriority;
  },
  resolveUpdatePriority() {
    return currentUpdatePriority || 32; // DefaultEventPriority
  },
  shouldAttemptEagerTransition() {
    return false;
  },

  // Suspense support stubs
  maySuspendCommit() { return false; },
  preloadInstance() { return true; },
  startSuspendingCommit: noop,
  suspendInstance: noop,
  waitForCommitToBeReady() { return null; },

  // Transition support
  NotPendingTransition: null,
  HostTransitionContext: { $$typeof: Symbol.for("react.context"), _currentValue: null },
  resetFormInstance: noop,

  // ---- Instance lifecycle (generic via registry) ----

  createInstance(_type: string, props: Record<string, unknown>) {
    const Ctor = props._ctor as new (p: Record<string, unknown>) => UIElement;
    if (!Ctor) throw new Error("Missing _ctor prop on <ui-element>");
    return new Ctor(stripInternal(props));
  },

  createTextInstance() {
    // Bare text nodes are not supported — use <ui-text> instead
    return null;
  },

  appendInitialChild(parent: UIElement, child: UIElement) {
    if (child && isContainer(parent)) {
      parent.addElement(child);
    }
  },

  appendChild(parent: UIElement, child: UIElement) {
    if (child && isContainer(parent)) {
      parent.addElement(child);
    }
  },

  appendChildToContainer(container: Container, child: UIElement) {
    if (!child) return;
    let instances = rootInstanceMap.get(container);
    if (!instances) {
      instances = [];
      rootInstanceMap.set(container, instances);
    }
    instances.push(child);
    container.addChild(child.displayObject);
  },

  removeChild(parent: UIElement, child: UIElement) {
    if (child && isContainer(parent)) {
      parent.removeElement(child);
    }
  },

  removeChildFromContainer(container: Container, child: UIElement) {
    if (!child) return;
    const instances = rootInstanceMap.get(container);
    if (instances) {
      const idx = instances.indexOf(child);
      if (idx !== -1) instances.splice(idx, 1);
    }
    container.removeChild(child.displayObject);
  },

  insertBefore(parent: UIElement, child: UIElement, beforeChild: UIElement) {
    if (child && isContainer(parent)) {
      parent.insertElementBefore(child, beforeChild);
    }
  },

  insertInContainerBefore(container: Container, child: UIElement, beforeChild: UIElement) {
    if (!child) return;
    const instances = rootInstanceMap.get(container);
    if (instances) {
      const beforeIdx = instances.indexOf(beforeChild);
      if (beforeIdx !== -1) {
        instances.splice(beforeIdx, 0, child);
      } else {
        instances.push(child);
      }
    }
    const containerIdx = container.children.indexOf(beforeChild.displayObject);
    if (containerIdx !== -1) {
      container.addChildAt(child.displayObject, containerIdx);
    } else {
      container.addChild(child.displayObject);
    }
  },

  finalizeInitialChildren() {
    return false;
  },

  prepareUpdate() {
    return true;
  },

  commitUpdate(instance: UIElement, _type: string, _oldProps: Record<string, unknown>, newProps: Record<string, unknown>) {
    instance.update(stripInternal(newProps));
  },

  commitTextUpdate() {
    // No bare text nodes
  },

  shouldSetTextContent(_type: string, props: Record<string, unknown>) {
    return (props._consumesText as boolean) ?? false;
  },

  getRootHostContext() {
    return {};
  },

  getChildHostContext(parentHostContext: Record<string, unknown>) {
    return parentHostContext;
  },

  getPublicInstance(instance: UIElement) {
    return instance;
  },

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    for (const cb of onCommitCallbacks) cb();
  },

  preparePortalMount: noop,

  // Mutation mode methods
  clearContainer(container: Container) {
    while (container.children.length > 0) {
      container.removeChildAt(0);
    }
    rootInstanceMap.delete(container);
  },

  resetTextContent: noop,

  hideInstance(instance: UIElement) {
    if (instance) instance.displayObject.visible = false;
  },

  hideTextInstance: noop,

  unhideInstance(instance: UIElement) {
    if (instance) instance.displayObject.visible = true;
  },

  unhideTextInstance: noop,

  // See `scheduleDeferredCallback()` above. This satisfies the host-config
  // contract without reintroducing wall-clock timers into runtime code.
  scheduleTimeout: scheduleDeferredCallback,
  cancelTimeout: cancelDeferredCallback,
  noTimeout: -1,
  getCurrentEventPriority: () => 32,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  detachDeletedInstance: noop,

  // Console binding (React 19+)
  bindToConsole: (methodName: string, args: unknown[], badgeName: string) => {
    return Function.prototype.bind.call(
      console[methodName as keyof typeof console] as (...a: unknown[]) => void,
      console,
      badgeName,
      ...args,
    );
  },

  // Track root for dev tools
  findFiberRoot: () => null,
  requestPostPaintCallback: noop,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reconciler = ReactReconciler(hostConfig as any);

/** Opaque root handle. */
export interface ReconcilerRoot {
  render(element: React.ReactElement): void;
  unmount(): void;
}

/** Create a React reconciler root attached to a PixiJS Container. */
export function createRoot(container: Container): ReconcilerRoot {
  const fiberRoot = reconciler.createContainer(
    container,
    0,    // tag: LegacyRoot
    null, // hydrationCallbacks
    false, // isStrictMode
    null, // concurrentUpdatesByDefaultOverride
    "",   // identifierPrefix
    (err: unknown) => { console.error('[reconciler:onRecoverableError]', err); }, // onRecoverableError
    null, // transitionCallbacks
  );

  const reconcilerInternal = reconciler as unknown as {
    updateContainerSync(
      element: React.ReactElement | null,
      container: unknown,
      parentComponent: null,
      callback: null,
    ): void;
    flushSyncWork(): void;
  };

  return {
    render(element: React.ReactElement) {
      reconcilerInternal.updateContainerSync(element, fiberRoot, null, null);
      reconcilerInternal.flushSyncWork();
    },
    unmount() {
      reconcilerInternal.updateContainerSync(null, fiberRoot, null, null);
      reconcilerInternal.flushSyncWork();
      rootInstanceMap.delete(container);
    },
  };
}
