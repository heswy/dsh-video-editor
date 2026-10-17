import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export class WorkerClientError extends Error {
  constructor(
    code,
    message,
    { stage = "client", uncertain = false, jobUnknown = false } = {},
  ) {
    super(message);
    this.name = "WorkerClientError";
    this.code = code;
    this.stage = stage;
    this.uncertain = uncertain;
    this.jobUnknown = jobUnknown;
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
    this.stdout = Buffer.alloc(0);
    this.stderr = Buffer.alloc(0);
    this.stderrTruncated = false;
    this.expired = new Set();
    this.disposePromise = undefined;
    this.streamFailed = false;
  }
  debug() {
    return {
      state: this.state,
      pending: this.pending.size,
      stderrBytes: this.stderr.length,
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
      this.resolveExit = resolve;
    });
    this.listeners = {
      stdoutData: (chunk) => this.onStdout(chunk),
      stderrData: (chunk) => this.onStderr(chunk),
      stdinError: (error) => this.streamFailure("stdin", error),
      stdoutError: (error) => this.streamFailure("stdout", error),
      stderrError: (error) => this.streamFailure("stderr", error),
      exit: () => this.onExit(),
      error: () => {
        this.startFailure = true;
        this.onExit();
      },
    };
    this.child.stdout.on("data", this.listeners.stdoutData);
    this.child.stderr.on("data", this.listeners.stderrData);
    this.child.stdin.on("error", this.listeners.stdinError);
    this.child.stdout.on("error", this.listeners.stdoutError);
    this.child.stderr.on("error", this.listeners.stderrError);
    this.child.once("exit", this.listeners.exit);
    this.child.once("error", this.listeners.error);
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
    this.stdout = Buffer.concat([this.stdout, chunk]);
    if (
      this.stdout.length > this.options.maxLineBytes &&
      !this.stdout.includes(10)
    ) {
      this.protocolFailure(
        "Worker response exceeds line limit",
        "E_LINE_LIMIT",
      );
      return;
    }
    let end;
    while ((end = this.stdout.indexOf(10)) >= 0) {
      const line = this.stdout.subarray(0, end);
      this.stdout = this.stdout.subarray(end + 1);
      if (line.length > this.options.maxLineBytes) {
        this.protocolFailure(
          "Worker response exceeds line limit",
          "E_LINE_LIMIT",
        );
        return;
      }
      let response;
      try {
        response = JSON.parse(line.toString("utf8"));
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
      const entry = this.takePending(response.id);
      if (!entry) {
        if (this.expired.delete(response.id)) continue;
        this.protocolFailure("Response id is not pending");
        return;
      }
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
    const combined = Buffer.concat([this.stderr, chunk]);
    if (combined.length <= this.options.maxStderrBytes) this.stderr = combined;
    else {
      this.stderr = combined.subarray(-this.options.maxStderrBytes);
      this.stderrTruncated = true;
    }
  }
  protocolFailure(message, code = "E_PROTOCOL") {
    if (["failed", "disposed"].includes(this.state)) return;
    this.state = "failed";
    this.rejectAll((entry) =>
      new WorkerClientError(code, message, {
        stage: "protocol",
        uncertain: entry.method === "edit",
        jobUnknown: ["frame", "render"].includes(entry.method),
      }),
    );
    this.stopWorker("SIGTERM");
  }
  streamFailure(stream) {
    if (this.streamFailed || this.state === "disposed") return;
    this.streamFailed = true;
    if (this.state !== "disposing") this.state = "failed";
    this.rejectAll(
      (entry) =>
        new WorkerClientError("E_TRANSPORT", `Worker ${stream} is unavailable`, {
          stage: "transport",
          uncertain: entry.method === "edit",
          jobUnknown: ["frame", "render"].includes(entry.method),
        }),
    );
    this.stopWorker("SIGTERM");
    void this.dispose();
  }
  takePending(id) {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    return entry;
  }
  rejectAll(errorFor) {
    for (const id of [...this.pending.keys()]) {
      const entry = this.takePending(id);
      entry.reject(errorFor(entry));
    }
  }
  stopWorker(signal) {
    if (this.child?.exitCode === null && !this.child.killed)
      this.child.kill(signal);
  }
  detachListeners() {
    if (!this.listeners) return;
    this.child.stdout.removeListener("data", this.listeners.stdoutData);
    this.child.stderr.removeListener("data", this.listeners.stderrData);
    this.child.stdin.removeListener("error", this.listeners.stdinError);
    this.child.stdout.removeListener("error", this.listeners.stdoutError);
    this.child.stderr.removeListener("error", this.listeners.stderrError);
    this.child.removeListener("exit", this.listeners.exit);
    this.child.removeListener("error", this.listeners.error);
    this.listeners = undefined;
  }
  onExit() {
    this.resolveExit?.("exit");
    this.resolveExit = undefined;
    if (["starting", "running"].includes(this.state)) this.state = "failed";
    this.rejectAll(
      (entry) =>
        new WorkerClientError("E_PROCESS_EXIT", "Worker exited", {
          stage: "process",
          uncertain: entry.method === "edit",
          jobUnknown: ["frame", "render"].includes(entry.method),
        }),
    );
    this.detachListeners();
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
        const entry = this.takePending(id);
        if (!entry) return;
        this.expired.add(id);
        if (this.expired.size > this.options.maxPending)
          this.expired.delete(this.expired.values().next().value);
        entry.reject(
          new WorkerClientError("E_REQUEST_TIMEOUT", "Worker did not respond", {
            stage: "request",
            uncertain: method === "edit",
            jobUnknown: ["frame", "render"].includes(method),
          }),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.child.stdin.write(
          JSON.stringify({ v: 1, id, method, params }) + "\n",
          (error) => {
            if (!error) return;
            this.streamFailure("stdin");
          },
        );
      } catch {
        this.streamFailure("stdin");
      }
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
        new Promise((resolve) => {
          const timer = setTimeout(resolve, timeoutMs, "timeout");
          this.exit.then((value) => {
            clearTimeout(timer);
            resolve(value);
          });
        });
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
