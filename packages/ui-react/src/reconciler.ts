import ReactReconciler from "react-reconciler";
import type { Container } from "pixi.js";
import type { UIElement, UIContainerElement } from "@yagejs/ui";
import { devWarn } from "@yagejs/core";

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

/**
 * JSX children appended to a layout-leaf element (one with no `addElement`)
 * are silently dropped by every child op below. That class of "why is my box
 * empty?" bug is invisible without a warning — flag it once per offending
 * element type in dev.
 */
const warnedLeafTypes = new WeakSet<object>();

function warnNonContainerChild(parent: UIElement): void {
  const ctor = parent.constructor;
  if (warnedLeafTypes.has(ctor)) return;
  warnedLeafTypes.add(ctor);
  const name = ctor.name || "AnonymousUIElement";
  devWarn(
    `<${name}> is a layout leaf — it has no addElement(), so JSX children ` +
      `are ignored. Use <ScrollView> (or another container) for a ` +
      `declarative list, or drive this element imperatively via a ref.`,
  );
}

/**
 * Bare text/number JSX children (`<Panel>Score: {score}</Panel>`) have no
 * host text instance in this reconciler — `createTextInstance` returns null
 * and the content silently vanishes. Flag it once (globally, not per call
 * site — `createTextInstance` isn't handed a parent reference to key on)
 * so the fix (wrap in `<Text>`) is discoverable instead of a "why is my box
 * empty?" mystery.
 */
let warnedBareText = false;

function warnBareTextChild(text: string): void {
  if (warnedBareText) return;
  if (text.trim().length === 0) return; // whitespace between elements — not a real content bug
  warnedBareText = true;
  devWarn(
    `A bare text child ("${text}") was passed to a UI element — it will not ` +
      `render. This reconciler has no host text node; wrap it in <Text> ` +
      `(e.g. <Panel><Text>${text}</Text></Panel>).`,
  );
}

/** Reconciler-internal props stripped before forwarding to UI elements. */
const INTERNAL_KEYS = new Set(["_ctor", "_consumesText", "_bgAlias"]);

/** Strip reconciler-internal props before forwarding to UI elements. */
function stripInternal(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in props) {
    if (!INTERNAL_KEYS.has(k)) out[k] = props[k];
  }
  return out;
}

/**
 * Diff `oldProps` against `newProps` and return the props to forward to
 * `instance.update()`: every key from `newProps` (reconciler-internal keys
 * stripped) plus an explicit `undefined` for every key that was in
 * `oldProps` but is now absent from `newProps` — e.g. `{...(show ? {onClick:
 * fn} : {})}` dropping `onClick` between renders. A key that's merely
 * absent from BOTH is never synthesized; a key present with a literal
 * `undefined` value in `newProps` (e.g. `bg={cond ? x : undefined}`) already
 * comes through via the `newProps` spread. Every element's `update()` reads
 * a present-but-`undefined` key as "reset this prop to its default".
 */
function diffProps(
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): Record<string, unknown> {
  const merged = stripInternal(newProps);
  for (const k in oldProps) {
    if (!INTERNAL_KEYS.has(k) && !(k in newProps)) merged[k] = undefined;
  }
  return merged;
}

/**
 * JSX-only shorthand aliases → canonical `@yagejs/ui` prop name. One row per
 * alias; a future Mantine-style shorthand set (`p`, `m`, `w`, ...) is new
 * rows here, not a new mechanism.
 */
const SHORTHAND_ALIASES: Record<string, string> = {
  bg: "background",
};

/**
 * Expand shorthand aliases (see {@link SHORTHAND_ALIASES}) right before an
 * element is constructed or updated. Gated by the internal `_bgAlias`
 * marker (set by the JSX components that accept `bg` — `Panel`, `Button`,
 * `ScrollView`) rather than applied unconditionally: the Pixi* wrappers
 * (`PixiProgressBar`, `PixiSlider`, `PixiInput`) use `bg` as their own
 * required, unrelated view-slot prop and never set the marker, so they're
 * untouched. When both the alias and its canonical key are present, the
 * canonical value wins (dev-warns once per element type). Returns a fresh
 * object rather than deleting alias keys in place (avoids a dynamic
 * `delete`, which the lint config forbids).
 */
