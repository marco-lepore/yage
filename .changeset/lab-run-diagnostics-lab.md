---
"@yagejs-tools/lab": patch
---

Four fixes to what a scenario run reports and how it plays.

- A failed assertion prints the values it compared in full. A message carrying a
  joined list or a serialized object reaches the `yage-lab test` report whole
  instead of stopping at 40 characters.
- `step(frames, { dtMs })` and `until(predicate, { maxFrames, dtMs })` set the
  milliseconds one frame simulates, for that call only. A drive can exercise a
  frame rate that does not divide into the fixed 1/60s step, which is what it
  takes to catch a reader sampling the simulated pose rather than the
  interpolated one.
- The panel's **real time** checkbox, beside **Run**, plays a driven run at one
  engine frame per browser animation frame, so a long drive shows its motion
  rather than its end state. `yage-lab test` runs every drive unpaced.
- `--screenshot-view camera` captures the camera's virtual viewport at the
  game's virtual resolution, so a PNG's size does not follow the scene's drawn
  extents. The default `content` view keeps those extents and warns when the
  image it would produce exceeds the GPU texture limit. Past that limit a
  capture comes back blank while every scenario still reports passing.
