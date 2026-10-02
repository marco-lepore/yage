import { Entity, Transform } from "@yagejs/core";
import { defineLevelEntity, defineParams, param } from "@yagejs/level";
import type { ParamsOf } from "@yagejs/level";
import { GraphicsComponent } from "@yagejs/renderer";

const fields = defineParams({
  width: param.number(64, { min: 1 }),
  height: param.number(64, { min: 1 }),
  color: param.color("#55aaff"),
});
/** Preview artwork authored through the same schema as project entities. */
export class SequencePlaceholder extends Entity {
  static readonly level = defineLevelEntity({
    id: "yage.sequence-placeholder",
    version: 1,
    params: fields,
  });
  setup(p: ParamsOf<typeof fields>): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-p.width / 2, -p.height / 2, p.width, p.height)
          .fill({ color: p.color, alpha: 0.2 })
          .stroke({ color: p.color, width: 2 });
        g.circle(0, 0, 3).fill(p.color);
      }),
    );
  }
}
