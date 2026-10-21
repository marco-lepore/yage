# @yagejs/audio

Depends on `@yagejs/core`. Native Web Audio playback with audio-clock scheduling.
The module imports in Node; installing `AudioPlugin` requires browser Web Audio.
Assets contain `AudioBuffer`. Recorded and generated sources share one graph.

## Setup

```ts yage-context="engine"
import { AudioPlugin } from "@yagejs/audio";

engine.use(
  new AudioPlugin({
    masterVolume: 1, // default: 1, finite 0–1
    channels: {
      sfx: { volume: 1 },
      music: { volume: 0.7 },
    },
    autoMuteOnBlur: true, // default: true — pause AudioContext on window blur
  }),
);
```

## Unlock & Tab Mute

AudioPlugin requests resume on pointer, touch and keyboard gestures. Resume may be asynchronous. Booked sources wait on the frozen context clock. Use `onUnlock` to wait for a running context:

```ts yage-context="scene-enter"
import { AudioManagerKey } from "@yagejs/audio";

const audio = this.use(AudioManagerKey);
const startMusic = () => {
  audio.play("music/title", { channel: "music", loop: true });
};

audio.isUnlocked(); // boolean — AudioContext.state === "running"
audio.onUnlock(startMusic);
audio.offUnlock(startMusic); // remove a pending listener (disposer from onUnlock also works)

audio.autoMuteOnBlur = true; // default true; suspends the context on blur or hidden-tab notification
```

- `onUnlock(cb)` fires synchronously if already unlocked; otherwise once on the first gesture that resumes the context. Returns a disposer.
- `isUnlocked()` is false whenever the context is suspended, including visibility suspension.
- Focus resumes a previously unlocked context. Changing `autoMuteOnBlur` applies on the next focus/visibility event.
- Pausing scenes on tab blur is a scene-lifecycle concern, not an audio one: use `SceneManager.autoPauseOnBlur` (see `core.md`).

## Asset Factory

```ts
import { sound } from "@yagejs/audio";

const CoinSfx = sound("assets/coin.wav");
// Add to scene preload: readonly preload = [CoinSfx];
```

## AudioManager

```ts yage-context="scene-enter"
import { AudioManagerKey, sound } from "@yagejs/audio";
import type { AudioPlayOptions } from "@yagejs/audio";

const CoinSfx = sound("assets/coin.wav");
const opts: AudioPlayOptions = { channel: "sfx" };
const audio = this.use(AudioManagerKey);

// Play — takes a `sound()` handle or the alias string it registers
const handle = audio.play(CoinSfx, {
  channel: "sfx",
  volume: 1,
  loop: false,
  speed: 1,
});
const next = audio.crossfade(handle, "music/next", {
  duration: 1.2,
  channel: "music",
  loop: true,
});
audio.playOnce(CoinSfx, opts); // skips playback if already playing
const request = audio.requestOnce(CoinSfx, opts); // one releasable request for shared playback
audio.playRandom([CoinSfx, "assets/step.wav"], opts); // random pick

request.active; // boolean
request.release({ fadeOut: 0.02 }); // fade only if this is the final owner

// SoundHandle
handle.playing; // boolean
handle.channel; // readonly mixer channel
handle.volume; // get/set, per-sound volume before the channel multiplier
handle.speed; // get/set
handle.paused; // get/set
handle.muted; // get/set
handle.fadeTo(0, { duration: 0.6, stopOnComplete: true }); // returns void
handle.stop();

// Stop
audio.stop(handle);
audio.stopChannel("sfx");
audio.stopAll();

// Master and channel volume
audio.masterVolume = 0.5;
audio.masterVolume; // get/set, default: 1
audio.getChannelNames(); // readonly string[], fresh snapshot in creation order
audio.setChannelVolume("music", 0.5);
audio.getChannelVolume("music");

// Mute
audio.muteChannel("sfx");
audio.unmuteChannel("sfx");
audio.muteAll();
audio.unmuteAll();

// Pause
audio.pauseChannel("music");
audio.resumeChannel("music");
```

Automation options: `{ at?: number; duration?: number; curve?: "linear" | "exponential" }`.
`at` is absolute audio-context seconds; omitted or past automation times mean
now. Duration defaults to 0. An explicit past `crossfade` start throws.
Exponential ramps require positive endpoints. `fadeTo` requires duration and
optionally `stopOnComplete` (only with target 0); it returns void.

`AudioConfig.masterVolume?: number` sets the initial master volume (default 1).
`AudioManager.masterVolume` accepts finite values from 0 to 1 and throws before
changing state for invalid inputs. Playback volume is `masterVolume × channel
volume × SoundHandle.volume`. Master volume affects this manager's playing and
future sounds, including channels created later. It preserves channel and
sound volumes, active fades, and mute/pause state. It does not control external
audio contexts or playback outside this manager.

