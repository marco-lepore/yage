/**
 * MANDATORY composite-forwarding matrix: every new
 * lifecycle verb must reach the sub-presenters through all three composites —
 * the review's recurring bug class was a composite silently NOT forwarding.
 *
 * Matrix: { setVisible, setDiagnostics } × { Chrome, Text, Choice }, plus the
 * verbs unique to one composite (the chrome's restore-active + buffered
 * caret + no-hide-all nameplate; the text's active-gated reveal seam).
 */

import { describe, expect, it } from "vitest";
import type { Scene } from "@yagejs/core";

import { CompositeChrome } from "./CompositeChrome.js";
import { CompositeTextPresenter } from "./CompositeTextPresenter.js";
import { CompositeChoicePresenter } from "./CompositeChoicePresenter.js";
import { CompositeAvatarPresenter } from "./CompositeAvatarPresenter.js";
import { makeDefaultRoute, fixedRoute } from "./route.js";
import { actorRegistryFor, type DialogueActor } from "../actor/index.js";
import type {
  ChoicePresenter,
  ChromePresenter,
  TextPresenter,
} from "../chrome/DialogueUiAdapter.js";
import type { AvatarPresenter } from "../avatar/AvatarPresenter.js";
import type { RevealBeat } from "../core/LineReveal.js";
import type { MarkerToken } from "../core/types.js";
import type { ChoiceContext, PresentedChoice, PresentedLine, SpeakerView } from "../core/session.js";

const SCENE = {} as unknown as Scene; // the recording stubs ignore the scene
const speaker: SpeakerView = { id: "npc", name: "NPC" };

const boxLine = (): PresentedLine => ({
  text: { runs: [], tokens: [], length: 0 },
  speed: 1,
}); // no speaker → box
const bubbleLine = (): PresentedLine => ({
  text: { runs: [], tokens: [], length: 0 },
  speed: 1,
  view: "bubble",
  speaker,
}); // speaker + view → bubble

class RecChrome implements ChromePresenter {
  visibles: boolean[] = [];
  nameplates: (string | undefined)[] = [];
  carets: boolean[] = [];
  presents: (string | undefined)[] = [];
  diagnostics = 0;
  mount(): void {}
  dispose(): void {}
  setNameplate(name: string | undefined): void {
    this.nameplates.push(name);
  }
  setContinueVisible(v: boolean): void {
    this.carets.push(v);
  }
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  present(line: PresentedLine | undefined): void {
    this.presents.push(line === undefined ? undefined : (line.view ?? "box"));
  }
  update(): void {}
  setDiagnostics(): void {
    this.diagnostics++;
  }
  get visible(): boolean {
    return this.visibles.at(-1) ?? false;
  }
}

class RecText implements TextPresenter {
  visibles: boolean[] = [];
  presents = 0;
  clears = 0;
  diagnostics = 0;
  private listener?: (() => void) | undefined;
  private beatListener?: ((beat: RevealBeat) => void) | undefined;
  mount(): void {}
  dispose(): void {}
  present(): void {
    this.presents++;
  }
  completeReveal(): void {}
  isRevealComplete(): boolean {
    return true;
  }
  isRevealing(): boolean {
    return false;
  }
  setSpeedMultiplier(): void {}
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  setRevealListener(l: (() => void) | undefined): void {
    this.listener = l;
  }
  setBeatListener(l: ((beat: RevealBeat) => void) | undefined): void {
    this.beatListener = l;
  }
  update(): void {}
  clear(): void {
    this.clears++;
  }
  setDiagnostics(): void {
    this.diagnostics++;
  }
  /** Test hook: simulate this sub-view finishing its reveal. */
  fireReveal(): void {
    this.listener?.();
  }
  /** Test hook: simulate this sub-view emitting a reveal beat. */
  fireBeat(beat: RevealBeat): void {
    this.beatListener?.(beat);
  }
  get visible(): boolean {
    return this.visibles.at(-1) ?? false;
  }
}

