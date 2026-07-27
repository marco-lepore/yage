import { describe, expect, it } from "vitest";
import { ProcessComponent, createMockEntity } from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { Abilities } from "../core/Abilities.js";
import type { AbilityDef } from "../core/types.js";
import { AbilityDriverComponent } from "./AbilityDriverComponent.js";

function timeline(id: string, duration = 1): AbilityDef {
  return { id, duration, timeline: [] };
}

function held(id: string): AbilityDef {
  return {
    id,
    phases: {
      hold: { hold: true, timeline: [] },
    },
  };
}

function setup(
  defs: readonly AbilityDef[],
  actions: readonly string[],
  bindings: ConstructorParameters<typeof AbilityDriverComponent>[0]["bindings"],
) {
  const { entity, context } = createMockEntity("driver-component-host");
  const input = new InputManager();
  input.setActionMap(Object.fromEntries(actions.map((action) => [action, []])));
  context.register(InputManagerKey, input);
  entity.add(new ProcessComponent());
  const abilities = entity.add(new Abilities(defs));
  const component = entity.add(new AbilityDriverComponent({ bindings }));
  return { entity, input, abilities, component };
}

describe("AbilityDriverComponent", () => {
  it("resolves input and updates the owned driver", () => {
    const { input, abilities, component } = setup(
      [timeline("dash")],
      ["dash"],
      { dash: { press: { send: "dash" } } },
    );

    input.fireActionDown("dash");
    component.update();

    expect(abilities.activeId()).toBe("dash");
  });

  it("replaces bindings and removes the previous listeners", () => {
    const { input, abilities, component } = setup(
      [timeline("attack"), timeline("dash")],
      ["attack", "dash"],
      { attack: { press: { send: "attack" } } },
    );

    input.fireActionDown("attack");
    component.update();
    input.fireActionUp("attack");
    component.update();
    abilities.cancel();

    component.replace({ bindings: { dash: { press: { send: "dash" } } } });
    input.fireActionDown("attack");
    component.update();
    expect(abilities.active()).toBeNull();

    input.fireActionDown("dash");
    component.update();
    expect(abilities.activeId()).toBe("dash");
  });

  it("cancels an owned hold when bindings are replaced", () => {
    const { input, abilities, component } = setup(
      [held("charge"), timeline("dash")],
      ["attack", "dash"],
      { attack: { hold: { send: "charge", at: 0 } } },
    );

    input.fireActionDown("attack");
    component.update();
    const activation = abilities.active();
    expect(activation?.isHolding).toBe(true);

    component.replace({ bindings: { dash: { press: { send: "dash" } } } });

    expect(activation?.state).toBe("cancelled");
    expect(abilities.active()).toBeNull();
    input.fireActionDown("dash");
    component.update();
    expect(abilities.activeId()).toBe("dash");
  });

  it("disposes listeners and buffered sends when removed", () => {
    const { entity, input, abilities, component } = setup(
      [timeline("blocker"), timeline("dash")],
      ["dash"],
      { dash: { press: { send: "dash", buffer: 0.5 } } },
    );
    abilities.send("blocker");
    input.fireActionDown("dash");
    component.update();
    expect(abilities.activeId()).toBe("blocker");

    entity.remove(AbilityDriverComponent);
    abilities.cancel();
    component.update();
    input.fireActionUp("dash");
    input.fireActionDown("dash");
    component.update();

    expect(abilities.active()).toBeNull();

    component.replace({ bindings: { dash: { press: { send: "dash" } } } });
    input.fireActionUp("dash");
    input.fireActionDown("dash");
    component.update();

    expect(abilities.active()).toBeNull();
  });

  it("cancels an owned hold when removed", () => {
    const { entity, input, abilities, component } = setup(
      [held("charge")],
      ["attack"],
      { attack: { hold: { send: "charge", at: 0 } } },
    );

    input.fireActionDown("attack");
    component.update();
    const activation = abilities.active();
    expect(activation?.isHolding).toBe(true);

    entity.remove(AbilityDriverComponent);

    expect(activation?.state).toBe("cancelled");
    expect(abilities.active()).toBeNull();
  });

  it("releases input while disabled and rebinds when enabled", () => {
    const { input, abilities, component } = setup(
      [timeline("dash")],
      ["dash"],
      { dash: { press: { send: "dash" } } },
    );

    component.enabled = false;
    input.fireActionDown("dash");
    component.update();
    expect(abilities.active()).toBeNull();

    component.enabled = true;
    input.fireActionUp("dash");
    input.fireActionDown("dash");
    component.update();
    expect(abilities.activeId()).toBe("dash");
  });

  it("uses the same input lifecycle while the host entity is inactive", () => {
    const { entity, input, abilities, component } = setup(
      [timeline("dash")],
      ["dash"],
      { dash: { press: { send: "dash" } } },
    );

    entity.setActive(false);
    input.fireActionDown("dash");
    component.update();
    expect(abilities.active()).toBeNull();

    entity.setActive(true);
    input.fireActionUp("dash");
    input.fireActionDown("dash");
    component.update();
    expect(abilities.activeId()).toBe("dash");
  });
});
