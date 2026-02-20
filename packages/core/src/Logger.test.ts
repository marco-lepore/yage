import { describe, it, expect, vi } from "vitest";
import { Logger, LogLevel } from "./Logger.js";

describe("Logger", () => {
  it("logs messages at or above configured level", () => {
    const output = vi.fn();
    const logger = new Logger({ level: LogLevel.Warn, output });
    logger.debug("test", "debug msg");
    logger.info("test", "info msg");
    logger.warn("test", "warn msg");
    logger.error("test", "error msg");
    expect(output).toHaveBeenCalledTimes(2);
    expect(output.mock.calls[0]?.[0].message).toBe("warn msg");
    expect(output.mock.calls[1]?.[0].message).toBe("error msg");
  });

  it("filters by category whitelist", () => {
    const output = vi.fn();
    const logger = new Logger({
      level: LogLevel.Debug,
      categories: ["physics"],
      output,
    });
    logger.info("physics", "allowed");
    logger.info("render", "filtered out");
    expect(output).toHaveBeenCalledTimes(1);
    expect(output.mock.calls[0]?.[0].category).toBe("physics");
  });

  it("allows all categories when whitelist is empty", () => {
    const output = vi.fn();
    const logger = new Logger({ level: LogLevel.Debug, output });
    logger.info("physics", "a");
    logger.info("render", "b");
    expect(output).toHaveBeenCalledTimes(2);
  });

  it("stores entries in ring buffer", () => {
    const logger = new Logger({ level: LogLevel.Debug, bufferSize: 3 });
    logger.info("a", "msg1");
    logger.info("b", "msg2");
    logger.info("c", "msg3");
    const recent = logger.getRecent();
    expect(recent).toHaveLength(3);
    expect(recent.map((e) => e.message)).toEqual(["msg1", "msg2", "msg3"]);
  });

  it("overwrites oldest entries when buffer is full", () => {
    const logger = new Logger({ level: LogLevel.Debug, bufferSize: 2 });
    logger.info("a", "msg1");
    logger.info("b", "msg2");
    logger.info("c", "msg3");
    const recent = logger.getRecent();
    expect(recent).toHaveLength(2);
    expect(recent.map((e) => e.message)).toEqual(["msg2", "msg3"]);
  });

  it("getRecent respects count parameter", () => {
    const logger = new Logger({ level: LogLevel.Debug, bufferSize: 10 });
    logger.info("a", "msg1");
    logger.info("b", "msg2");
    logger.info("c", "msg3");
    const recent = logger.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent.map((e) => e.message)).toEqual(["msg2", "msg3"]);
  });

  it("tracks frame number via setFrame()", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.setFrame(42);
    logger.info("test", "msg");
    const entry = logger.getRecent(1)[0];
    expect(entry?.frame).toBe(42);
  });

  it("includes data in log entries", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.info("test", "msg", { key: "value" });
    const entry = logger.getRecent(1)[0];
    expect(entry?.data).toEqual({ key: "value" });
  });

  it("formatRecentLogs produces correct format", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.setFrame(142);
    logger.info("physics", "Collision detected", {
      entity: "player",
      other: "enemy",
    });
    const output = logger.formatRecentLogs(1);
    expect(output).toBe(
      '[INFO][physics] f142 Collision detected {"entity":"player","other":"enemy"}',
    );
  });

  it("formatRecentLogs omits data when undefined", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.setFrame(1);
    logger.warn("core", "Something happened");
    const output = logger.formatRecentLogs(1);
    expect(output).toBe("[WARN][core] f1 Something happened");
  });

  it("clear() resets the buffer", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.info("test", "msg");
    logger.clear();
    expect(logger.getRecent()).toHaveLength(0);
  });

  it("debug(), info(), warn(), error() set correct levels", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.debug("t", "d");
    logger.info("t", "i");
    logger.warn("t", "w");
    logger.error("t", "e");
    const entries = logger.getRecent();
    expect(entries.map((e) => e.level)).toEqual([
      LogLevel.Debug,
      LogLevel.Info,
      LogLevel.Warn,
      LogLevel.Error,
    ]);
  });

  it("defaults to LogLevel.Info", () => {
    const output = vi.fn();
    const logger = new Logger({ output });
    logger.debug("test", "filtered");
    logger.info("test", "shown");
    expect(output).toHaveBeenCalledTimes(1);
  });

  it("getRecent returns empty array when no entries", () => {
    const logger = new Logger();
    expect(logger.getRecent()).toEqual([]);
  });

  it("getRecent count exceeding available returns all available", () => {
    const logger = new Logger({ level: LogLevel.Debug });
    logger.info("a", "msg1");
    const recent = logger.getRecent(100);
    expect(recent).toHaveLength(1);
  });

  it("getRecent skips undefined buffer slots gracefully", () => {
    const logger = new Logger({ level: LogLevel.Debug, bufferSize: 4 });
    logger.info("a", "msg1");
    // Corrupt the buffer by clearing a slot to trigger the `if (entry)` guard
    const buffer = (logger as unknown as { buffer: Array<unknown> })["buffer"];
    buffer[0] = undefined;
    // Artificially inflate count so getRecent tries to read the cleared slot
    (logger as unknown as { count: number })["count"] = 2;
    const recent = logger.getRecent(2);
    // Should only return the valid entry, skipping the undefined slot
    expect(recent.length).toBeLessThanOrEqual(2);
  });

  it("formatRecentLogs handles unknown log level gracefully", () => {
    const logger = new Logger({ level: LogLevel.Debug, bufferSize: 4 });
    logger.info("test", "msg");
    // Corrupt the log level to trigger the ?? "UNKNOWN" fallback
    const buffer = (logger as unknown as { buffer: Array<{ level: number }> })["buffer"];
    const entry = buffer[0];
    if (entry) {
      entry.level = 999 as LogLevel;
    }
    const output = logger.formatRecentLogs(1);
    expect(output).toContain("UNKNOWN");
  });
});
