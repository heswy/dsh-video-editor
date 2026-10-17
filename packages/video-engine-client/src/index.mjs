import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export class WorkerClientError extends Error {
  constructor(code, message, { stage = "client", uncertain = false } = {}) {
    super(message);
    this.name = "WorkerClientError";
    this.code = code;
    this.stage = stage;
    this.uncertain = uncertain;
  }
}

function required(options, name, kind = "string") {
  const value = options?.[name];
  if (
    (kind === "string" && (typeof value !== "string" || !value)) ||
    (kind === "number" && (!Number.isFinite(value) || value <= 0))
  )
    throw new TypeError(`Expected ${name}`);
  return value;
}

export class WorkerClient {
  constructor(options) {
    this.options = {
      nodeExecutable: required(options, "nodeExecutable"),
      workerEntry: required(options, "workerEntry"),
      registryPath: required(options, "registryPath"),
      startupTimeoutMs: required(options, "startupTimeoutMs", "number"),
      requestTimeoutMs: required(options, "requestTimeoutMs", "number"),
      shutdownTimeoutMs: required(options, "shutdownTimeoutMs", "number"),
      forceKillTimeoutMs: required(options, "forceKillTimeoutMs", "number"),
      maxPending: required(options, "maxPending", "number"),
      maxLineBytes: required(options, "maxLineBytes", "number"),
      maxStderrBytes: required(options, "maxStderrBytes", "number"),
    };
    this.state = "new";
    this.pending = new Map();
    this.stdout = "";
    this.stderr = "";
    this.stderrTruncated = false;
    this.expired = new Set();
    this.disposePromise = undefined;
  }
  debug() {
    return {
      state: this.state,
      pending: this.pending.size,
      stderrBytes: Buffer.byteLength(this.stderr),
      stderrTruncated: this.stderrTruncated,
    };
  }
  async start() {
    if (this.state === "running") return this.doctor();
    if (this.state !== "new")
      throw new WorkerClientError("E_CLIENT_STATE", "Client cannot start", {
        stage: "start",
      });
    this.state = "starting";
    this.child = spawn(
      this.options.nodeExecutable,
      [this.options.workerEntry, "--registry", this.options.registryPath],
      { shell: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.exit = new Promise((resolve) => {
      this.child.once("exit", resolve);
      this.child.once("error", resolve);
    });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => this.onStderr(chunk));
    this.child.once("exit", () => this.onExit());
    this.child.once("error", () => {
      this.startFailure = true;
      this.onExit();
    });
    this.state = "running";
    try {
      return await this.request(
        "doctor",
        {},
        { timeoutMs: this.options.startupTimeoutMs },
      );
    } catch (error) {
      if (this.startFailure)
        throw new WorkerClientError("E_STARTUP", "Worker failed to start", {
          stage: "start",
        });
      throw error;
    }
  }
  onStdout(chunk) {
    this.stdout += chunk.toString("utf8");
    if (
      Buffer.byteLength(this.stdout) > this.options.maxLineBytes &&
      !this.stdout.includes("\n")
    ) {
      this.protocolFailure(
        "Worker response exceeds line limit",
        "E_LINE_LIMIT",
      );
      return;
    }
    let end;
    while ((end = this.stdout.indexOf("\n")) >= 0) {
      const line = this.stdout.slice(0, end);
      this.stdout = this.stdout.slice(end + 1);
      if (Buffer.byteLength(line) > this.options.maxLineBytes) {
        this.protocolFailure(
          "Worker response exceeds line limit",
          "E_LINE_LIMIT",
        );
        return;
      }
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        this.protocolFailure("Malformed worker response");
        return;
      }
      if (
        !response ||
        response.v !== 1 ||
        typeof response.id !== "string" ||
        typeof response.ok !== "boolean" ||
        (response.ok &&
          (!Object.hasOwn(response, "result") ||
            Object.hasOwn(response, "error"))) ||
        (!response.ok &&
          (!response.error ||
            typeof response.error.code !== "string" ||
            typeof response.error.message !== "string" ||
            typeof response.error.stage !== "string" ||
            Object.hasOwn(response, "result")))
      ) {
        this.protocolFailure("Invalid worker response envelope");
        return;
      }
      const entry = this.pending.get(response.id);
      if (!entry) {
        if (this.expired.delete(response.id)) continue;
        this.protocolFailure("Response id is not pending");
        return;
      }
      this.pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.ok) entry.resolve(response.result);
      else
        entry.reject(
          new WorkerClientError(response.error.code, response.error.message, {
            stage: response.error.stage,
          }),
        );
    }
  }
  onStderr(chunk) {
    const incoming = chunk.toString("utf8");
    const combined = this.stderr + incoming;
    const bytes = Buffer.byteLength(combined);
    if (bytes <= this.options.maxStderrBytes) this.stderr = combined;
    else {
      this.stderr = Buffer.from(combined)
        .subarray(-this.options.maxStderrBytes)
        .toString("utf8");
      this.stderrTruncated = true;
    }
  }
  protocolFailure(message, code = "E_PROTOCOL") {
    if (["failed", "disposed"].includes(this.state)) return;
    this.state = "failed";
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new WorkerClientError(code, message, { stage: "protocol" }));
    }
    this.pending.clear();
    this.child.kill("SIGTERM");
  }
  onExit() {
    if (["starting", "running"].includes(this.state)) this.state = "failed";
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(
        new WorkerClientError("E_PROCESS_EXIT", "Worker exited", {
          stage: "process",
        }),
      );
    }
    this.pending.clear();
  }
  request(
    method,
    params,
    { timeoutMs = this.options.requestTimeoutMs, internal = false } = {},
  ) {
    if (this.state !== "running" && !(internal && this.state === "disposing"))
      return Promise.reject(
        new WorkerClientError("E_CLIENT_STATE", "Client is not running"),
      );
    if (this.pending.size >= this.options.maxPending)
      return Promise.reject(
        new WorkerClientError("E_PENDING_LIMIT", "Too many requests"),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.expired.add(id);
        if (this.expired.size > this.options.maxPending)
          this.expired.delete(this.expired.values().next().value);
        reject(
          new WorkerClientError("E_REQUEST_TIMEOUT", "Worker did not respond", {
            stage: "request",
            uncertain: method === "edit",
          }),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ v: 1, id, method, params }) + "\n",
        (error) => {
          if (!error) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(
            new WorkerClientError(
              "E_PROCESS_WRITE",
              "Worker stdin is unavailable",
              { stage: "process", uncertain: method === "edit" },
            ),
          );
        },
      );
    });
  }
  doctor() {
    return this.request("doctor", {});
  }
  open(projectId) {
    return this.request("open", { projectId });
  }
  inspect(projectId) {
    return this.request("inspect", { projectId });
  }
  edit(params) {
    return this.request("edit", params);
  }
  frame(params) {
    return this.request("frame", params);
  }
  render(params) {
    return this.request("render", params);
  }
  status(jobId) {
    return this.request("status", { jobId });
  }
  cancel(jobId) {
    return this.request("cancel", { jobId });
  }
  close(projectId) {
    return this.request("close", { projectId });
  }
  async dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = (async () => {
      if (this.state === "new") {
        this.state = "disposed";
        return;
      }
      let terminated = false;
      if (this.state === "running") {
        this.state = "disposing";
        try {
          await this.request(
            "shutdown",
            {},
            {
              timeoutMs: this.options.shutdownTimeoutMs,
              internal: true,
            },
          );
        } catch {
          // The client owns this direct child only. This does not claim to
          // clean any detached browser grandchildren.
          this.child.kill("SIGTERM");
          terminated = true;
        }
      }
      const waitExit = (timeoutMs) =>
        Promise.race([
          this.exit,
          new Promise((resolve) => setTimeout(resolve, timeoutMs, "timeout")),
        ]);
      if (
        (await waitExit(
          terminated
            ? this.options.forceKillTimeoutMs
            : this.options.shutdownTimeoutMs,
        )) === "timeout"
      ) {
        if (!terminated) this.child.kill("SIGTERM");
        else this.child.kill("SIGKILL");
        terminated = true;
        if ((await waitExit(this.options.forceKillTimeoutMs)) === "timeout") {
          this.child.kill("SIGKILL");
          await waitExit(this.options.forceKillTimeoutMs);
        }
      }
      this.state = "disposed";
    })();
    return this.disposePromise;
  }
}
