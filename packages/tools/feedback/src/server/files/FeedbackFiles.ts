import { canonicalJson } from "../../shared/canonicalJson.js";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validId } from "../../shared/protocol.js";
import { authoredComment, readComment } from "../../shared/workflow.js";
import { FeedbackError } from "../../shared/errors.js";
import type {
  FeedbackCapture,
  FeedbackComment,
  FeedbackDetail,
  FeedbackUpload,
} from "../../shared/protocol.js";

async function optionalFile(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** One server owns writes; the filesystem owns all persisted state. */
export class FeedbackFiles {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  async save(data: FeedbackUpload, bytes: Buffer): Promise<FeedbackDetail> {
    const { capture, comment } = data;
    const captureRoot = path.join(this.directory, "captures");
    const commentsRoot = path.join(this.directory, "comments");
    await mkdir(captureRoot, { recursive: true });
    await mkdir(commentsRoot, { recursive: true });
    const destination = path.join(captureRoot, capture.id);
    const captureJson = JSON.stringify(capture, null, 2) + "\n";
    const commentJson = JSON.stringify(readComment(comment), null, 2) + "\n";
    const commentPath = path.join(commentsRoot, `${comment.id}.json`);
    const previousComment = await optionalFile(commentPath);
    if (
      previousComment &&
      canonicalJson(
        authoredComment(readComment(JSON.parse(previousComment.toString()))),
      ) !== canonicalJson(authoredComment(readComment(comment)))
    )
      throw new FeedbackError("conflict", "Comment ID conflict.");
    const previous = await optionalFile(path.join(destination, "capture.json"));
    if (previous) {
      if (
        canonicalJson(JSON.parse(previous.toString())) !==
          canonicalJson(capture) ||
        !(await readFile(path.join(destination, "screenshot.png"))).equals(
          bytes,
        )
      )
        throw new FeedbackError("conflict", "Capture ID conflict.");
    } else {
      const staging = path.join(captureRoot, `.pending-${randomUUID()}`);
      await mkdir(staging);
      try {
        await writeFile(path.join(staging, "screenshot.png"), bytes);
        await writeFile(path.join(staging, "capture.json"), captureJson);
        await rename(staging, destination);
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    }
    if (!previousComment) {
      const temporary = path.join(commentsRoot, `.pending-${randomUUID()}`);
      try {
        await writeFile(temporary, commentJson);
        await rename(temporary, commentPath);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    }
    return this.show(comment.id);
  }
  async list(): Promise<FeedbackComment[]> {
    const root = path.join(this.directory, "comments");
    await mkdir(root, { recursive: true });
    const files = (await readdir(root))
      .filter((file) => file.endsWith(".json") && validId(file.slice(0, -5)))
      .sort();
    const comments = await Promise.all(
      files.map(async (file) =>
        readComment(JSON.parse(await readFile(path.join(root, file), "utf8"))),
      ),
    );
    return comments.sort(
      (a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
    );
  }
  async show(id: string): Promise<FeedbackDetail> {
    const comment = readComment(
      JSON.parse(
        await readFile(
          path.join(this.directory, "comments", `${id}.json`),
          "utf8",
        ),
      ),
    );
    const captureRoot = path.join(
      this.directory,
      "captures",
      comment.captureId,
    );
    const capture = JSON.parse(
      await readFile(path.join(captureRoot, "capture.json"), "utf8"),
    ) as FeedbackCapture;
    return {
      comment,
      capture,
      screenshotPath: path.join(captureRoot, "screenshot.png"),
      screenshotUrl: `/captures/${comment.captureId}/screenshot.png`,
    };
  }
  async writeComment(comment: FeedbackComment): Promise<void> {
    const root = path.join(this.directory, "comments");
    const temporary = path.join(root, `.pending-${randomUUID()}`);
    try {
      await writeFile(temporary, JSON.stringify(comment, null, 2) + "\n");
      await rename(temporary, path.join(root, `${comment.id}.json`));
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  async image(id: string): Promise<Buffer> {
    return readFile(
      path.join(this.directory, "captures", id, "screenshot.png"),
    );
  }
}
