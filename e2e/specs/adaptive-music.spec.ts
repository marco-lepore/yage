import { expect, test, type Page } from "@playwright/test";
import type {
  AudioDiagnostics,
  AudioMeasurements,
  SoundMetadata,
} from "@yagejs/audio";
import type { MusicDiagnostics } from "@yagejs-addons/music";

interface MusicProbe {
  music: MusicDiagnostics;
  mixer: AudioDiagnostics;
  soundMetadata: Record<string, SoundMetadata | null>;
  paused: boolean;
  offlineMix: AudioMeasurements | null;
  measuring: boolean;
}

const probe = (page: Page): Promise<MusicProbe> =>
  page.evaluate(
    () =>
      window.__yage__!.inspector.getComponentData(
        "MusicHostEntity",
        "MusicProbe",
      ) as MusicProbe,
  );
// Reads the mixer through the inspector extension, which outlives the host.
const mixer = (page: Page): Promise<AudioDiagnostics> =>
  page.evaluate(() =>
    window
      .__yage__!.inspector.getExtension<{
        getDiagnostics(): AudioDiagnostics;
      }>("audio")!
      .getDiagnostics(),
  );
const click = (page: Page, name: string): Promise<void> =>
  page.getByRole("button", { name, exact: true }).click();

test("adaptive music follows gameplay, holds its beat while paused, and stops with its entity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/adaptive-music.html");
  await page.waitForFunction(
    () =>
      window.__yage__?.inspector?.getComponentData(
        "MusicHostEntity",
        "MusicProbe",
      ) !== undefined,
  );

  // SynthPlugin registered every sound with the root note of its pitch and,
  // for sustained sounds, the loop the music player holds.
  const sounds = (await probe(page)).soundMetadata;
  expect(Object.keys(sounds)).toHaveLength(9);
  expect(sounds["bass"]!.rootNote).toBeCloseTo(48, 3);
  expect(sounds["flute"]!.rootNote).toBeCloseTo(72, 3);
  expect(sounds["keys"]!.rootNote).toBeCloseTo(60, 3);
  // The example's own hi-hat ignores pitch, so it has no root note.
  expect(sounds["hat"]).toEqual({});
  expect(sounds["wind"]!.loopEnd).toBeGreaterThan(sounds["wind"]!.loopStart!);

  // A trusted click resumes the audio context and starts the song.
  await page.locator("canvas").click();
  await expect.poll(async () => (await mixer(page)).state).toBe("running");
  await expect
    .poll(async () => (await probe(page)).music.scheduledNotes)
    .toBeGreaterThan(0);

  await page.getByRole("combobox", { name: "Lead" }).selectOption("flute");
  await expect.poll(async () => (await probe(page)).music.transitions).toBe(1);
  await page.getByRole("slider", { name: "Danger" }).fill("0.85");
  await expect
    .poll(async () => (await probe(page)).music.parameters["intensity"])
    .toBe(0.85);
  await click(page, "Collect reward");

  // Pausing the game holds the beat while audio time keeps running.
  await click(page, "Pause game");
  const paused = await probe(page);
  expect(paused.paused).toBe(true);
  expect(paused.music.state).toBe("paused");
  expect(
    await page.evaluate(
      () => window.__yage__!.inspector.getSceneStack().at(-1)!.paused,
    ),
  ).toBe(true);
  // A paused player rejects cues and transitions, so their controls wait.
  await expect(page.getByRole("combobox", { name: "Lead" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Enter new area", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(async () => (await mixer(page)).currentTime)
    .toBeGreaterThan(paused.mixer.currentTime + 0.5);
  expect((await probe(page)).music.position!.beat).toBe(
    paused.music.position!.beat,
  );
  // The music player stops its notes; the paused wind loop keeps its voice.
  expect(
    (await mixer(page)).channels
      .filter((c) => c.name !== "sfx" && c.name !== "ambience")
      .every((c) => c.voices === 0),
  ).toBe(true);
  await click(page, "Resume game");
  expect((await probe(page)).music.state).toBe("playing");
  await expect
    .poll(async () => (await probe(page)).music.position!.beat)
    .toBeGreaterThan(paused.music.position!.beat);

  await click(page, "Enter new area");
  await expect
    .poll(async () => (await probe(page)).music.song, { timeout: 6000 })
    .toBe("Straight four");

  // The offline render is reproducible and stays below clipping.
  await click(page, "Measure offline mix");
  await expect.poll(async () => (await probe(page)).offlineMix).not.toBeNull();
  const first = (await probe(page)).offlineMix!;
  expect(first.duration).toBe(5);
  expect(first.samplePeak).toBeGreaterThan(0.01);
  expect(first.samplePeak).toBeLessThan(1);
  expect(first.rms).toBeGreaterThan(0);
  expect(first.clippedSamples).toBe(0);
  expect(first.nonFiniteSamples).toBe(0);
  await click(page, "Measure offline mix");
  await expect.poll(async () => (await probe(page)).measuring).toBe(false);
  const second = (await probe(page)).offlineMix!;
  expect(second.samplePeak).toBeCloseTo(first.samplePeak, 7);
  expect(second.rms).toBeCloseTo(first.rms, 7);

  expect((await mixer(page)).failures).toEqual([]);
  expect(
    await page.evaluate(
      () => window.__yage__!.inspector.getErrors().callbackErrors,
    ),
  ).toEqual([]);

  // Destroying the music host stops its song, its wind and its scheduler.
  await click(page, "Remove music entity");
  await expect.poll(async () => (await mixer(page)).activeVoices).toBe(0);
  await expect.poll(async () => (await mixer(page)).schedulerCount).toBe(0);
  expect((await mixer(page)).channels.map((c) => c.name)).toEqual([
    "sfx",
    "music",
    "ambience",
  ]);
  expect(errors).toEqual([]);
});
