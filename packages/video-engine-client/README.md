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

## 启动上下文（可选 env / cwd）

部署 Host 可以用两个可选参数显式决定子进程的启动上下文：

```js
const client = new WorkerClient({
  // ...必填项同上
  // 完整子进程环境：传入时替换而不是与 process.env 合并。
  env: {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/Users/example",
    LANG: "en_US.UTF-8",
  },
  // 必须是绝对目录。
  cwd: "/Users/example/Library/Application Support/dsh-video/worker",
});
```

- `env` 是**完整环境**，不会与 `process.env` 再合并；未提供时才保留原有继承行为。库在构造时校验并复制传入对象，调用方随后修改原 env 对象不影响之后 start 的配置。部署 Host 负责构造清理后的环境（去掉 Electron/IPC/Node 注入变量），此库只做显式透传，不修改父进程全局 `process.env` 或 cwd。
- `cwd` 必须是绝对路径字符串。未传 cwd 时沿用父进程工作目录。
- 构造函数对错误类型、空 env、空/非法 env 项、NUL 字节、非绝对 cwd 立即抛出 `TypeError`，此时不会创建子进程或 pending；start 之后的超时、断管与 dispose 契约不变。
- 导入或构造（包括传 env/cwd）都不启动 worker；只有 `start()` 才 spawn。

## 包入口与版本

`package.json` 版本 0.3.2，`exports` 提供根入口与 manifest 解析：

- `dsh-video-engine-client` → `./src/index.mjs`（根入口不变）
- `dsh-video-engine-client/package.json` → 自身 manifest

worker 包（`dsh-video-engine-worker`）另行导出 `./worker` → `./src/worker.mjs` 与 `./package.json`；Host 应通过 Node 包解析获得 worker entry，而不是拼接开发路径。worker 入口只用于 resolve，不要在 Host 进程里 import 执行。两个包的 `files` 白名单只含 runtime 源码、协议 schema 与 README，不含 tests、fixtures、scripts、node_modules、缓存、artifacts 或字体。

公共方法：`start`、`doctor`、`open`、`inspect`、`edit`、`frame`、`render`、`status`、`cancel`、`close`、`request`、`dispose`，以及 P3-003 多 Scene/修订方法：`projectCreate`、`assetImport`、`sceneCreate`、`sceneUpdate`、`sceneRemove`、`sceneReorder`、`projectRevise`、`history`、`undo`、`redo`（分别对应 v1 协议的 `project.create`、`asset.import`、`scene.*`、`project.revise`、`history`、`undo`、`redo`），以及 P3-004 预览快照方法：`previewSnapshot`、`previewRelease`（对应 `preview.snapshot`/`preview.release`）。0.3.2 起所有 Scene summary 额外返回只读 `template`（可直接作为 `scene.update.template` 输入，支持只改目标字段而保留其它字段）；0.3.1 起统一 `edit` 还接受 `layout`/`style` 两类受控 op（无需新方法），`inspect` 元素增加规范化 `layout`/`style` 与 `layout`/`style` capability；全部随 worker 结果透明透传。成功时返回 worker 原始 result；worker 的结构化错误与本包错误均以 `WorkerClientError` reject，包含 `code`、`message`、`stage`。`stdin`/`stdout`/`stderr` 断管会停止该 client、以 `E_TRANSPORT` 结算全部 pending，并只终止其直接 worker；故障被观察到之后的新请求在准入前以 `E_CLIENT_STATE` 拒绝，既不标记为已发送也不重放。未收到可靠响应的 `edit`（超时、断管、坏帧、退出或 teardown）会带 `uncertain: true`：调用方必须重新 inspect/以 expectedRevision 协调，不能假定未写入。未收到 `frame`/`render` jobId 的传输失败带 `jobUnknown: true`，它不声称作业未开始，且客户端无 jobId 可恢复查询或取消。没有自动重试或重放。

每个 client 自己生成 request id、按原始字节组行再 UTF-8 解码 stdout，严格验证 v1 envelope。分段、粘包、中文/emoji 跨字节和乱序响应按 id 匹配；坏 JSON、未知/重复 id、错误 envelope 和超长行会以协议错误终止该 client。stderr 也按原始字节截留尾部，`debug()` 可查看 `stderrBytes`/`stderrTruncated` 和 pending 数。

`dispose()` 是幂等的：拒绝后续请求，优先发送 shutdown 并等待；无响应时仅对该 client spawn 的直接 worker 发送 TERM/KILL。它不能证明已清理 worker 派生的 detached Chrome/FFmpeg，也不提供 OS 沙箱、孤儿进程监督或自动重启。真实 worker 的 close/cancel 语义仍由 worker 决定。

## 预览快照（P3-004）

```js
const snapshot = await client.previewSnapshot({
  projectId,
  revision,
  ttlMs: 60_000, // 可选；默认 10 分钟，上限 30 分钟，最小 100 ms 的整数
});
// {snapshotId, projectId, revision, entry, files:[{path,bytes,sha256}], expiresAt, maxBytes}
await client.previewRelease({ snapshotId: snapshot.snapshotId });
```

快照由 worker 写到私有 `outputRoot/previews/<snapshotId>/`，只返回相对路径；client 不读工程 HTML、不缓存 revision、不解释快照内容。`previewRelease` 对未知/过期 snapshotId 抛 `WorkerClientError`（`code: "E_SNAPSHOT_NOT_FOUND"`）；重复释放同一 id 属安全 no-op，会得到同一错误码。传输失败不回放请求，调用方按 snapshotId 语义自行处理；快照到期、`close`、`shutdown` 与 worker 重启都会清理私有副本。

```sh
npm test --prefix packages/video-engine-client
```
