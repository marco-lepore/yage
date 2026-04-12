/** Log severity levels. */
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  None = 4,
}

/** Configuration for the Logger. */
export interface LoggerConfig {
  /** Minimum log level. Default: Info. */
  level?: LogLevel;
  /** Category whitelist. Empty = all categories allowed. */
  categories?: string[];
  /** Ring buffer size. Default: 500. */
  bufferSize?: number;
  /** Custom output handler. */
  output?: (entry: LogEntry) => void;
}

/** A single log entry. */
export interface LogEntry {
  /** Log severity level. */
  level: LogLevel;
  /** Category string (e.g., "physics", "core"). */
  category: string;
  /** Log message. */
  message: string;
  /** Optional structured data. */
  data?: unknown;
  /** Timestamp in milliseconds since epoch. */
  timestamp: number;
  /** Game frame number at time of log. */
  frame: number;
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.Debug]: "DEBUG",
  [LogLevel.Info]: "INFO",
  [LogLevel.Warn]: "WARN",
  [LogLevel.Error]: "ERROR",
  [LogLevel.None]: "NONE",
};

/** Structured logger with ring buffer, levels, and category filtering. */
export class Logger {
  private readonly level: LogLevel;
  private readonly categories: Set<string>;
  private readonly bufferSize: number;
  private readonly output: ((entry: LogEntry) => void) | undefined;
  private readonly buffer: LogEntry[];
  private writeIndex = 0;
  private count = 0;
  private currentFrame = 0;

  constructor(config?: LoggerConfig) {
    this.level = config?.level ?? LogLevel.Info;
    this.categories = new Set(config?.categories ?? []);
    this.bufferSize = config?.bufferSize ?? 500;
    this.output = config?.output;
    this.buffer = new Array<LogEntry>(this.bufferSize);
  }

  /** Set the current frame number (incremented externally by the game loop). */
  setFrame(frame: number): void {
    this.currentFrame = frame;
  }

  /** Log a debug message. */
  debug(category: string, message: string, data?: unknown): void {
    this.log(LogLevel.Debug, category, message, data);
  }

  /** Log an info message. */
  info(category: string, message: string, data?: unknown): void {
    this.log(LogLevel.Info, category, message, data);
  }

  /** Log a warning message. */
  warn(category: string, message: string, data?: unknown): void {
    this.log(LogLevel.Warn, category, message, data);
  }

  /** Log an error message. */
  error(category: string, message: string, data?: unknown): void {
    this.log(LogLevel.Error, category, message, data);
  }

  /** Get recent log entries from the ring buffer. */
  getRecent(count?: number): LogEntry[] {
    const available = Math.min(this.count, this.bufferSize);
    const n = count !== undefined ? Math.min(count, available) : available;
    const result: LogEntry[] = [];
    // Read the most recent n entries
    for (let i = 0; i < n; i++) {
      const idx =
        (this.writeIndex - n + i + this.bufferSize) % this.bufferSize;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  /** Format recent logs as structured text for agent consumption. */
  formatRecentLogs(count?: number): string {
    return this.getRecent(count)
      .map((e) => {
        const levelStr = LEVEL_LABELS[e.level] ?? "UNKNOWN";
        const dataStr =
          e.data !== undefined ? ` ${JSON.stringify(e.data)}` : "";
        return `[${levelStr}][${e.category}] f${e.frame} ${e.message}${dataStr}`;
      })
      .join("\n");
  }

  /** Clear the ring buffer. */
  clear(): void {
    this.writeIndex = 0;
    this.count = 0;
    this.buffer.fill(undefined as unknown as LogEntry);
  }

  private log(
    level: LogLevel,
    category: string,
    message: string,
    data?: unknown,
  ): void {
    if (level < this.level) return;
    if (this.categories.size > 0 && !this.categories.has(category)) return;

    const entry: LogEntry = {
      level,
      category,
      message,
      data,
      timestamp: Date.now(),
      frame: this.currentFrame,
    };

    this.buffer[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
    this.count++;

    this.output?.(entry);
  }
}
