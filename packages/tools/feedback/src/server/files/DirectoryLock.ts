import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

/** Exclusive ownership prevents two server queues from writing the same directory. */
export function acquireDirectoryLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, ".server.lock");
  let descriptor: number;
  try {
    descriptor = openSync(file, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Feedback directory is locked: ${file}. Stop its server first. After a crash, confirm the recorded PID is no longer running before removing the lock.`,
        { cause: error },
      );
    throw error;
  }
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({ pid: process.pid, created: new Date().toISOString() }) +
        "\n",
    );
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(file);
    throw error;
  }
  closeSync(descriptor);
  let released = false;
  return () => {
    if (!released) {
      unlinkSync(file);
      released = true;
    }
  };
}
