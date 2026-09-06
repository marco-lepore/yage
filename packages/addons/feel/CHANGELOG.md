# @yagejs-addons/feel

## 0.2.0

### Minor Changes

- [#327](https://github.com/marco-lepore/yage/pull/327) [`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Clarify addon composition and lifecycle contracts.
  - Add `onCancel` to one-shot sprite animation cues and attribute cancellation callbacks through Feel. Completion and cancellation remain notifications; explicit durations still follow cue retiming, and cues without a duration complete immediately.

- [#303](https://github.com/marco-lepore/yage/pull/303) [`7e500d6`](https://github.com/marco-lepore/yage/commit/7e500d635ebde8d9ef63b073234ee285d9176576) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add advanced visual cue helpers to the Feel addon.
  - Add `feelGlitch`, which enters quickly, holds, and refreshes deterministic
    glitch patterns during cue playback. Add `feelDissolve`, which advances a
    dissolve from intact to transparent.
  - Add the `/recipes` entry with `impact`, `damageImpact`, `dashBurst`,
    `spawnPop`, `enemyDeath`, and `voidCollapse` compositions. `voidCollapse`
    stages inward blur, a center-expanding implosion, a short peak hold, and an
    optional color shift.
  - Keep sequence-boundary callbacks behind the cleanup of preceding effects
    when decimal durations differ by floating-point rounding.
  - Refresh `feelGlitch` once for every interval a frame covered. A frame longer
    than one interval previously refreshed a single time and discarded the rest,
    undershooting `refreshRate` and leaving the seeded random source at a
    different point depending on frame cadence.

- [#294](https://github.com/marco-lepore/yage/pull/294) [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Add composable game-feel cues with visual, time, camera, audio, filter, and
  particle effects.
  - Define named cues with parallel and sequential timing, delays, repeats,
    intensity, chance, cooldowns, and retrigger policies.
  - Keep the root entry core-only and provide optional renderer, audio, and
    particle adapters.
  - Add animated outline, glow, and colorize pulses plus floating text, damage
    numbers, and procedural impact rings.
  - Add scale shake and camera rotation pulses through the existing modifier
    owners.
  - Add directional flight lines, sampled motion trails, and fading sprite
    afterimages as temporary world-space visuals.
  - Own visual, camera, filter, sound, and particle feedback through removable
    handles, so cancellation removes only the current playback's contribution.
  - Keep the code-authored component, cue playback, and built-in temporary
    feedback out of save snapshots.

- [#296](https://github.com/marco-lepore/yage/pull/296) [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Expand timing, animation, and transform feedback cues.
  - Add target slow motion, target freeze, selectable hitstop owner updates, named sprite-animation cues, and spring-based position, rotation, and scale feedback.
  - Rename the core animation trigger to `feelKeyframeAnimation` so its target is explicit.

- [#321](https://github.com/marco-lepore/yage/pull/321) [`d557809`](https://github.com/marco-lepore/yage/commit/d557809b68735d1acb639dd9c56e00dec16920d0) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Let Feel cues follow gameplay-owned lifetimes and play-time timing.
  - Scale finite cue timelines with `play(..., { duration })`.
  - Release held states and open loops through the playback handle or `Feel`
    component.
  - Keep held trails and particle emission active until release, and keep sounds
    active until their audio handle or shared request completes.
  - Advance timed SceneTime sequence steps when their retained request expires.
  - Validate fixed flight-line directions when the node is built, and skip a
    timed burst when its live direction is zero or near zero.
  - Share finite pulse timing across renderer pulse builders and `dashBurst`.
  - Drive hit flash through Feel's pulse clock so its peak and easing can be
    configured without starting the preset's self-scheduled trigger ramp.

### Patch Changes

- [#304](https://github.com/marco-lepore/yage/pull/304) [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c) Thanks [@marco-lepore](https://github.com/marco-lepore)! - Remove the renderer snapshot attachment option from Feel-owned temporary effects.

- Updated dependencies [[`d2adfed`](https://github.com/marco-lepore/yage/commit/d2adfedb0e5d15269fe941a3a24f23ddb0126aa4), [`7e500d6`](https://github.com/marco-lepore/yage/commit/7e500d635ebde8d9ef63b073234ee285d9176576), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`dc42ba4`](https://github.com/marco-lepore/yage/commit/dc42ba40cd3bbd04c8ff27bf4e8721f274dde034), [`19c794e`](https://github.com/marco-lepore/yage/commit/19c794e7afa941539efcb4d23d8a9ec49a5233b6), [`b73bc32`](https://github.com/marco-lepore/yage/commit/b73bc32e433f234871bec29ba4a9916194019200), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`daa8214`](https://github.com/marco-lepore/yage/commit/daa821458a69d14176f5c5aebc3f4204348ddb0c), [`c105024`](https://github.com/marco-lepore/yage/commit/c105024b5402c11dc36da52b08f6ab39354da8a5), [`c8ad215`](https://github.com/marco-lepore/yage/commit/c8ad215530681caeb63484cc07b118cd977a5ba5), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`08b0d06`](https://github.com/marco-lepore/yage/commit/08b0d06b63a44a51bd6f8e8308574fd41c96af59), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`7275620`](https://github.com/marco-lepore/yage/commit/7275620756183b22de3df1009e1e07615db9b40e), [`4bab66f`](https://github.com/marco-lepore/yage/commit/4bab66f0e34a387155bbc7168b048dcac167525f), [`cfde97d`](https://github.com/marco-lepore/yage/commit/cfde97de2c94416cb5bbab26a12f9c290e6b66cf), [`33d00e3`](https://github.com/marco-lepore/yage/commit/33d00e37801a300710cc10de0352b1aa1b1ba2f1), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9b9fe07`](https://github.com/marco-lepore/yage/commit/9b9fe07d7f32219c0e9aa37265b526cdc5924ce8), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`9e194ec`](https://github.com/marco-lepore/yage/commit/9e194ec386a74c0f1ad5699c3c0db183aa86f1b1), [`d557809`](https://github.com/marco-lepore/yage/commit/d557809b68735d1acb639dd9c56e00dec16920d0), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`05492cb`](https://github.com/marco-lepore/yage/commit/05492cb8e27f89fe82fedd6e307afa2f90d1f68f), [`aed53f7`](https://github.com/marco-lepore/yage/commit/aed53f7f5679f824846dee3c55c0342f7f07cf98), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`ba57361`](https://github.com/marco-lepore/yage/commit/ba5736175e8b3e06157e680b4b66d10eb8d06823), [`aa5b78e`](https://github.com/marco-lepore/yage/commit/aa5b78e18b56d17bdca4ffb8299c8ea83979e05a), [`439d0e2`](https://github.com/marco-lepore/yage/commit/439d0e205228bee15d8d79607abdba5731b0873b), [`aaf1279`](https://github.com/marco-lepore/yage/commit/aaf1279455bc655681cf15c8edc64b1407b2a823), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8064fa6`](https://github.com/marco-lepore/yage/commit/8064fa64099feeb1d164360b668e0721a14b7bbe), [`8f11936`](https://github.com/marco-lepore/yage/commit/8f119362281bf31ab59b8b907816886922aaf18f), [`b087462`](https://github.com/marco-lepore/yage/commit/b087462ab2ae27bebb7ce274402c9e278f6d472a), [`8bb9e0b`](https://github.com/marco-lepore/yage/commit/8bb9e0b905017ac724f70fc8fe55014605563e88), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`8d7b5e3`](https://github.com/marco-lepore/yage/commit/8d7b5e3fe395898c7f4cbde0b352acc2713e6559), [`b64cd45`](https://github.com/marco-lepore/yage/commit/b64cd453a65a83899b9e8d5fecf4ad43bf1eb3d4), [`ff52a8a`](https://github.com/marco-lepore/yage/commit/ff52a8a4816b18f7de5309ab08606183db67e071)]:
  - @yagejs/renderer@0.11.0
  - @yagejs/effects@0.11.0
  - @yagejs/core@0.11.0
  - @yagejs/audio@0.11.0
  - @yagejs/particles@0.11.0
