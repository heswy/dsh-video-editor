import { readFileSync } from "node:fs";
import { WorkerClient } from "../../src/index.mjs";

const [workerEntry, registryPath] = process.argv.slice(2);
const journalPath = `${registryPath}.journal`;
const client = new WorkerClient({
  nodeExecutable: process.execPath,
  workerEntry,
  registryPath,
  startupTimeoutMs: 500,
  requestTimeoutMs: 500,
  shutdownTimeoutMs: 100,
  forceKillTimeoutMs: 100,
  maxPending: 8,
  maxLineBytes: 1024,
  maxStderrBytes: 128,
});

function check(condition, message, details) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(details)}`);
}

try {
  await client.start();
  check(client.debug().state === "running", "client did not start", client.debug());

  // Phase 1a: send three requests and let the fixture hold them unanswered.
  const sent = [
    client.edit({ projectId: "demo", ops: [] }),
    client.frame({ projectId: "demo", timeSeconds: 0 }),
    client.render({ projectId: "demo" }),
  ];
  check(
    client.debug().pending === 3,
    "sent requests were not admitted before the break",
    client.debug(),
  );

  // The fixture stays ordered behind the pipe: `sync` is only processed after
  // it received all three held requests, and it replies only after closing its
  // stdin read end. The reply is a reliable signal that a later write must hit
  // EPIPE rather than a timing guess.
  const sync = await client.request("sync", {});
  check(sync.held === 3, "fixture did not hold three requests", sync);
  check(
    client.debug().pending === 3,
    "held requests must still be pending after the sync ack",
    client.debug(),
  );

  // Phase 1b: this write deterministically observes the broken pipe.
  const probe = client.inspect("demo");
  const transport = await Promise.allSettled([...sent, probe]);
  const reasons = transport.map((attempt) => attempt.reason);
  const [edit, frame, render, inspect] = reasons;
  check(
    transport.every((attempt) => attempt.status === "rejected"),
    "sent requests were not all rejected",
    reasons.map((error) => error?.code),
  );
  check(
    reasons.every((error) => error.code === "E_TRANSPORT"),
    "sent requests did not receive transport failures",
    reasons.map((error) => error.code),
  );
  check(
    edit.uncertain === true && edit.jobUnknown === false,
    "edit must be uncertain after an unanswered write",
    edit,
  );
  check(
    frame.jobUnknown === true && render.jobUnknown === true,
    "frame/render must be job-unknown after losing the response",
    [frame, render],
  );
  check(
    inspect.uncertain === false && inspect.jobUnknown === false,
    "the probing inspect must not carry write-uncertainty markers",
    inspect,
  );
  check(
    client.debug().pending === 0,
    "pending must be settled after the transport failure",
    client.debug(),
  );
  const failureState = client.debug().state;
  check(
    ["failed", "disposed"].includes(failureState),
    "client must not keep accepting requests after the failure",
    failureState,
  );

  // Phase 2: requests issued after the failure was observed were never sent.
  // They must be refused at admission, not reported as transport failures with
  // uncertainty markers, and must not be replayed.
  const refused = await Promise.allSettled([
    client.edit({ projectId: "demo", ops: [] }),
    client.frame({ projectId: "demo", timeSeconds: 0 }),
    client.render({ projectId: "demo" }),
    client.inspect("demo"),
  ]);
  check(
    refused.every(
      (attempt) =>
        attempt.status === "rejected" &&
        attempt.reason.code === "E_CLIENT_STATE" &&
        attempt.reason.stage === "client" &&
        attempt.reason.uncertain === false &&
        attempt.reason.jobUnknown === false,
    ),
    "post-failure requests must be refused at admission",
    refused.map((attempt) => ({
      status: attempt.status,
      code: attempt.reason?.code,
      stage: attempt.reason?.stage,
      uncertain: attempt.reason?.uncertain,
      jobUnknown: attempt.reason?.jobUnknown,
    })),
  );
  check(
    client.debug().pending === 0,
    "refused requests must not enter pending",
    client.debug(),
  );

  await client.dispose();
  const state = client.debug();
  check(
    state.state === "disposed" && state.pending === 0,
    "dispose did not settle the client",
    state,
  );
  const workerExited =
    client.child.exitCode !== null || client.child.signalCode !== null;
  check(workerExited, "the client's own worker did not exit", {
    exitCode: client.child.exitCode,
    signalCode: client.child.signalCode,
  });

  // What the fixture actually read. The probe never arrives because the pipe
  // was already broken, and nothing is delivered twice.
  const delivered = JSON.parse(readFileSync(journalPath, "utf8"));
  check(
    JSON.stringify(delivered) ===
      JSON.stringify(["doctor", "edit", "frame", "render", "sync"]),
    "unexpected delivered request sequence",
    delivered,
  );

  process.stdout.write(
    JSON.stringify({
      held: sync.held,
      sent: reasons.map((error, index) => ({
        method: ["edit", "frame", "render", "inspect"][index],
        code: error.code,
        uncertain: error.uncertain,
        jobUnknown: error.jobUnknown,
      })),
      refused: refused.map((attempt) => attempt.reason.code),
      failureState,
      state,
      workerExited,
      delivered,
    }) + "\n",
  );
} finally {
  await client.dispose();
}
