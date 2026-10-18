import { closeSync, writeFileSync } from "node:fs";

// Controlled transport-failure fixture: it holds edit/frame/render without
// answering them, and closes its stdin read end only after a `sync` request
// proves that all three were received. The parent therefore sees a broken pipe
// while those three requests are still pending, instead of racing a sleep.
//
// Node 22 aborts when fd 0 is closed while libuv still owns the stdin handle
// ("Assertion failed: (fd > STDERR_FILENO), function uv__close"), so the stream
// is destroyed before the descriptor is closed. Both Node 22 and Node 24 keep
// this process alive until dispose sends SIGTERM.
const registryPath = process.argv[process.argv.indexOf("--registry") + 1];
const journalPath = `${registryPath}.journal`;
const journal = [];
function record(method) {
  journal.push(method);
  writeFileSync(journalPath, JSON.stringify(journal) + "\n");
}

process.stdin.on("error", () => {});
let buffer = "";
const held = [];
let broken = false;

function reply(id, result) {
  process.stdout.write(JSON.stringify({ v: 1, id, ok: true, result }) + "\n");
}
function replyError(id, code, message) {
  process.stdout.write(
    JSON.stringify({
      v: 1,
      id,
      ok: false,
      error: { code, message, stage: "fixture" },
    }) + "\n",
  );
}

function handle(request) {
  record(request.method);
  if (request.method === "doctor") {
    reply(request.id, {});
    return;
  }
  if (["edit", "frame", "render"].includes(request.method)) {
    held.push(request.method);
    return;
  }
  if (request.method !== "sync") {
    replyError(request.id, "E_METHOD", `unexpected method ${request.method}`);
    return;
  }
  if (held.length !== 3 || broken) {
    replyError(
      request.id,
      "E_SYNC",
      `expected 3 unanswered requests, received ${held.length} (broken=${broken})`,
    );
    return;
  }
  process.stdin.destroy();
  closeSync(0);
  broken = true;
  reply(request.id, { held: held.length });
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1_000);