`getChannelNames(): readonly string[]` returns a fresh snapshot of configured
and subsequently created channels in creation order, including silent channels.
Playing a sound or setting a channel's volume, mute or pause state creates an
unknown channel. `getChannelVolume(name)` returns 1 for an unknown channel
without creating it.

`SoundHandle.volume` is the 0–1 value before channel and master gains. Writes
replace future automation from the supplied `at` onward. Setting the current
value cancels a ramp. `crossfade` fades the incoming sound from 0 to its target,
fades and stops the outgoing sound, and returns the incoming handle immediately.
It inherits the outgoing channel unless a channel is supplied.

Fades run on audio time, independent of scene pause and game time scale.
Context suspension freezes time. Handle/channel pause holds playback position
and automation until resume. Invalid numeric inputs throw before state changes.

`play`, `playOnce`, `requestOnce`, and `playRandom` throw naming the alias when no sound is registered under it — a typo, or playback before the asset finished preloading. Preload it with `sound(path)` or register it with `registerSound(alias, buffer)`.

`hasSound(ref)` reports whether an alias is registered, which is the check those throws make. It takes an alias or a `sound()` handle, so a game that assembles an alias at runtime — one variant per surface, per weapon, per language — can choose a fallback rather than risk the throw. It reports nothing about whether audio is audible: the browser's autoplay unlock is `isUnlocked()`, and mute is `muteChannel` / `muteAll`.

`playOnce` and `requestOnce` share one playback for each alias and channel.
`playOnce` holds one implicit owner; repeated calls return the same
`SoundHandle` without adding owners. Each `requestOnce` call returns an
independent `SoundRequestHandle`. Releasing a request stops the shared sound
only when no requests or `playOnce` owner remain. Natural completion makes all
request handles inactive and calls `onEnd` for each request that was still
active. A released request receives no callback. Stopping the shared
`SoundHandle`, its channel, or all audio makes every request inactive.

`request.release({ fadeOut: seconds })` accepts `SoundRequestReleaseOptions`.
`fadeOut` must be finite and non-negative; omitting it or passing zero stops
immediately when the final owner releases. Other requests and `playOnce` owners keep the recording playing
at its current volume. Only the final request's fade applies.

The final request remains `active` through its fade, then becomes inactive when
the sound stops or ends. A released request receives no `onEnd` callback,
including if the recording ends during its fade. A new `requestOnce` or
`playOnce` call during the fade starts a fresh recording. Channel controls still
apply to both recordings.

## Runtime sounds

**`registerSound(alias, buffer)` / `unregisterSound(alias)`** — register a runtime-generated `AudioBuffer` under an alias so it resolves and plays exactly like a preloaded sound, through the same `AudioManager` channels, mute, and blur auto-pause. Audio analogue of the renderer's `registerTexture(key, texture)`.

```ts yage-context="scene-enter"
import { registerSound, AudioManagerKey } from "@yagejs/audio";
import { synthBuffer, synthPresets } from "@yagejs-addons/synth";

// Any code that produces an AudioBuffer; here, @yagejs-addons/synth
const buffer = synthBuffer(synthPresets.shoot());
registerSound("shoot", buffer);

const audio = this.use(AudioManagerKey);
audio.play("shoot");
```

Semantics:

- Runtime buffers are not persisted by YAGE. If game-owned save data contains
  an alias, re-register the buffer under that alias before reconstructing
  playback.
- Callable at module scope, before `AudioPlugin` installs: the buffer is available once a manager is created.
- Registered aliases are engine-global and live until `unregisterSound(alias)`.
- `unregisterSound` is a no-op for aliases it never registered. An `AudioBuffer` has no destroy step, so unlike `unregisterTexture` there is nothing to release beyond the alias itself.
- Re-registering an alias replaces the entry.
- Registering an alias already used by a loaded sound asset throws. Unloading
  that asset removes its alias; already-playing voices retain their buffer.

## SoundComponent

Entity-bound audio. Auto-stops on entity destroy.

```ts yage-context="entity"
import { SoundComponent, sound } from "@yagejs/audio";

const CoinSfx = sound("assets/coin.wav");

entity.add(
  new SoundComponent({
    alias: CoinSfx.path,
    channel: "sfx",
    playOnAdd: true,
    loop: false,
    volume: 1,
  }),
);

// Control
const sc = entity.get(SoundComponent);
sc.play(); // returns SoundHandle
sc.stop();
sc.handle; // SoundHandle | null

// Read the config back (also what the Inspector reports for the component)
sc.alias;
sc.channel;
sc.loop;
sc.volume;
```

## Exact scheduling, layers and diagnostics

- `audio.currentTime`, `audio.sampleRate`: context seconds and samples/second.
- `play(ref, { at, offset, stopAt, loopStart, loopEnd, pan, ... })`: absolute start,
  buffer offset, absolute stop, loop region in seconds, stereo pan −1..1.
  Past starts begin now and increment `lateStarts`. `stop()` cancels booked starts.
