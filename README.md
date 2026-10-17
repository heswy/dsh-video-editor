# DSH Video

运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。目标是让 AI 创建可编辑的视频工程，用户直接修改后，AI 能继续编辑同一份工程并导出 MP4。

用户确定的入口（P0-005，延续到本阶段）：DSH 左侧原生导航中，在「上下文洞察」之后、「工作区」分组之前，单行 **Vedio Editor** + 细线条视频图标。原顶部「普通｜视频」胶囊已移除。入口是产品工作区导航，不改变 Agent preset、模型或权限。

当前阶段：**P2-002-B** 已在本地实现 Host 桥（受控 Fetch 路由 + `video_engine` Tool）与最小真实编辑界面，并准备开发 staging 脚本；包版本目标 **0.2.0**。本机已安装并启用的是 **0.1.3**，本轮**未安装、未启停、未改 profile**；0.2.0 先交主会话复审，安装需另行授权。运行时基线为 DSH Desktop **0.2.1-rc.1**。

- [当前状态与下一步](docs/STATUS.md)
- [开发与协作规则](docs/DEVELOPMENT.md)
- [产品范围](docs/product/PRODUCT.md)
- [前端设计规划](docs/design/FRONTEND-DESIGN.md)
- [决策记录](docs/DECISIONS.md)
- [ADR-0001 引擎 worker](docs/adr/0001-independent-video-worker.md)
- [ADR-0002 Host 桥运行时与边界](docs/adr/0002-host-bridge-runtime-and-boundaries.md)
- [P2-002 Host 契约调查](docs/research/P2-002-host-bridge-contract.md)

## 本版交付（0.2.0，本地）

| 项 | 值 |
|---|---|
| 包名 / Loader 行 id / Client 模块 id | `dsh-video` |
| Bundle 版本 | `0.2.0` |
| Host 路由 | `POST /api/dsh-video/request`、`GET/HEAD /api/dsh-video/artifact?jobId=…` |
| Tool | `video_engine`（action: doctor/open/inspect/edit/frame/render/status/cancel/close） |
| 侧栏入口 | `sidebar.panellist`，`id: dsh-video`、`order: 30`、label `Vedio Editor` |
| 面板 key | `main` keyed slot 的 `dsh-video` |
| 引擎依赖 | 独立 `dsh-video-engine-client` / `dsh-video-engine-worker`，仅开发 staging 快照内解析；根包 manifest 不写开发路径 |

`index.js` 是 Host half：一个 plugin-local `VideoBridge` 同时服务精确 Fetch 路由和 Tool；`host/` 保存校验、错误映射、环境清理、worker 适配与产物发布。`client.js` 是手写浏览器半（`window.__ModuleLoader__.load` 格式），只 `require('react')`，通过文档相对 `fetch('api/dsh-video/request')` 调用 Host。

### Host 可信配置（由安装/部署提供）

根包的 `cordis.patch.yml` 只有空 `config: {}`；真实安装时必须在 Loader 行的 `config` 中提供以下值。**包内不写死开发工作树、系统 Node/Chrome/FFmpeg 路径。** 缺配置或路径不可用时插件壳仍加载，业务请求返回 `E_CONFIGURATION`，不会猜测其它路径。

```yaml
- id: dsh-video
  name: dsh-video
  config:
    workerNode: /absolute/path/to/real/node        # 真实 Node 可执行文件；不是 Electron-as-Node
    workerEntry: /optional/absolute/worker.mjs     # 可选；默认解析 dsh-video-engine-worker/worker
    workerCwd: /absolute/private/worker-cwd        # 必须存在；Host 显式传给子进程
    registryPath: /absolute/controlled/registry.json
    artifactRoot: /absolute/output-root            # 必须与 registry.outputRoot 同一 realpath
    allowedProjects: [demo]                        # 非空；UI/Tool 只能引用这些 id
    # 可选上限：startupTimeoutMs/requestTimeoutMs/shutdownTimeoutMs/maxRequestBytes/
    # maxArtifactBytes/maxResultBytes/maxPending 等，见 host/config.js
```

