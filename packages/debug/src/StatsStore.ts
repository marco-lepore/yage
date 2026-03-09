import type { StatsApi } from "./types.js";

const WINDOW_SIZE = 120;

interface RingBuffer {
  data: Float64Array;
  count: number;
  index: number;
}

/** Rolling-window statistics store backed by Float64Array ring buffers. */
export class StatsStore implements StatsApi {
  private rings = new Map<string, RingBuffer>();

  push(key: string, value: number): void {
    let ring = this.rings.get(key);
    if (!ring) {
      ring = { data: new Float64Array(WINDOW_SIZE), count: 0, index: 0 };
      this.rings.set(key, ring);
    }
    ring.data[ring.index] = value;
    ring.index = (ring.index + 1) % WINDOW_SIZE;
    if (ring.count < WINDOW_SIZE) ring.count++;
  }

  average(key: string): number {
    const ring = this.rings.get(key);
    if (!ring || ring.count === 0) return 0;
    const { data, count } = ring;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += data[i] ?? 0;
    return sum / count;
  }

  latest(key: string): number {
    const ring = this.rings.get(key);
    if (!ring || ring.count === 0) return 0;
    return ring.data[(ring.index - 1 + WINDOW_SIZE) % WINDOW_SIZE] ?? 0;
  }

  min(key: string): number {
    const ring = this.rings.get(key);
    if (!ring || ring.count === 0) return 0;
    const { data, count } = ring;
    let m = Infinity;
    for (let i = 0; i < count; i++) {
      const v = data[i] ?? 0;
      if (v < m) m = v;
    }
    return m;
  }

  max(key: string): number {
    const ring = this.rings.get(key);
    if (!ring || ring.count === 0) return 0;
    const { data, count } = ring;
    let m = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = data[i] ?? 0;
      if (v > m) m = v;
    }
    return m;
  }
}
