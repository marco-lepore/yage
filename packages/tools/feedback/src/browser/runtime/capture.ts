import type { Engine, EngineSnapshot } from "@yagejs/core";
import type { DebugDiagnostics } from "@yagejs/debug";
import { RendererKey, VisualComponent } from "@yagejs/renderer";
import { copyJson } from "../../shared/protocol.js";
import type {
  FeedbackCapture,
  FeedbackEntity,
  Json,
  Rect,
} from "../../shared/protocol.js";

/** Render and copy in one task: WebGL may discard its drawing buffer afterward. */
export function captureView(
  engine: Engine,
  sessionId: string,
  context: Json,
): { capture: FeedbackCapture; image: string } {
  const renderer = engine.context.resolve(RendererKey);
  const debug = engine.inspector.getExtension<DebugDiagnostics>("debug");
  const wasHudVisible = debug?.isHudVisible() ?? false;
  const { canvas } = renderer;
  let image: string;
  try {
    if (wasHudVisible) debug?.setHudVisible(false);
    renderer.application.render();
    image = canvas.toDataURL("image/png");
  } finally {
    if (wasHudVisible) debug?.setHudVisible(true);
  }
  const snapshot = engine.inspector.snapshot();
  const entities = captureEntities(engine, snapshot);
  return {
    image,
    capture: {
      version: 1,
      id: crypto.randomUUID(),
      sessionId,
      created: new Date().toISOString(),
      frame: snapshot.frame,
      url: location.href,
      width: canvas.width,
      height: canvas.height,
      context,
      snapshot: copyJson(JSON.parse(JSON.stringify(snapshot))),
      entities,
    },
  };
}

function captureEntities(
  engine: Engine,
  snapshot: EngineSnapshot,
): FeedbackEntity[] {
  const renderer = engine.context.resolve(RendererKey);
  const { width, height } = renderer.canvas;
  const screen = renderer.application.renderer.screen;
  const result: FeedbackEntity[] = [];
  for (const scene of engine.scenes.all) {
    for (const entity of scene.getEntities()) {
      const visualBounds: Rect[] = [];
      for (const component of entity.getAll(VisualComponent)) {
        const display = component.renderObject;
        let visible = true;
        let parent = display;
        while (true) {
          if (!parent.visible || !parent.renderable || parent.alpha <= 0)
            visible = false;
          if (!parent.parent) break;
          parent = parent.parent;
        }
        if (!visible || parent !== renderer.application.stage) continue;
        const bounds = display.getBounds();
        const x = Math.max(0, (bounds.x * width) / screen.width);
        const y = Math.max(0, (bounds.y * height) / screen.height);
        const right = Math.min(
          width,
          ((bounds.x + bounds.width) * width) / screen.width,
        );
        const bottom = Math.min(
          height,
          ((bounds.y + bounds.height) * height) / screen.height,
        );
        if (
          [x, y, right, bottom].every(Number.isFinite) &&
          right > x &&
          bottom > y
        )
          visualBounds.push({ x, y, width: right - x, height: bottom - y });
      }
      if (visualBounds.length === 0) continue;
      const x = Math.min(...visualBounds.map((box) => box.x));
      const y = Math.min(...visualBounds.map((box) => box.y));
      const right = Math.max(...visualBounds.map((box) => box.x + box.width));
      const bottom = Math.max(...visualBounds.map((box) => box.y + box.height));
      const capturedScene = snapshot.scenes.find((candidate) =>
        candidate.entities.some((one) => one.id === String(entity.id)),
      );
      const captured = capturedScene?.entities.find(
        (one) => one.id === String(entity.id),
      );
      if (captured && capturedScene)
        result.push({
          sceneId: capturedScene.id,
          id: captured.id,
          generation: captured.generation,
          name: entity.name,
          bounds: { x, y, width: right - x, height: bottom - y },
        });
    }
  }
  return result;
}