- `workerNode` 经 `ctx.subprocess.resolveExecutable` 验证后才启动 worker；Host 构造**完整、清理后的子进程环境**（去掉 `ELECTRON_*`、`NODE_*`、`DSH_*`、`npm_*` 等继承项，不修改 `process.env`），并显式传 `cwd`。
- 启动前只读校验 registry（root/projects/outputRoot/browserPath）、allowlist 项目存在且位于 registry.root 内、`artifactRoot === realpath(outputRoot)`；不会写入工程内容。
- 缺 `env`/`cwd` seam 的旧引擎 client 会被拒绝（需要复审通过的 P2-003 快照）。

### Host 请求与 Tool

- 请求体为 JSON `{ "method": "...", "params": { ... } }`，正文默认上限 64 KiB；拒绝额外字段、未知方法、任意 path/URL。项目参数只能是配置 allowlist 的 id；`status`/`cancel`/`artifact` 还必须对应该 Host 实例已登记、由本实例启动的 job。
- Tool 与路由调用同一个 dispatcher；错误统一为 `{ code, message, stage, uncertain?, jobUnknown? }`，保留 edit 的结果不确定性、frame/render 丢失 jobId 的不确定性；Host 不自动重试写/渲染，也不保存第二份 revision 或 operationId 结果。
- 成功 frame/render 登记 `jobId → projectId/revision`；`GET/HEAD artifact` 会重新向 worker 取 succeeded 记录，再校验 UUID 文件名、realpath 在输出根、普通文件、大小上限与 SHA-256，才发布 PNG/MP4。只支持完整 GET/HEAD，不做 Range、目录列表或任意 URL 代理；不返回绝对路径、源码、stderr。
- 无 per-session ACL、无多用户工程隔离；当前只允许受控 fixture。worker 路径校验不是安全沙箱。

### 最小真实界面

- 无工程时保留一句「尚无工程」和一个可工作的「打开示例」动作；固定示例 id 为受控配置中的 `demo`，**不会自动伪造工程或进度**。
- 打开后：显示来自真实 `inspect` 的标题（文本元素）、尺寸/时长；自动请求当前 revision 的真实 PNG；提供标题编辑、基础 start/duration 编辑、更新画面、导出 MP4、取消与真实作业状态。
- 编辑失败/修订冲突就近显示；编辑成功后重新 `inspect`，先清掉旧帧，再请求新 revision 画面，旧帧不会冒充新 revision。
- 详细元数据（stableId/capabilities）放在按需展开的「属性」区；不常驻 revision 哈希、路径、版本或开发阶段说明。没有时间线、连续播放、AI 生成等未接入能力。

## 开发 staging（固定引擎提交）

根仓库不是完整发行包；worker/client 依赖通过**不可变开发快照**准备。最终 staging 必须使用主会话复审通过的 P2-003 引擎提交。

```sh
node scripts/stage-dev.mjs   --engine-commit <reviewed-P2-003-sha>   --node /absolute/real/node   --browser /absolute/chrome   [--font /absolute/font] [--out /absolute/staging-dir]
```

脚本要求根 worktree 干净、引擎包版本为复审的 `0.1.1` 且暴露 `./worker` / `./package.json` 导出；用该提交的 client/worker 快照 + `npm ci --ignore-scripts` 准备依赖闭包与受控 fixture，生成：

```text
<staging>/
  bundle/                  # 0.2.0 根 bundle；仅此快照内加本地依赖与 node_modules 链接
  engine-client/           # 固定 engine commit 快照
  engine-worker/           # 固定 engine commit 快照 + 依赖闭包 + artifacts fixture/registry/output
  config.json              # 仅此快照的绝对路径 Host 配置
  INTEGRITY.json           # 根/引擎提交、版本、文件摘要、依赖/解析证据、限制
```

