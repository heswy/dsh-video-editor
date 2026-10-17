# 独立 worker 父进程通信包

纯 Node/ESM 库，为未来 Host 启动 `video-engine-worker` 并调用 JSONL v1 协议。导入或构造 `WorkerClient` 不启动进程；调用方必须显式提供 Node executable、worker entry、可信 registry 以及全部期限/限额。此包不依赖 DSH、不读写工程 HTML、不缓存 revision，也不会重试 edit/render。

```js
import { WorkerClient } from "dsh-video-engine-client";

const client = new WorkerClient({
  nodeExecutable: process.execPath,
  workerEntry: "/trusted/worker/src/worker.mjs",
  registryPath: "/trusted/registry.json",
  startupTimeoutMs: 10_000,
  requestTimeoutMs: 10_000,
  shutdownTimeoutMs: 10_000,
  forceKillTimeoutMs: 1_000,
  maxPending: 32,
  maxLineBytes: 65_536,
  maxStderrBytes: 16_384,
});

await client.start();
const opened = await client.open("demo");
const saved = await client.edit({
  projectId: "demo",
  expectedRevision: opened.revision,
  operationId: "host-title-1",
  ops: [{ type: "text", target: "hf-title", text: "来自 Host" }],
});
const job = await client.frame({ projectId: "demo", revision: saved.revision, time: 2.5 });
const status = await client.status(job.jobId);
await client.dispose();
```

公共方法：`start`、`doctor`、`open`、`inspect`、`edit`、`frame`、`render`、`status`、`cancel`、`close`、`request`、`dispose`。成功时返回 worker 原始 result；worker 的结构化错误与本包错误均以 `WorkerClientError` reject，包含 `code`、`message`、`stage`。请求 `edit` 超时或 stdin 写入失败会带 `uncertain: true`：这表示客户端不知道 worker 是否已执行，调用方必须重新 inspect/以 expectedRevision 协调，不能假定未写入。没有自动重试或重放。

每个 client 自己生成 request id、持续消费 stdout 并严格验证 v1 envelope。分段、粘包和乱序响应按 id 匹配；坏 JSON、未知/重复 id、错误 envelope 和超长行会以协议错误终止该 client。stderr 只保留配置上限内的尾部，`debug()` 可查看 `stderrBytes`/`stderrTruncated` 和 pending 数。

`dispose()` 是幂等的：拒绝后续请求，优先发送 shutdown 并等待；无响应时仅对该 client spawn 的直接 worker 发送 TERM/KILL。它不能证明已清理 worker 派生的 detached Chrome/FFmpeg，也不提供 OS 沙箱、孤儿进程监督或自动重启。真实 worker 的 close/cancel 语义仍由 worker 决定。

```sh
npm test --prefix packages/video-engine-client
```
