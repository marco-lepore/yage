import { expect, test, type Page } from "@playwright/test";
import type { AudioDiagnostics, AudioMeasurements } from "@yagejs/audio";
import type { MusicDiagnostics } from "@yagejs-addons/music";
interface Lab {
  diagnostics: MusicDiagnostics;
  audio: AudioDiagnostics;
  loading: { mode: string; aliases: number; files: number };
  offline: AudioMeasurements | null;
  measuring: boolean;
}
const lab = (page: Page): Promise<Lab> =>
  page.evaluate(
    () =>
      window.__yage__!.inspector.getComponentData(
        "MusicLabEntity",
        "MusicLab",
      ) as Lab,
  );
const audio = (page: Page): Promise<AudioDiagnostics> =>
  page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<{
        getDiagnostics(): AudioDiagnostics;
      }>("audio")!
      .getDiagnostics(),
  );
test("trusted gesture, independent clocks, deterministic mix and owner teardown", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/adaptive-music.html");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector?.getComponentData(
        "MusicLabEntity",
        "MusicLab",
      ) !== undefined,
  );
  expect((await lab(page)).loading).toMatchObject({
    mode: "files",
    aliases: 8,
    files: 8,
  });
  await page.getByRole("button", { name: "Start audio", exact: true }).click();
  await expect.poll(async () => (await audio(page)).state).toBe("running");
  await expect
    .poll(async () => (await lab(page)).diagnostics.scheduledNotes)
    .toBeGreaterThan(0);
  await page.getByRole("combobox", { name: "Lead" }).selectOption("flute");
  await page.getByRole("slider", { name: "Intensity" }).fill("0.85");
  await expect
    .poll(async () => (await lab(page)).diagnostics.parameters["intensity"])
    .toBe(0.85);
  await page.getByRole("button", { name: "Wind loop", exact: true }).click();
  await page
    .getByRole("button", { name: "Recorded accent", exact: true })
    .click();
  await page.getByRole("button", { name: "Chord cue", exact: true }).click();
  await page
    .getByRole("button", { name: "Pause / resume scene", exact: true })
    .click();
  const before = (await lab(page)).diagnostics.position!.beat;
  await expect
    .poll(async () => (await lab(page)).diagnostics.position!.beat)
    .toBeGreaterThan(before + 0.5);
  expect(
    await page.evaluate(
      () => window.__yage__!.inspector.getSceneStack().at(-1)!.paused,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Pause / resume scene", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause / resume music", exact: true })
    .click();
  const paused = await lab(page);
  await expect
    .poll(async () => (await audio(page)).currentTime)
    .toBeGreaterThan(paused.audio.currentTime + 0.3);
  expect((await lab(page)).diagnostics.position!.beat).toBe(
    paused.diagnostics.position!.beat,
  );
  await page
    .getByRole("button", { name: "Pause / resume music", exact: true })
    .click();
  await page.getByRole("button", { name: "Change song", exact: true }).click();
  await expect
    .poll(async () => (await lab(page)).diagnostics.song, { timeout: 6000 })
    .toBe("Straight four");
  await page
    .getByRole("button", { name: "Measure offline mix", exact: true })
    .click();
  await expect.poll(async () => (await lab(page)).offline).not.toBeNull();
  const first = (await lab(page)).offline!;
  expect(first.duration).toBe(5);
  expect(first.samplePeak).toBeGreaterThan(0.01);
  expect(first.samplePeak).toBeLessThan(1);
  expect(first.rms).toBeGreaterThan(0);
  expect(first.clippedSamples).toBe(0);
  expect(first.nonFiniteSamples).toBe(0);
  await page
    .getByRole("button", { name: "Measure offline mix", exact: true })
    .click();
  await expect.poll(async () => (await lab(page)).measuring).toBe(false);
  const second = (await lab(page)).offline!;
  expect(second.samplePeak).toBeCloseTo(first.samplePeak, 7);
  expect(second.rms).toBeCloseTo(first.rms, 7);
  expect(second.clippedSamples).toBe(0);
  expect(second.nonFiniteSamples).toBe(0);
  await page
    .getByRole("button", { name: "Pause / resume music channel", exact: true })
    .click();
  const channelPaused = await lab(page);
  await expect
    .poll(async () => (await audio(page)).currentTime)
    .toBeGreaterThan(channelPaused.audio.currentTime + 0.5);
  expect((await lab(page)).diagnostics.position!.beat).toBe(
    channelPaused.diagnostics.position!.beat,
  );
  expect(
    (await audio(page)).channels
      .filter((c) => c.name !== "sfx")
      .every((c) => c.voices === 0),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Pause / resume music channel", exact: true })
    .click();
  expect((await lab(page)).diagnostics.state).toBe("playing");
  expect((await audio(page)).failures).toEqual([]);
  expect(
    await page.evaluate(
      () => window.__yage__!.inspector.getErrors().callbackErrors,
    ),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Remove audio owner", exact: true })
    .click();
  await expect.poll(async () => (await audio(page)).activeVoices).toBe(0);
  await expect.poll(async () => (await audio(page)).schedulerCount).toBe(0);
  expect((await audio(page)).channels.map((c) => c.name)).toEqual([
    "sfx",
    "music",
  ]);
  expect(errors).toEqual([]);
});
