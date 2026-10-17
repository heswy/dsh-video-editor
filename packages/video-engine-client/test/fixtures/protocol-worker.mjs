import { readFile } from "node:fs/promises";

const registryIndex = process.argv.indexOf("--registry");
const { mode } = JSON.parse(
  await readFile(process.argv[registryIndex + 1], "utf8"),
);
if (mode === "stall") process.on("SIGTERM", () => {});
let buffer = "";
const delayed = [];

function response(id, result) {
  return JSON.stringify({ v: 1, id, ok: true, result });
}

function reply(id, result) {
  process.stdout.write(response(id, result) + "\n");
}

function request(message) {
  if (message.method === "shutdown") {
    if (mode === "stall") return;
    reply(message.id, { shutdown: true });
    process.exit(0);
  }
  if (message.method === "doctor") {
    if (mode === "malformed") {
      process.stdout.write("{not-json}\n");
      return;
    }
    reply(message.id, { fake: true });
    return;
  }
  if (mode === "unicode" && message.method === "inspect") {
    const bytes = Buffer.from(response(message.id, { text: "你好😀" }) + "\n");
    const split = bytes.indexOf(Buffer.from("你")) + 1;
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => process.stdout.write(bytes.subarray(split)), 20);
    return;
  }
  if (["edit-exit", "edit-bad"].includes(mode) && message.method === "edit") {
    if (mode === "edit-bad") process.stdout.write("{bad-frame}\n");
    process.exit(7);
    return;
  }
  if (mode === "oversize") {
    process.stdout.write("x".repeat(2048) + "\n");
    return;
  }
  if (mode === "invalid") {
    process.stdout.write(
      JSON.stringify({ v: 2, id: message.id, ok: true, result: {} }) + "\n",
    );
    return;
  }
  if (mode === "late" && message.method === "edit") {
    setTimeout(() => reply(message.id, { late: true }), 300);
    return;
  }
  if (mode === "exit" && message.method === "inspect") {
    process.stderr.write("controlled exit\n");
    process.exit(7);
  }
  if (mode === "stderr" && message.method === "inspect") {
    process.stderr.write("s".repeat(1024));
  }
  if (mode === "framing" && ["first", "second"].includes(message.method)) {
    delayed.push(message);
    if (delayed.length === 2) {
      const second = response(delayed[1].id, { method: "second" });
      const first = response(delayed[0].id, { method: "first" });
      process.stdout.write(second.slice(0, 9));
      setTimeout(
        () => process.stdout.write(second.slice(9) + "\n" + first + "\n"),
        10,
      );
    }
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
    if (line) request(JSON.parse(line));
  }
});
if (mode === "stall") setTimeout(() => process.exit(0), 700);