class RecChoice implements ChoicePresenter {
  visibles: boolean[] = [];
  presents = 0;
  clears = 0;
  diagnostics = 0;
  onChoiceChosen?: (position: number) => void;
  mount(): void {}
  dispose(): void {}
  present(): void {
    this.presents++;
  }
  highlight(): void {}
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  clear(): void {
    this.clears++;
  }
  setDiagnostics(): void {
    this.diagnostics++;
  }
  get visible(): boolean {
    return this.visibles.at(-1) ?? false;
  }
}

describe("composite matrix — setVisible reaches the sub-presenters", () => {
  it("Chrome: show restores ONLY the active variant, hide retains it", () => {
    const box = new RecChrome();
    const bubble = new RecChrome();
    const c = new CompositeChrome(box, bubble);
    c.mount(SCENE);

    c.present(bubbleLine()); // active = bubble
    c.setVisible(true);
    expect(bubble.visible).toBe(true);
    expect(box.visible).toBe(false);

    c.setVisible(false); // cutscene hide — both off, active RETAINED
    expect(bubble.visible).toBe(false);
    expect(box.visible).toBe(false);

    c.setVisible(true); // restore — ONLY the bubble, the box frame stays hidden
    expect(bubble.visible).toBe(true);
    expect(box.visible).toBe(false);
  });

  it("Text: setVisible forwards to BOTH sub-views", () => {
    const box = new RecText();
    const bubble = new RecText();
    const c = new CompositeTextPresenter(box, bubble);
    c.setVisible(true);
    expect(box.visible).toBe(true);
    expect(bubble.visible).toBe(true);
    c.setVisible(false);
    expect(box.visible).toBe(false);
    expect(bubble.visible).toBe(false);
  });

  it("Choice: setVisible forwards to BOTH sub-presenters", () => {
    const box = new RecChoice();
    const bubble = new RecChoice();
    const c = new CompositeChoicePresenter(box, bubble);
    c.setVisible(true);
    expect(box.visible).toBe(true);
    expect(bubble.visible).toBe(true);
    c.setVisible(false);
    expect(box.visible).toBe(false);
    expect(bubble.visible).toBe(false);
  });
});

describe("composite matrix — setDiagnostics reaches both sub-presenters", () => {
  it("Chrome forwards setDiagnostics to both", () => {
    const box = new RecChrome();
    const bubble = new RecChrome();
    new CompositeChrome(box, bubble).setDiagnostics(() => {});
    expect(box.diagnostics).toBe(1);
    expect(bubble.diagnostics).toBe(1);
  });

  it("Text forwards setDiagnostics to both", () => {
    const box = new RecText();
    const bubble = new RecText();
    new CompositeTextPresenter(box, bubble).setDiagnostics(() => {});
    expect(box.diagnostics).toBe(1);
    expect(bubble.diagnostics).toBe(1);
  });

  it("Choice forwards setDiagnostics to both", () => {
    const box = new RecChoice();
    const bubble = new RecChoice();
    new CompositeChoicePresenter(box, bubble).setDiagnostics(() => {});
    expect(box.diagnostics).toBe(1);
    expect(bubble.diagnostics).toBe(1);
  });
});

describe("composite matrix — chrome-specific verbs", () => {
  it("setNameplate(undefined) forwards a name-clear to the active variant, NOT a hide-all", () => {
    const box = new RecChrome();
    const bubble = new RecChrome();
    const c = new CompositeChrome(box, bubble);
    c.mount(SCENE);
    c.present(boxLine()); // active = box
    c.setVisible(true);
    const hidesBefore = box.visibles.length;

    c.setNameplate(undefined);
    expect(box.nameplates.at(-1)).toBeUndefined(); // forwarded as "no name"
    expect(box.visibles.length).toBe(hidesBefore); // and did NOT hide the chrome
  });

  it("re-applies the buffered caret to the restored variant on show", () => {
    const box = new RecChrome();
    const bubble = new RecChrome();
    const c = new CompositeChrome(box, bubble);
    c.mount(SCENE);
    c.present(bubbleLine()); // active = bubble
    c.setVisible(true);
    c.setContinueVisible(true); // caret on, forwarded to the active bubble
    expect(bubble.carets.at(-1)).toBe(true);

    c.setVisible(false); // hide
    c.setVisible(true); // show → buffered caret re-applied to the active bubble
    expect(bubble.carets.at(-1)).toBe(true);
  });

  it("routes a speakerless line to the box even with view:'bubble' (narrator → box)", () => {
    const box = new RecChrome();
    const bubble = new RecChrome();
    const c = new CompositeChrome(box, bubble);
    c.mount(SCENE);
    c.present({ text: { runs: [], tokens: [], length: 0 }, speed: 1, view: "bubble" });
    c.setVisible(true);
    expect(box.visible).toBe(true);
    expect(bubble.visible).toBe(false);
  });
});

