import { parseArgs } from "node:util";
import path from "node:path";
import { startFeedbackServer } from "../http/server.js";
import { FeedbackClient } from "../../client/FeedbackClient.js";
import { isAction, isStatus, parseTransition } from "../../shared/workflow.js";
import { validId } from "../../shared/protocol.js";

const HELP = `yage-feedback serve [--dir .yage/feedback] [--port 5212] [--base-path /] [--project PATH] [--origin URL ...]
yage-feedback list [--status open|ingested|addressed|resolved] [--server URL]
yage-feedback show ID [--server URL]
yage-feedback ingest|address|resolve|reopen ID --revision N --by ACTOR --request-id UUID [--note TEXT] [--server URL]

Read commands do not change status. Copy comment.revision from show.
Each transition needs a new request UUID. Retry an uncertain request with the
same UUID and unchanged arguments; the server applies it at most once.
Output is JSON; failures exit with code 1.`;

export async function runCli(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      project: { type: "string" },
      port: { type: "string" },
      "base-path": { type: "string" },
      server: { type: "string" },
      origin: { type: "string", multiple: true },
      help: { type: "boolean" },
      status: { type: "string" },
      revision: { type: "string" },
      by: { type: "string" },
      "request-id": { type: "string" },
      note: { type: "string" },
    },
  });
  const [command, id] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
  }
  const allowed =
    command === "serve"
      ? ["dir", "port", "origin", "base-path", "project"]
      : command === "list"
        ? ["server", "status"]
        : command === "show"
          ? ["server"]
          : isAction(command)
            ? ["server", "revision", "by", "request-id", "note"]
            : [];
  for (const option of Object.keys(values))
    if (!allowed.includes(option))
      throw new Error(`--${option} is not supported by ${command}.`);
  if (command === "serve" && positionals.length === 1) {
    const port = Number(values.port ?? 5212);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error(
        "--port must be an integer from 0 to 65535 (0 selects an available port).",
      );
    const directory = path.resolve(values.dir ?? ".yage/feedback");
    const server = await startFeedbackServer({
      directory,
      project: path.resolve(values.project ?? "."),
      port,
      ...(values["base-path"] ? { basePath: values["base-path"] } : {}),
      ...(values.origin ? { origins: values.origin } : {}),
    });
    console.log(`YAGE feedback: ${server.url}\nData: ${directory}`);
    const shutdown = (): void => {
      void server.close().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }
  const client = new FeedbackClient(values.server);
  let result: unknown;
  if (command === "list" && positionals.length === 1) {
    if (values.status !== undefined && !isStatus(values.status))
      throw new Error("Unknown feedback status.");
    result = await client.list(values.status);
  } else if (
    command === "show" &&
    id &&
    validId(id) &&
    positionals.length === 2
  )
    result = await client.show(id);
  else if (isAction(command) && id && validId(id) && positionals.length === 2) {
    if (!values.revision || !/^\d+$/.test(values.revision))
      throw new Error("--revision must be a nonnegative integer from show.");
    const request = parseTransition({
      requestId: values["request-id"] ?? null,
      expectedRevision: Number(values.revision),
      action: command,
      actor: values.by ?? null,
      ...(values.note !== undefined ? { note: values.note } : {}),
    });
    result = await client.transition(id, request);
  } else
    throw new Error("Unknown command or arguments. Run yage-feedback --help.");
  console.log(JSON.stringify(result, null, 2));
}
