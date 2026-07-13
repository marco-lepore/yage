/**
 * Binary min-heap. `compare` orders elements the way `Array.prototype.sort`
 * does (negative = `a` before `b`); when it returns 0, the heap breaks the
 * tie by insertion order, so pushes with equal priority pop out FIFO.
 */
export class BinaryHeap<T> {
  private readonly items: { value: T; seq: number }[] = [];
  private nextSeq = 0;

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(value: T): void {
    this.items.push({ value, seq: this.nextSeq++ });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      this.bubbleDown(0);
    }
    return top.value;
  }

  private less(a: { value: T; seq: number }, b: { value: T; seq: number }): boolean {
    const c = this.compare(a.value, b.value);
    return c !== 0 ? c < 0 : a.seq < b.seq;
  }

  private bubbleUp(index: number): void {
    const items = this.items;
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  private bubbleDown(index: number): void {
    const items = this.items;
    const n = items.length;
    let i = index;
    for (;;) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;
      if (left < n && this.less(items[left]!, items[smallest]!)) smallest = left;
      if (right < n && this.less(items[right]!, items[smallest]!)) smallest = right;
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest]!, items[i]!];
      i = smallest;
    }
  }
}
