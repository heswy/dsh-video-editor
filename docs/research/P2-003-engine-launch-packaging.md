# P2-003 引擎启动环境与可解析包入口

2026-10-17。开工基线 `5b9032b`（P2-001 已验收）；沿用 b4bf 工作树/分支。本任务只改 `packages/video-engine-client/**`、`packages/video-engine-worker/package.json` 及其局部锁元数据，新增打包测试与本文档；未改 worker src/protocol、worker 原业务测试、spikes、根插件/锁与全局状态，未安装/启用/重启 DSH，未 push/merge。指南与 ADR-0002、P2-002-review-01 通过 `git show codex/project-foundation` 读取（协调提交 `6a33e7c`），只导入本任务指南。

## 启动上下文：可选 env/cwd

`WorkerClient(options)` 增加两个可选参数，供 Host 显式决定子进程启动上下文：

```js
const client = new WorkerClient({
  nodeExecutable: "/absolute/path/to/node",
  workerEntry: "/absolute/worker/src/worker.mjs", // Host 实际应通过包解析获得
  registryPath: "/absolute/registry.json",
  startupTimeoutMs: 10_000,
  requestTimeoutMs: 10_000,
  shutdownTimeoutMs: 10_000,
  forceKillTimeoutMs: 1_000,
  maxPending: 32,
  maxLineBytes: 65_536,
  maxStderrBytes: 16_384,
  env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/Users/example", LANG: "en_US.UTF-8" },
  cwd: "/absolute/working-directory",
});
```

规则与理由：

- `env` 是**完整环境**：存在时直接作为 spawn 的 `env`，不与 `process.env` 隐式合并；未提供时保留原来的继承行为（现有真实 worker 测试依赖此行为）。部署 Host 负责构造清理后的环境并去掉 `ELECTRON_RUN_AS_NODE`、`NODE_CHANNEL_*`、`NODE_OPTIONS`、`NODE_PATH` 等注入项；此库只做显式透传，不内置 Electron/DSH 逻辑，也不修改父进程 `process.env`。
- `cwd` 必须是绝对路径；未提供时沿用父进程工作目录。
- 构造时校验并复制，调用方随后修改原 env 对象不影响之后 `start()` 的配置。复制使用 null-prototype 对象，避免 `__proto__` 之类的合法环境名触发原型赋值而非自有属性。
- 及早失败：`env` 非 plain object（含数组/字符串/null）、空 env 对象、空或含 `=`/NUL 的键、非字符串或含 NUL 的值；`cwd` 非字符串/空/含 NUL/非绝对路径，均在构造函数抛 `TypeError`。此阶段不 spawn、不产生 pending。空 env 对象被视为部署错误而非合法“零环境”，避免意外启动缺少 PATH 的子进程；需要最小环境时显式传入所需条目即可。
- 导入/构造（包括传 env/cwd）仍无启动副作用，只有 `start()` 才 spawn；既有超时、断管、pending、dispose 契约不变。

测试使用受控 fixture 回报子进程的 `process.cwd()` 与指定 env 键：显式 `{PATH, DSH_MARK}` + 绝对 cwd 时，子进程 cwd 为传入目录（realpath 匹配）、`DSH_MARK` 为构造时的值（构造后改原对象不生效）、父进程的 `DSH_PARENT_ONLY`/`HOME`/`ELECTRON_RUN_AS_NODE` 均不继承；不传 env 时仍继承父变量。非法 options 列表均构造即抛 TypeError。早前版本用完整 `envKeys` 回报，在 `npm test` 继承大量环境的场景会超过 1024 字节行限，已改为固定布尔字段，避免测试自身受父环境大小影响。

## 包入口、版本与文件白名单

- client 与 worker 版本均提升为 **0.1.1**，两个局部 `package-lock.json` 根版本同步；dependencies/devDependencies 未改。
- client `exports`：`{".": "./src/index.mjs", "./package.json": "./package.json"}`（保留根入口，新增 manifest 解析）。
- worker `exports`：`{"./worker": "./src/worker.mjs", "./package.json": "./package.json"}`。`./worker` 只用于 Host 包解析；导入它会执行 worker 主程序，Host 不应 import。
- `files`：client `["src/", "README.md"]`；worker `["src/", "protocol.schema.json", "README.md"]`。npm 另自动包含 `package.json`。tarball 实际条目：
  - client：`package.json`、`README.md`、`src/index.mjs`；
  - worker：`package.json`、`README.md`、`protocol.schema.json`、`src/{errors,jobs,process,projects,worker}.mjs`。
- **fixture 决定**：`fixtures/index.html`、`scripts/prepare-fixture.mjs`、`test/`、`artifacts/`、`.cache/`、node_modules 与系统字体**不打包**。worker 运行时契约只需要 `src/` 与依赖闭包 + 外部可信 registry；受控 demo 工程由 Host staging 用同一固定提交中的 fixtures/scripts 另行准备（这些文件仍在 Git 中可读取），字体从系统路径准备且不入 Git/包。打包测试实际核对 tarball 不含这些路径与字体扩展名；packaged worker 的受控链使用外部准备好的 fixture registry 跑通。

## 固定 tarball 与独立 staging 解析

打包测试（`packages/video-engine-client/test/packaging.test.mjs`）在每次运行时用 `npm pack --json --pack-destination <package>/artifacts` 生成两个固定 tarball，并验证：

