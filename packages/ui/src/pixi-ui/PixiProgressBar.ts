import { ProgressBar } from "@pixi/ui";
import type { PixiProgressBarProps } from "../types.js";
import { PixiUIBase } from "./PixiUIBase.js";

/** Yoga-aware wrapper around @pixi/ui ProgressBar. */
export class PixiProgressBar extends PixiUIBase<ProgressBar> {
  constructor(props: PixiProgressBarProps) {
    const view = new ProgressBar({
      bg: props.bg,
      fill: props.fill,
      progress: props.value ?? 0,
      fillPaddings: props.fillPaddings,
      nineSliceSprite: props.nineSliceSprite
        ? { bg: props.nineSliceSprite, fill: props.nineSliceSprite }
        : undefined,
    } as ConstructorParameters<typeof ProgressBar>[0]);
    super(view, props);
  }

  update(props: Record<string, unknown>): void {
    const p = props as unknown as PixiProgressBarProps;

    if (p.value !== undefined) this.view.progress = p.value;

    this.updateBase(props);
  }

  protected disconnectAll(): void {
    // No signals
  }
}
