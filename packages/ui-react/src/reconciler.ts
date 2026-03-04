/* eslint-disable @typescript-eslint/no-explicit-any */
import ReactReconciler from "react-reconciler";
import type { Container } from "pixi.js";
import {
  PanelNode,
  UIText,
  UIButton,
  UIImage,
  UINineSlice,
  UIProgressBar,
  UICheckbox,
  PixiFancyButton,
  PixiCheckbox,
  PixiProgressBar,
  PixiSlider,
  PixiInput,
  PixiScrollBox,
  PixiSelect,
  PixiRadioGroup,
} from "@yage/ui";
import type { UIElement, UIContainerElement } from "@yage/ui";

// ---------------------------------------------------------------------------
// Element factory registry
// ---------------------------------------------------------------------------

export interface ElementDef {
  factory: (props: Record<string, unknown>) => UIElement;
  consumesText: boolean;
}

const registry = new Map<string, ElementDef>();

// Built-in registrations
registry.set("panel", {
  factory: (p) => new PanelNode(p as any),
  consumesText: false,
});
registry.set("ui-text", {
  factory: (p) => new UIText(p as any),
  consumesText: true,
});
registry.set("button", {
  factory: (p) => new UIButton(p as any),
  consumesText: true,
});
registry.set("ui-button", {
  factory: (p) => new UIButton(p as any),
  consumesText: true,
});
registry.set("ui-image", {
  factory: (p) => new UIImage(p as any),
  consumesText: false,
});
registry.set("ui-nine-slice", {
  factory: (p) => new UINineSlice(p as any),
  consumesText: false,
});
registry.set("ui-progress-bar", {
  factory: (p) => new UIProgressBar(p as any),
  consumesText: false,
});
registry.set("ui-checkbox", {
  factory: (p) => new UICheckbox(p as any),
  consumesText: false,
});

// @pixi/ui wrappers
registry.set("pixi-fancy-button", {
  factory: (p) => new PixiFancyButton(p as any),
  consumesText: false,
});
registry.set("pixi-checkbox", {
  factory: (p) => new PixiCheckbox(p as any),
  consumesText: false,
});
registry.set("pixi-progress-bar", {
  factory: (p) => new PixiProgressBar(p as any),
  consumesText: false,
});
registry.set("pixi-slider", {
  factory: (p) => new PixiSlider(p as any),
  consumesText: false,
});
registry.set("pixi-input", {
  factory: (p) => new PixiInput(p as any),
  consumesText: false,
});
registry.set("pixi-scroll-box", {
  factory: (p) => new PixiScrollBox(p as any),
  consumesText: false,
});
registry.set("pixi-select", {
  factory: (p) => new PixiSelect(p as any),
  consumesText: false,
});
registry.set("pixi-radio-group", {
  factory: (p) => new PixiRadioGroup(p as any),
  consumesText: false,
});

/** Register a custom element type for use in JSX. */
export function registerElement(type: string, def: ElementDef): void {
  registry.set(type, def);
}

// ---------------------------------------------------------------------------
// Root instance tracking
// ---------------------------------------------------------------------------

const rootInstanceMap = new WeakMap<Container, UIElement[]>();

export function getRootInstances(
  container: Container,
): UIElement[] | undefined {
  return rootInstanceMap.get(container);
}

/** Callback invoked after each React commit so UIRoot can re-run layout. */
let onCommitCallback: (() => void) | null = null;

export function setOnCommit(cb: (() => void) | null): void {
  onCommitCallback = cb;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isContainer(el: UIElement): el is UIContainerElement {
  return "addElement" in el;
}

// Track current update priority (required by react-reconciler 0.31+)
let currentUpdatePriority = 0;

const noop = (): void => { /* noop */ };

// ---------------------------------------------------------------------------
// Reconciler host config — GENERIC, zero per-type logic
// ---------------------------------------------------------------------------

const hostConfig: any = {
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

  createInstance(type: string, props: Record<string, unknown>) {
    const def = registry.get(type);
    if (!def) throw new Error(`Unknown UI element type: ${type}`);
    return def.factory(props);
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

  commitUpdate(instance: UIElement, _type: string, _oldProps: any, newProps: any) {
    instance.update(newProps);
  },

  commitTextUpdate() {
    // No bare text nodes
  },

  shouldSetTextContent(type: string) {
    return registry.get(type)?.consumesText ?? false;
  },

  getRootHostContext() {
    return {};
  },

  getChildHostContext(parentHostContext: any) {
    return parentHostContext;
  },

  getPublicInstance(instance: any) {
    return instance;
  },

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    onCommitCallback?.();
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

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
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

const reconciler = ReactReconciler(hostConfig);

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

  return {
    render(element: React.ReactElement) {
      (reconciler as any).updateContainerSync(element, fiberRoot, null, null);
      (reconciler as any).flushSyncWork();
    },
    unmount() {
      (reconciler as any).updateContainerSync(null, fiberRoot, null, null);
      (reconciler as any).flushSyncWork();
      rootInstanceMap.delete(container);
    },
  };
}