class RecAvatar implements AvatarPresenter {
  presents: (PresentedLine | undefined)[] = [];
  speakers = 0;
  expressions = 0;
  speakings = 0;
  markers: MarkerToken[] = [];
  visibles: boolean[] = [];
  mount(): void {}
  dispose(): void {}
  setSpeaker(): void {
    this.speakers++;
  }
  setExpression(): void {
    this.expressions++;
  }
  setSpeaking(): void {
    this.speakings++;
  }
  marker(marker: MarkerToken): void {
    this.markers.push(marker);
  }
  present(line: PresentedLine | undefined): void {
    this.presents.push(line);
  }
  setVisible(v: boolean): void {
    this.visibles.push(v);
  }
  update(): void {}
  get lastPresent(): PresentedLine | undefined {
    return this.presents.at(-1);
  }
}

describe("composite matrix — avatar routes + forwards", () => {
  it("routes present() to the matching side; clears the other", () => {
    const box = new RecAvatar();
    const bubble = new RecAvatar();
    const c = new CompositeAvatarPresenter(box, bubble, makeDefaultRoute());
    c.mount(SCENE);

    c.present(bubbleLine()); // speaker + view:bubble → bubble
    expect(bubble.lastPresent?.view).toBe("bubble");
    expect(box.lastPresent).toBeUndefined(); // box cleared

    c.present(boxLine()); // narrator → box
    expect(box.lastPresent?.view ?? "box").toBe("box");
    expect(bubble.lastPresent).toBeUndefined(); // bubble cleared

    c.present(undefined); // stop/end clears BOTH
    expect(box.lastPresent).toBeUndefined();
    expect(bubble.lastPresent).toBeUndefined();
  });

  it("forwards setSpeaker / setExpression / setSpeaking / setVisible / marker to both", () => {
    const box = new RecAvatar();
    const bubble = new RecAvatar();
    const c = new CompositeAvatarPresenter(box, bubble, makeDefaultRoute());
    c.setSpeaker(undefined);
    c.setExpression(undefined);
    c.setSpeaking(true);
    c.setVisible(false);
    const marker: MarkerToken = { kind: "marker", atChar: 3, name: "expression", props: { expression: "happy" } };
    c.marker(marker); // an inline reveal marker reaches both sides
    for (const a of [box, bubble]) {
      expect(a.speakers).toBe(1);
      expect(a.expressions).toBe(1);
      expect(a.speakings).toBe(1);
      expect(a.visibles).toEqual([false]);
      expect(a.markers).toEqual([marker]);
    }
  });

  it("routes a registered-actor line (no view) to the bubble side", () => {
    const scene = {} as unknown as Scene;
    actorRegistryFor(scene).register("npc", {} as DialogueActor);
    const box = new RecAvatar();
    const bubble = new RecAvatar();
    const c = new CompositeAvatarPresenter(box, bubble, makeDefaultRoute());
    c.mount(scene);
    c.present({ text: { runs: [], tokens: [], length: 0 }, speed: 1, speaker });
    expect(bubble.lastPresent).toBeDefined();
    expect(box.lastPresent).toBeUndefined();
  });
});