1. 版本 0.1.1、exports/files 与源码定义一致；tarball 文件列表与白名单完全一致，无 tests/fixtures/scripts/artifacts/node_modules/字体。
2. 解包后的 manifest 版本/exports 与工作树一致；`src/index.mjs`、worker 全部 `src/*.mjs` 与 `protocol.schema.json` 的字节与工作树逐字节相同（SHA-256 核对源字节）。
3. 重复 `npm pack` 产生完全相同的 tarball 字节（gzip 可复现），因此记录的 SHA-256 标识固定提交的包。
4. 把两个 tarball 解到独立临时 staging 的 `node_modules/<pkg>`，由子进程消费端用 `createRequire` 实际解析 `dsh-video-engine-client`、`dsh-video-engine-client/package.json`、`dsh-video-engine-worker/worker`、`dsh-video-engine-worker/package.json`，并 import client 根入口断言 `WorkerClient` 类存在；不是静态读 exports 字段。

本机生成的固定包（ignored artifacts，均在当前工作树）：

| 包 | 路径 | SHA-256 | 大小 |
|---|---|---|---|
| client | `packages/video-engine-client/artifacts/dsh-video-engine-client-0.1.1.tgz` | `523b6ec6042be7dcb682f01bcf28e7fdf10d60b103e8dfedc62f43070e642029` | 6613 B |
| worker | `packages/video-engine-worker/artifacts/dsh-video-engine-worker-0.1.1.tgz` | `3d7abcb2b2184169e2fda557e852267626f43f2991d00a6b23dbc2a41b2a29ec` | 17011 B |

staging 消费端真实运行（开发证据，验证固定包可被包解析启动）：把两 tarball 解包到 `/tmp/p2-003-e2e-final/staging/node_modules/`，worker 的 node_modules 以符号链接指向本工作树 `packages/video-engine-worker/node_modules`（仅补依赖闭包，不进入 tarball）。用解包后的 client 在 Desktop primary-runtime **Node v24.21.0** + sanitized env 下启动解包后的 worker：

```json
{
  "clientEntry": "<staging>/node_modules/dsh-video-engine-client/src/index.mjs",
  "workerEntry": "<staging>/node_modules/dsh-video-engine-worker/src/worker.mjs",
  "nodeVersion": "v24.21.0",
  "doctorNode": "v24.21.0",
  "hyperframes": "0.8.167",
  "projectId": "demo",
  "revision": "135a529ff2e2…",
  "frameState": "succeeded",
  "frameWidth": 1280,
  "pending": 0,
  "state": "disposed"
}
```

## 验证命令与结果

实际运行时：`/usr/local/bin/node` v22.15.0；`/opt/homebrew/opt/node@24/bin/node` v24.14.0；Desktop primary-runtime Node `/Users/orange/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node` v24.21.0（仅测试配置，不写入产品默认）；`npm` 为 PATH 中 24.14.0 自带版本。

| 命令 | 结果 |
|---|---|
| `/usr/local/bin/node --test --test-concurrency=1 test/*.test.mjs`（client 目录） | 16 项：15 pass + 1 skip（Desktop runtime opt-in），约 12.8s |
| `/opt/homebrew/opt/node@24/bin/node --test --test-concurrency=1 test/*.test.mjs` | 同上，约 13.3s |
| `npm test --prefix packages/video-engine-client`（默认 Node 24.14.0） | 15 pass + 1 skip，约 13.2s |
| `DSH_ENGINE_TEST_NODE=<Desktop Node 24.21.0> node --test --test-name-pattern='Desktop runtime Node' test/real.test.mjs` | 1/1 通过，约 4.7–9.1s；doctor/node/open/inspect/PNG frame |
| 真实 worker + sanitized env/cwd（Node 22 与 24 各一次） | doctor/open/inspect/PNG frame/render+cancel 通过，约 4.2–5.4s |
| `npm test --prefix packages/video-engine-worker`（元数据 sanity） | 7/7，约 3.1s |
| 打包测试 | 1/1，重复打包 SHA 稳定；staging 解析通过 |
| packaged client→packaged worker（Node 24.21.0，staging） | doctor/open/inspect/PNG succeeded，见上节 JSON |

既有 10 项 client 包测试（含真实 worker、断管回归）全部继续通过；Node 22/24 协议兼容保持。worker 只改了 `package.json`/锁元数据与新增 exports/files，未重跑全部真实视频回归（本轮不涉及 worker src）。

## 未验证与限制

- 未在真实 DSH Host 内启动/加载；未安装、未启停、未重启、未改 profile、未 push/merge。Host 集成由 P2-002-B 使用本固定提交另行验证。
- staging 中 packaged worker 的依赖闭包用开发树 node_modules 符号链接补足，只证明包入口与运行路径可用；不证明可移植发行 tarball、离线依赖安装或跨机器分发。缺依赖时的安装策略未在本任务解决。
- `env` 早失败包含“空对象报错”的策略选择：本库要求显式完整环境至少含一项；未验证在 Windows 等平台的 env 特殊规则（当前仅 macOS POSIX 受控范围）。
- Desktop Node 24.21.0 的受控链是 opt-in 测试（`DSH_ENGINE_TEST_NODE` 环境变量），路径不入库；其它 Node 小版本未验证。
- 未新增 per-session ACL、沙箱或系统守护进程；强制退出仍只针对 client 直属 worker。