- 相对 `file:` 依赖与链接只对这个开发快照有效，**不是可移植发行 tarball**；正式分发另行定义。staging 会在**快照副本**的 `cordis.patch.yml` 注入本次可信 config（根提交的 patch 仍是空 `config: {}`），因此 link 安装后无需手改 profile。
- 缺 esbuild 二进制或 pendingBuilds 时记录为阻塞，不运行 postinstall/未知构建脚本、不升级依赖。
- 真实受控引擎链（不改 DSH 安装）可在 staging 完成后运行：

```sh
node scripts/test-host-engine.mjs --staging /absolute/staging-dir
```

该脚本通过同一 `VideoBridge` 跑 doctor→open→inspect→text/timing edit→inspect→frame/status/PNG 字节→render/status/MP4 字节→取消→close→dispose，并把脱敏证据写入 staging 同级的 `evidence/`（不修改不可变快照）；它**不等于** DSH 真实激活或真页面验收。

## 安装（需用户明确授权；由 DSH 界面执行）

本仓库未做 profile 修改，0.2.0 未安装。复审通过并完成 staging 后：

1. 侧栏 **Plugins → Add plugin**，填入 staging 的 `bundle/` 绝对路径（开发 link）或审阅通过的固定包；
2. **Install**，完成后 **Enable now**；
3. 在插件 Loader 行填入 `config.json` 对应的可信配置（或由部署安装流程写入）。

不要在 shell/profile 中手改 `package.json`、`cordis.patch.yml` 或 `node_modules`；安装和 bundle 选择由 Plugin Manager 负责。

## 停用与回滚

- **停用**：Plugins 页面关闭 `dsh-video`。Host 停止接受新请求并 `await` 一次 worker dispose；UI/侧栏/路由/Tool 随 fiber 释放。worker 只在插件停用/移除时收尾，切换视频面板或返回对话不会停止共享 worker。
- **重新启用**：再次打开开关；worker 在第一次业务请求时惰性启动，不随面板挂载启动。
- **回滚**：保留并恢复已安装的 `0.1.3`（当前仍是它）；移除 0.2.0 bundle 后重新安装 0.1.3 固定 tarball，或按 Plugin Manager 历史选择回退。浏览器偏好可删除 `localStorage['dsh-video.ui.v1']`。
- **数据影响**：本阶段不写 DSH session 事件、不写 profile；工程内容只由受控 worker 写入其 staging/部署配置的 registry 工程目录；卸载不会删除 DSH 会话或草稿。

## 本地检查（零构建，无安装）

```sh
node --check index.js
node --check client.js
node --check scripts/check-host.mjs
node scripts/check.mjs          # manifest/patch/exports/files/locale/侧栏契约/UI 范围
node scripts/smoke-client.mjs   # Client 模块、侧栏原子生命周期、菜单、真实打开/编辑/帧/导出/取消/错误
node scripts/check-host.mjs     # Host 配置/env/启动单飞/参数/job 归属/路由/Tool/artifact 字节校验/清理
npm run check
```

`scripts/` 只用于本地检查与 staging，不在根包 `files` 安装清单内。

## 未验证（复审/安装后按另行授权验收）

- 真实 DSH 激活后的路由鉴权、Tool 可见性/模型体验、真实安装/加载/卸载/重启、HMR 替换；
- 真实页面视觉/键盘焦点/明暗/窄窗/草稿保持、真实 worker 启停与产物字节；
- 真实引擎子进程链必须在复审通过的 P2-003 快照上运行（本轮若未取得该提交则未执行）；
- Windows/Linux、Chrome/FFmpeg 缺失、用户素材、多用户权限、OS 沙箱、Range/连续预览均未验证。

仓库中的原始方案、开发包及截图用于追溯，采纳范围以产品文档、决策和当前任务为准。
