import { closeSync } from "node:fs";

let handled = false;
process.stdin.on("error", () => {});
process.stdin.on("data", (chunk) => {
  if (handled) return;
  const request = JSON.parse(chunk.toString("utf8"));
  handled = true;
  process.stdout.write(
    JSON.stringify({ v: 1, id: request.id, ok: true, result: {} }) + "\n",
  );
  process.stdin.pause();
  closeSync(0);
  setTimeout(() => process.exit(0), 1_000);
});
