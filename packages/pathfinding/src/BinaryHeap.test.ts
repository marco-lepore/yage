import { describe, expect, it } from "vitest";
import { BinaryHeap } from "./BinaryHeap.js";

describe("BinaryHeap", () => {
  it("pops in ascending key order", () => {
    const heap = new BinaryHeap<number>((a, b) => a - b);
    for (const n of [5, 1, 4, 2, 3]) heap.push(n);

    const popped: number[] = [];
    let v: number | undefined;
    while ((v = heap.pop()) !== undefined) popped.push(v);

    expect(popped).toEqual([1, 2, 3, 4, 5]);
  });

  it("is FIFO-stable for equal keys", () => {
    interface Item {
      key: number;
      label: string;
    }
    const heap = new BinaryHeap<Item>((a, b) => a.key - b.key);
    heap.push({ key: 1, label: "a" });
    heap.push({ key: 1, label: "b" });
    heap.push({ key: 1, label: "c" });

    expect(heap.pop()?.label).toBe("a");
    expect(heap.pop()?.label).toBe("b");
    expect(heap.pop()?.label).toBe("c");
  });

  it("returns undefined when popping an empty heap", () => {
    const heap = new BinaryHeap<number>((a, b) => a - b);
    expect(heap.pop()).toBeUndefined();
  });

  it("tracks size across pushes and pops", () => {
    const heap = new BinaryHeap<number>((a, b) => a - b);
    expect(heap.size).toBe(0);
    heap.push(1);
    heap.push(2);
    expect(heap.size).toBe(2);
    heap.pop();
    expect(heap.size).toBe(1);
  });
});