describe("composite matrix — routing: all three agree", () => {
  const registeredLine = (): PresentedLine => ({
    text: { runs: [], tokens: [], length: 0 },
    speed: 1,
    speaker, // no view → the registered actor decides
  });

  function freshScene(register: boolean): Scene {
    const s = {} as unknown as Scene;
    if (register) actorRegistryFor(s).register("npc", {} as DialogueActor);
    return s;
  }

  it("the default route sends a registered-actor line to the bubble across all three", () => {
    const scene = freshScene(true);
    const routing = makeDefaultRoute();

    const boxC = new RecChrome();
    const bubC = new RecChrome();
    const chrome = new CompositeChrome(boxC, bubC, routing);
    chrome.mount(scene);
    const boxT = new RecText();
    const bubT = new RecText();
    const text = new CompositeTextPresenter(boxT, bubT, routing);
    text.mount(scene);
    const boxCh = new RecChoice();
    const bubCh = new RecChoice();
    const choices = new CompositeChoicePresenter(boxCh, bubCh, routing);
    choices.mount(scene);

    chrome.present(registeredLine());
    text.present(registeredLine());
    choices.present([] as readonly PresentedChoice[], { speaker } as ChoiceContext);

    expect(bubC.presents.length).toBeGreaterThan(0); // chrome → bubble
    expect(bubT.presents).toBeGreaterThan(0); // text → bubble
    expect(bubCh.presents).toBeGreaterThan(0); // choices → bubble
    expect(boxC.presents.length).toBe(0);
  });

  it("an unregistered speaker (no view) goes to the box across all three", () => {
    const scene = freshScene(false);
    const routing = makeDefaultRoute();
    const boxC = new RecChrome();
    const bubC = new RecChrome();
    const chrome = new CompositeChrome(boxC, bubC, routing);
    chrome.mount(scene);
    chrome.present(registeredLine());
    expect(boxC.presents.length).toBeGreaterThan(0);
    expect(bubC.presents.length).toBe(0);
  });

  it("a shared custom route overrides view + actor; all three follow it", () => {
    const routing = fixedRoute(() => "bubble"); // route EVERYTHING to the bubble
    const boxC = new RecChrome();
    const bubC = new RecChrome();
    const chrome = new CompositeChrome(boxC, bubC, routing);
    chrome.mount(SCENE);
    chrome.present(boxLine()); // a speakerless line that would default to the box
    expect(bubC.presents.length).toBeGreaterThan(0); // override wins
    expect(boxC.presents.length).toBe(0);
  });
});

describe("composite matrix — text reveal seam", () => {
  it("forwards the ACTIVE sub-view's reveal and ignores the inactive one's", () => {
    const box = new RecText();
    const bubble = new RecText();
    const c = new CompositeTextPresenter(box, bubble);
    let fired = 0;
    c.setRevealListener(() => fired++);

    c.present(boxLine()); // active = box
    box.fireReveal(); // active → forwarded
    expect(fired).toBe(1);
    bubble.fireReveal(); // inactive → ignored (no stale event)
    expect(fired).toBe(1);

    c.present(bubbleLine()); // active = bubble
    bubble.fireReveal();
    expect(fired).toBe(2);
    box.fireReveal(); // now inactive → ignored
    expect(fired).toBe(2);
  });

  it("forwards the ACTIVE sub-view's reveal BEATS and ignores the inactive one's", () => {
    const box = new RecText();
    const bubble = new RecText();
    const c = new CompositeTextPresenter(box, bubble);
    const beats: RevealBeat[] = [];
    c.setBeatListener((beat) => beats.push(beat));

    c.present(boxLine()); // active = box
    box.fireBeat({ kind: "tick", index: 0 }); // active → forwarded
    bubble.fireBeat({ kind: "tick", index: 9 }); // inactive → ignored
    expect(beats).toEqual([{ kind: "tick", index: 0 }]);

    c.present(bubbleLine()); // active = bubble
    const marker: MarkerToken = { kind: "marker", atChar: 2, name: "sfx", props: { sfx: "ding" } };
    bubble.fireBeat({ kind: "marker", marker, viaSkip: false });
    box.fireBeat({ kind: "tick", index: 1 }); // now inactive → ignored
    expect(beats).toEqual([
      { kind: "tick", index: 0 },
      { kind: "marker", marker, viaSkip: false },
    ]);
  });
});
