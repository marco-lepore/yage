import { ProgressBar } from "@pixi/ui";
import type { PixiProgressBarProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";
import { resolvePixiView } from "./view-resolver.js";

const DEFAULT_VALUE = 0;

/** Yoga-aware wrapper around @pixi/ui ProgressBar. */
export class PixiProgressBar extends PixiUIBase<ProgressBar> {
  constructor(props: PixiProgressBarProps) {
    const view = new ProgressBar({
      bg: resolvePixiView(props.bg),
      fill: resolvePixiView(props.fill),
      progress: props.value ?? DEFAULT_VALUE,
      fillPaddings: props.fillPaddings,
      nineSliceSprite: props.nineSliceSprite
        ? { bg: props.nineSliceSprite, fill: props.nineSliceSprite }
        : undefined,
    } as ConstructorParameters<typeof ProgressBar>[0]);
    super(view, props);
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as Partial<PixiProgressBarProps>;

    if ("value" in p) this.view.progress = p.value ?? DEFAULT_VALUE;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    // No signals
  }
}
