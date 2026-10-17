import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Projects, validateEdit } from "./projects.mjs";
import { Jobs } from "./jobs.mjs";
import {
  fail,
  keys,
  string,
  number,
  revision,
  publicError,
} from "./errors.mjs";
const MAX_LINE = 65536,
  MAX_OUTPUT = 65536,
  MAX_REQUESTS = 10000;
let store,
  jobs,
  closing = false,
  shutdownPromise,
  diagnosticBytes = 0;
const projectClosures = new Map();
function diagnostic(stage) {
  const line = `[worker] ${stage}\n`;
  if (diagnosticBytes + line.length <= 16384) {
    diagnosticBytes += line.length;
    process.stderr.write(line);
  }
}
function send(id, response) {
  let line = JSON.stringify({ v: 1, id, ...response });
  if (Buffer.byteLength(line) > MAX_OUTPUT)
    line = JSON.stringify({
      v: 1,
      id,
      ok: false,
      error: {
        code: "E_OUTPUT_LIMIT",
        message: "Response exceeds limit",
        stage: "protocol",
      },
    });
  return new Promise((resolve) => process.stdout.write(line + "\n", resolve));
}
async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  if (jobs) jobs.closing = true;
  shutdownPromise = (async () => {
    await jobs?.drain();
    await Promise.all([...(store?.queues.values() || [])]);
  })();
  return shutdownPromise;
}
function closeProject(projectId) {
  const existing = projectClosures.get(projectId);
  if (existing) return existing;
  // This is intentionally synchronous before the first await. All subsequent
  // stdin requests observe the lifecycle gate while the old jobs drain.
  store.beginClose(projectId);
  const closingProject = (async () => {
    await jobs.drain(projectId);
    await store.queue(projectId, () => store.completeClose(projectId));
    return { projectId, closed: true };
  })();
  projectClosures.set(projectId, closingProject);
  closingProject.then(
    () => projectClosures.delete(projectId),
    () => projectClosures.delete(projectId),
  );
  return closingProject;
}
async function method(name, p) {
  if (closing && name !== "shutdown")
    fail("E_SHUTDOWN", "Worker is shutting down");
  switch (name) {
    case "doctor":
      keys(p, []);
      return jobs.tools;
    case "open":
      keys(p, ["projectId"], ["projectId"]);
      string(p.projectId);
      return store.requestOpen(p.projectId);
    case "inspect":
      keys(p, ["projectId"], ["projectId"]);
      string(p.projectId);
      return store.requestInspect(p.projectId);
    case "edit":
      validateEdit(p);
      return store.edit(p.projectId, p);
    case "frame":
    case "render":
      keys(
        p,
        ["projectId", "revision", "time", "timeoutMs"],
        ["projectId", "revision", ...(name === "frame" ? ["time"] : [])],
      );
      string(p.projectId);
      revision(p.revision);
      if (name === "frame") number(p.time, 0, 3599.999);
      else if (p.time !== undefined)
        fail("E_PARAMS", "Render has no time parameter");
      if (p.timeoutMs !== undefined) number(p.timeoutMs, 100, 120000);
      return jobs.start(name, p);
    case "status":
      keys(p, ["jobId"], ["jobId"]);
      string(p.jobId);
      return jobs.view(jobs.get(p.jobId));
    case "cancel":
      keys(p, ["jobId"], ["jobId"]);
      string(p.jobId);
      return jobs.cancel(jobs.get(p.jobId));
    case "close":
      keys(p, ["projectId"], ["projectId"]);
      string(p.projectId);
      return closeProject(p.projectId);
    case "shutdown":
      keys(p, []);
      await shutdown();
      return { shutdown: true };
    default:
      fail("E_METHOD", "Unknown method");
  }
}
const seen = new Set(),
  pending = new Set();
async function accept(line) {
  let id = null,
    request;
  try {
    try {
      request = JSON.parse(line);
    } catch {
      fail("E_JSON", "Malformed JSON", "protocol");
    }
    if (typeof request?.id === "string" && request.id.length <= 128)
      id = request.id;
    keys(
      request,
      ["v", "id", "method", "params"],
      ["v", "id", "method", "params"],
    );
    string(request.id);
    id = request.id;
    if (request.v !== 1)
      fail("E_VERSION", "Unsupported protocol version", "protocol");
    string(request.method, 32);
    if (seen.has(id))
      fail("E_DUPLICATE_ID", "Request id was already used", "protocol");
    if (seen.size >= MAX_REQUESTS)
      fail("E_LIMIT", "Request budget exhausted", "protocol");
    seen.add(id);
    const result = await method(request.method, request.params);
    await send(id, { ok: true, result });
    if (request.method === "shutdown") {
      process.stdin.pause();
      setImmediate(() => process.exit(0));
    }
  } catch (e) {
    diagnostic("request failed");
    await send(id, { ok: false, error: publicError(e) });
  }
}
try {
  const index = process.argv.indexOf("--registry");
  if (index < 0) throw Error("registry");
  const config = JSON.parse(await readFile(process.argv[index + 1], "utf8"));
  keys(
    config,
    ["root", "projects", "outputRoot", "browserPath"],
    ["root", "projects", "outputRoot"],
  );
  string(config.root, 4096);
  string(config.outputRoot, 4096);
  keys(config.projects, Object.keys(config.projects));
  if (process.platform === "win32") throw Error("POSIX only");
  config.root = resolve(config.root);
  config.outputRoot = resolve(config.outputRoot);
  for (const path of Object.values(config.projects)) string(path, 4096);
  await mkdir(config.outputRoot, { recursive: true });
  store = new Projects(config);
  jobs = new Jobs(store, config);
  let buffered = Buffer.alloc(0),
    dropping = false;
  process.stdin.on("data", (chunk) => {
    let start = 0;
    for (let i = 0; i <= chunk.length; i++) {
      if (i === chunk.length || chunk[i] === 10) {
        const part = chunk.subarray(start, i);
        if (!dropping) {
          if (buffered.length + part.length > MAX_LINE) {
            dropping = true;
            buffered = Buffer.alloc(0);
            send(null, {
              ok: false,
              error: {
                code: "E_LINE_LIMIT",
                message: "Input line exceeds limit",
                stage: "protocol",
              },
            });
          } else buffered = Buffer.concat([buffered, part]);
        }
        if (i < chunk.length) {
          if (!dropping && buffered.length) {
            const promise = accept(buffered.toString("utf8"));
            pending.add(promise);
            promise.finally(() => pending.delete(promise));
          }
          buffered = Buffer.alloc(0);
          dropping = false;
        }
        start = i + 1;
      }
    }
  });
  process.stdin.on("end", () => {
    void (async () => {
      closing = true;
      await Promise.all([...pending]);
      await shutdown();
      process.exit(0);
    })();
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void shutdown().then(() => process.exit(0));
    });
  process.on("uncaughtException", () => {
    diagnostic("uncaught exception");
    void shutdown().finally(() => process.exit(1));
  });
  process.on("unhandledRejection", () => {
    diagnostic("unhandled rejection");
    void shutdown().finally(() => process.exit(1));
  });
} catch {
  diagnostic("startup failed");
  process.exitCode = 1;
}
