import type { GraphicsCapabilities } from "./GraphicsCapabilities.js";

/**
 * The `"graphics"` Inspector extension, registered by `RendererPlugin` when
 * an Inspector is installed. Read it with
 * `inspector.getExtension<GraphicsDiagnostics>("graphics")`.
 */
export interface GraphicsDiagnostics {
  /** The same object `RendererPlugin.capabilities` returns. */
  capabilities(): GraphicsCapabilities;
  /** Whether the context is lost right now. */
  contextLost(): boolean;
}
