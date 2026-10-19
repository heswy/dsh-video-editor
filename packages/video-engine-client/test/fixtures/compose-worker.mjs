// Recording fake worker for the P3-012 client contract test. It appends every
// received JSONL frame (parsed object) to `recordPath` from the registry file,
// then answers with deterministic results so the test can assert the exact
// frames WorkerClient sends for project.compose/project.source.
import { appendFile, readFile } from "node:fs/promises";

const registryIndex = process.argv.indexOf("--registry");
const config = JSON.parse(
  await readFile(process.argv[registryIndex + 1], "utf8"),
);
const REVISION = "a".repeat(64);
let buffer = "";
let chain = Promise.resolve();

function reply(id, result) {
  process.stdout.write(JSON.stringify({ v: 1, id, ok: true, result }) + "\n");
}

function replyError(id, error) {
  process.stdout.write(JSON.stringify({ v: 1, id, ok: false, error }) + "\n");
}

async function handle(message) {
  if (config.recordPath)
    await appendFile(config.recordPath, JSON.stringify(message) + "\n");
  if (message.method === "shutdown") {
    reply(message.id, { shutdown: true });
    process.exit(0);
  }
  if (message.method === "doctor") {
    reply(message.id, { fake: true });
    return;
  }
  if (message.method === "project.compose") {
    if (message.params?.html === "INVALID") {
      replyError(message.id, {
        code: "E_COMPOSE_INVALID",
        message: "bad composition",
        stage: "compose",
      });
      return;
    }
    reply(message.id, {
      projectId: message.params.projectId,
      revision: REVISION,
      publishedRevision: REVISION,
      written: true,
      unchanged: false,
      scenes: [],
      entry: "index.html",
      width: 1280,
      height: 720,
      duration: 5,
      bytes: Buffer.byteLength(message.params.html, "utf8"),
      assets: ["assets/gsap.min.js"],
      elements: [],
      files: [],
      preview: {
        mode: "snapshot",
        status: "ready",
        checked: "composition+snapshot",
        revision: REVISION,
      },
    });
    return;
  }
  if (message.method === "project.source") {
    reply(message.id, {
      projectId: message.params.projectId,
      revision: REVISION,
      entry: "index.html",
      bytes: 653,
      assets: ["assets/gsap.min.js"],
      html: "<!doctype html>",
    });
    return;
  }
  reply(message.id, { method: message.method });
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    chain = chain.then(() => handle(message));
  }
});
