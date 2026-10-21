# @yagejs-addons/music

Requires `@yagejs/core` and `@yagejs/audio`. `MusicComponent(song, options?)`
owns a `MusicPlayer`. Add it to an entity after preloading or registering sources.
All tracks accept `SoundRef`: alias strings or preloaded `sound(path)` handles.

```ts yage-context="entity"
import { MusicComponent, type MusicSong } from "@yagejs-addons/music";
const song: MusicSong = {
  id: "workshop",
  bpm: 108,
  meter: [3, 4],
  bars: 2,
  gain: 0.6,
  swing: { subdivision: 0.5, amount: 1 / 3 },
  tracks: {
    keys: { source: "keys", notes: [{ beat: 0, note: 60, duration: 2 }] },
    pulse: {
      source: "kick",
      parameter: "intensity",
      notes: [{ beat: 0 }, { beat: 3 }],
    },
  },
  harmony: [{ beat: 0, chord: [60, 64, 67] }],
};
const music = entity.add(
  new MusicComponent(song, { seed: 42, humanize: 0.003 }),
);
music.player.setParameter("intensity", 0.8);
```

Sources must exist before playback. Unknown aliases, parameters and invalid
numeric inputs throw before replacing playback. `MusicComponent.player` is
available after attachment. A configured song starts on enable, stops on
disable, and restarts from beat zero when enabled again. Destroy disposes the
player, child channels, booked voices and scheduler subscription.

## Song and track data

- `MusicSong`: optional id, bpm (default 120, range 20–400), meter ([4,4]), bars
  (1), gain (1), swing, harmony; required tracks record. Pattern repeats.
- Beat positions and durations count quarter notes, even in 6/8. Bar length is
  numerator × 4 / denominator. Numerator 1–32; denominator 1,2,4,8,16,32.
  Bars is an integer 1–1024. Notes must start inside the pattern.
- Swing `{ subdivision, amount }`: subdivision in quarter beats, amount 0–0.75.
  Delay the second subdivision by amount × subdivision. Eighth swing uses 0.5;
  amount 1/3 gives 2:1. Pattern length must contain whole subdivision pairs.
- Track: source, notes, rootNote (MIDI 60), gain (1), pan (0), sustain (false),
  release (0.05 seconds), parameter?, parameterRange? ([0,1]). The parameter
  maps linearly from silence to track gain, clamped at its endpoints.
- Note: beat, optional MIDI note (omit for original sample rate), duration (1),
  velocity (1). `sustain` loops the source's registered region until release;
  otherwise a short recording may finish before the authored duration.
- Harmony entries: beat and chord (MIDI pitches); first entry must start at 0.
  Harmony repeats with the pattern. It affects harmony-following cues, not
  track note pitches.

## Player controls

`new MusicPlayer(audio, options?)` can also be owned directly. Options: channel
(default music), seed (uint32, 1), humanize (onset jitter seconds 0–0.02, default
0), parameters (named 0–1 values). Dispose a directly owned player yourself.
No separate audio context, timer or music service is created.

- `play(song, { at?, fade? }?)`: replace playback; omitted at starts after unlock
  with a 30 ms lead. Explicit at is absolute audio time at or after now.
- `transition(song, { grid?: number | "bar", fade?: number }?): number`:
  return scheduled time; default next bar beyond audio lookahead, fade 0.25 s.
  Destination starts at beat zero. Both songs retain their own meter and tempo.
- `setParameter(name, value, { at?, duration? }?)`: named layer gain update;
  default duration 0.05 s. It affects voices already booked on that layer.
- `cue(source, { grid?, note?, rootNote?, volume?, followHarmony? }?)` returns
  a SoundHandle. Default grid 0.5 quarter beats, rootNote 60, volume 1. With
  followHarmony, note is required and snaps to the nearest chord tone at the
  future cue time. Cue belongs to that song and stops with it.
- `pause()` cancels sounding/booked notes and holds the beat. `resume()` resumes
  with the next note; it does not reconstruct notes that were already sounding.
  Cue and transition reject while paused. `stop()` also clears pending intent.
- `position(time?)`: beat, zero-based bar, beatInBar, phase, bpm, or null before
  start. `harmonyAt(time?)` gives MIDI chord tones. `quantize(grid?, time?)`
  returns an absolute audio time. These read-only queries expect valid times.
- `getDiagnostics()`: state, song, position, parameters, scheduledNotes,
  droppedNotes, transitions. Seeded jitter stays reproducible after missed notes.

Parent channel pause holds the transport and parameter ramps; it composes with
explicit player pause. Scene pause and time scale do not affect music. Browser context suspension
freezes its clock. Slow scheduling skips missed notes and increments droppedNotes;
it does not replay them in a burst. Locked play requests retain only the newest
song. Explicit music pause is separate from context and scene pause.

## Offline playback and save ownership

```ts
import { renderAudio } from "@yagejs/audio";
import { MusicPlayer, type MusicSong } from "@yagejs-addons/music";
const song: MusicSong = {
  tracks: { beat: { source: "kick", notes: [{ beat: 0 }] } },
};
const buffer = await renderAudio({ duration: 4 }, (audio) => {
  const music = new MusicPlayer(audio, { seed: 42 });
  music.play(song, { at: 0 });
  audio.updateSchedule(0, 4);
});
```

Sources must already be registered. Book parameter writes/transitions before
`updateSchedule` over the render horizon. Include releases in the duration if
you want their full tails. Use `measureAudio` for sample metrics; see the audio
reference for measurement limits.

Playback is transient. Keep the desired song id and parameter values in the
game's explicit save root, then recreate playback from that data. Do not save a
player, component, channel, SoundHandle or AudioBuffer.