- `handle.scheduled`: active start lies in the future; `playing` includes paused
  and booked voices. `handle.setVolume`, `setSpeed`, `setPan` accept automation
  options. Speed must remain finite and positive at Web Audio's 32-bit float
  precision. `release(at?, duration = 0.05)` fades
  to zero and stops. `stop(at?)` can book a stop.
- `createChannel(name, { parent?, volume? })`: unique named channel; parent must
  already exist. `removeChannel(name)` stops and removes descendants.
- Parent gain/mute changes affect booked voices. Parent pause/stop propagates.
  Configured channels augment defaults `sfx: 1`, `music: 0.7`.
- `setChannelVolume(name, volume, automation?)`: gain automation on all voices.
- `registerSound(alias, buffer, { loopStart, loopEnd }?)`: default sustain region
  used when `play` sets `loop: true`; play options can override the region.
- `addScheduler((now, horizon) => void): () => void`: independent of scene time.
  Defaults: `AudioConfig.lookahead = 0.12`, `tickInterval = 0.025` seconds;
  both positive finite, interval < lookahead. The plugin owns timer cleanup.
- `updateSchedule(now?, horizon?)`: explicitly book work, including offline plans.
- `getDiagnostics()`: state/time, active/scheduled voices, schedulerCount,
  lateStarts, channels and recent callback failures. Inspector extension `audio`
  exposes `getDiagnostics`. `invoke(operation, callback)` attributes higher-layer
  callbacks through ErrorBoundary. Unlock/scheduler/onEnd callbacks also use it.
- `dispose()` stops voices and releases nodes, subscribers and pending unlocks.

## Offline graph rendering

```ts
import { renderAudio, measureAudio } from "@yagejs/audio";
const buffer = await renderAudio(
  { duration: 3, sampleRate: 44100, channels: 2 },
  (audio) => {
    const voice = audio.play("loop", { loop: true, volume: 0.2 });
    voice.setSpeed(1.5, { at: 1, duration: 0.5 });
    voice.release(2.5, 0.2);
  },
);
const metrics = measureAudio(
  [buffer.getChannelData(0), buffer.getChannelData(1)],
  buffer.sampleRate,
);
```

`renderAudio(options, plan)` returns `Promise<AudioBuffer>`; optional `mix` is
`AudioConfig`. Preload/register sources first. Book every operation synchronously
in the plan. Native offline rendering uses the same graph, without a timer or
implicit compressor. `measureAudio` returns duration, samplePeak, rms,
clippedSamples (absolute value >= 1), nonFiniteSamples. These are sample metrics,
not true peak or standardized loudness. Only the supplied plan is reproduced.
Native rendering can differ by small floating-point amounts between runs or
browsers; compare measurements with a numerical tolerance.

## Custom automation and pause-aware sequencing

`onChannelPause(name, callback)` reports effective channel pause, including its
parents. It calls the callback immediately and on changes, and returns an
unsubscribe function. A sequencer can hold its transport while that channel is
paused. Callbacks use the audio error boundary.

`AudioTimeline` is the shared numeric automation planner used by audio controls
and the music addon. Construct it with an initial finite value. `set(value, at,
duration?, curve?)` replaces automation from `at`; `valueAt(time)`, `integral(from,
to)`, and `events(from)` query its value, area and detached future points.
`prune(time)` discards elapsed history; consume any required integral first.
`shift(from, delta)` holds the value at `from` and moves future points by `delta`.
`apply(param, now)` submits the timeline to an AudioParam. Queries require valid
finite times; results outside retained history are undefined. This planner does
not create an audio context or timer.

## Exported sound banks

- `sound(path, loop?: SoundLoop): AssetHandle<AudioBuffer>` accepts paired
  `loopStart`/`loopEnd` in seconds. Loop defaults follow the handle through
  preloading and apply when playback sets `loop: true`.
- `parseSoundBankManifest(unknown): SoundBankManifest` validates version 1,
  numeric metadata, WAV filenames and loop regions; returns a copy.
- `soundBank(unknownManifest, baseDirectoryUrl): SoundBank` returns
  `{ manifest, sounds: Record<string, AssetHandle<AudioBuffer>> }`. No I/O.
  Base URL must end in `/`. Put `Object.values(bank.sounds)` in Scene.preload.
- Bank keys are local names, not registered aliases. Pass the handles to
  playback. Use entry `rootNote` for music track tuning; it does not retune audio.
- `@yagejs-tools/audio` produces the manifest and WAVs. See
  [audio builds](../tools/audio.md) for build and complete playback setup.
- The sound loader and AssetManager own decoding, reference counting and
  unload. Handles for the same file must agree on loop metadata.