const warnedAliasCollision = new WeakSet<object>();

function expandShorthand(
  ctor: object,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const aliasKeys = Object.keys(SHORTHAND_ALIASES).filter((k) => k in props);
  if (aliasKeys.length === 0) return props;

  const out: Record<string, unknown> = {};
  for (const k in props) {
    if (!aliasKeys.includes(k)) out[k] = props[k];
  }
  for (const alias of aliasKeys) {
    const canonical = SHORTHAND_ALIASES[alias]!;
    if (canonical in props) {
      if (!warnedAliasCollision.has(ctor)) {
        warnedAliasCollision.add(ctor);
        const name = (ctor as { name?: string }).name || "AnonymousUIElement";
        devWarn(
          `<${name}>: both \`${alias}\` and \`${canonical}\` were passed — \`${canonical}\` wins.`,
        );
      }
    } else {
      out[canonical] = props[alias];
    }
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
    const clean = stripInternal(props);
    const finalProps = props._bgAlias ? expandShorthand(Ctor, clean) : clean;
    return new Ctor(finalProps);
  },

  createTextInstance(text: string) {
    // Bare text nodes are not supported — use <ui-text> instead. Silently
    // dropping this is a "why is my text missing?" trap, so flag it once.
    warnBareTextChild(text);
    return null;
  },

  appendInitialChild(parent: UIElement, child: UIElement) {
    if (!child) return;
    if (isContainer(parent)) parent.addElement(child);
    else warnNonContainerChild(parent);
  },

  appendChild(parent: UIElement, child: UIElement) {
    if (!child) return;
    if (isContainer(parent)) parent.addElement(child);
    else warnNonContainerChild(parent);
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
    if (!child) return;
    if (isContainer(parent)) parent.removeElement(child);
    // React only calls removeChild/removeChildFromContainer for the
    // top-most host instance of a deleted subtree (never for reorders —
    // those use insertBefore), so one recursive destroy() per deletion
    // root exactly mirrors imperative teardown. detachDeletedInstance
    // stays a noop: it fires per instance (would double-destroy children)
    // and in the passive phase (after paint). Destroy unconditionally —
    // even a child whose append onto a non-container leaf was warned and
    // ignored still needs its own teardown on removal.
    child.destroy();
  },

  removeChildFromContainer(container: Container, child: UIElement) {
    if (!child) return;
    const instances = rootInstanceMap.get(container);
    if (instances) {
      const idx = instances.indexOf(child);
      if (idx !== -1) instances.splice(idx, 1);
    }
    container.removeChild(child.displayObject);
    child.destroy();
  },

  insertBefore(parent: UIElement, child: UIElement, beforeChild: UIElement) {
    if (!child) return;
    if (isContainer(parent)) parent.insertElementBefore(child, beforeChild);
    else warnNonContainerChild(parent);
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

  commitUpdate(instance: UIElement, _type: string, oldProps: Record<string, unknown>, newProps: Record<string, unknown>) {
    const merged = diffProps(oldProps, newProps);
    // Shorthand expansion runs AFTER the removal diff above, on the
    // authored JSX prop names (`bg` included) — so removing `bg` clears
    // `background` exactly like removing `background` directly would.
    const finalProps = newProps._bgAlias
      ? expandShorthand(instance.constructor, merged)
      : merged;
    instance.update(finalProps);
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

/**
 * Portal a subtree into another PixiJS `Container` while keeping it in the
 * caller's React tree (context, props, lifecycle all flow normally). Used
 * by the floating layer to render tooltip/popover content into the
 * top-most scene overlay without leaving the trigger's component subtree.
 */
export function createPortal(
  children: React.ReactNode,
  container: Container,
): React.ReactPortal {
  // react-reconciler bundles its own (older) React types; the returned
  // portal is structurally our React.ReactPortal.
  return reconciler.createPortal(
    children,
    container,
    null,
    null,
  ) as unknown as React.ReactPortal;
}

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
