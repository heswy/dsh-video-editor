# DSH Video

运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。目标是让 AI 创建可编辑的视频工程，用户直接修改后，AI 能继续编辑同一份工程并导出 MP4。

用户确定的入口（P0-005，延续到本阶段）：DSH 左侧原生导航中，在「上下文洞察」之后、「工作区」分组之前，单行 **Vedio Editor** + 细线条视频图标。原顶部「普通｜视频」胶囊已移除。入口是产品工作区导航，不改变 Agent preset、模型或权限。

当前阶段：**P3-006-A** 接入右侧原生创作会话（原生 Conversation/Composer/模型 seat/历史）与 Host 工程会话映射，开发候选版本 **0.3.0-alpha.1**；本机安装仍是上一受控候选，本轮**未安装、未启停、未改 profile、未创建真实用户会话、未调用模型**。运行时契约基线为 DSH Desktop **0.2.1-rc.2**（应用包与运行 Host 已分别核对，见 `docs/research/P3-005A-native-conversation-contract.md`）。

- [当前状态与下一步](docs/STATUS.md)
- [开发与协作规则](docs/DEVELOPMENT.md)
- [产品范围](docs/product/PRODUCT.md)
- [前端设计规划](docs/design/FRONTEND-DESIGN.md)
- [决策记录](docs/DECISIONS.md)
- [ADR-0001 引擎 worker](docs/adr/0001-independent-video-worker.md)
- [ADR-0002 Host 桥运行时与边界](docs/adr/0002-host-bridge-runtime-and-boundaries.md)
- [P2-002 Host 契约调查](docs/research/P2-002-host-bridge-contract.md)
- [P3-005-A 原生会话契约调查](docs/research/P3-005A-native-conversation-contract.md)

## 本版交付（0.3.0-alpha.1，本地开发候选）

| 项 | 值 |
|---|---|
| 包名 / Loader 行 id / Client 模块 id | `dsh-video` |
| Bundle 版本 | `0.3.0-alpha.1` |
| Host 路由 | `POST /api/dsh-video/request`、`GET/HEAD /api/dsh-video/artifact?jobId=…` |
| Host 请求方法 | doctor/open/inspect/edit/frame/render/status/cancel/close，以及面板专用的 session.list/session.create/session.select/session.diagnose |
| Tool | `video_engine`（同一 dispatcher；非 doctor action 必须来自绑定工程的受信 Agent Session） |
| 侧栏入口 | `sidebar.panellist`，`id: dsh-video`、`order: 30`、label `Vedio Editor` |
| 面板 key | `main` keyed slot 的 `dsh-video`；另声明私有 session child，仅用于取得原生 `SessionProvider` kit |
| 引擎依赖 | 独立 `dsh-video-engine-client` / `dsh-video-engine-worker`，仅开发 staging 快照内解析；本任务仍固定已审 `54f4671` / 两包 `0.1.1` |

`index.js` 是 Host half：一个 plugin-local `VideoBridge` 同时服务精确 Fetch 路由和 Tool；`host/` 保存校验、错误映射、环境清理、worker 适配、产物发布，以及插件自有的会话映射（`host/sessions.js`、`host/session-state.js`）。`client.js` 是手写浏览器半（`window.__ModuleLoader__.load` 格式），只 `require('react')`，通过文档相对 `fetch('api/dsh-video/request')` 调用 Host；右侧 AI 直接渲染宿主原生 `conversation.content` Factory，不自建聊天。

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
    sessionStatePath: /absolute/private/session-state.json   # 插件自有的工程↔会话映射（原子写）
    sessionCwd: /absolute/private/creation-cwd                # Host 创建创作会话的受信 cwd
    # 可选上限：startupTimeoutMs/requestTimeoutMs/shutdownTimeoutMs/maxRequestBytes/
    # maxArtifactBytes/maxResultBytes/maxPending 等，见 host/config.js
```

- `workerNode` 经 `ctx.subprocess.resolveExecutable` 验证后才启动 worker；Host 构造**完整、清理后的子进程环境**（去掉 `ELECTRON_*`、`NODE_*`、`DSH_*`、`npm_*` 等继承项，不修改 `process.env`），并显式传 `cwd`。
- 启动前只读校验 registry（root/projects/outputRoot/browserPath）、allowlist 项目存在且位于 registry.root 内、`artifactRoot === realpath(outputRoot)`；不会写入工程内容。
- 缺 `env`/`cwd` seam 的旧引擎 client 会被拒绝（需要复审通过的 P2-003 快照）。
- `sessionStatePath`/`sessionCwd` 缺失只禁用创作会话与历史，画面预览、编辑与导出仍可用；两者都在可信配置里，UI 只能传工程 id 与已登记 session id，不能指定路径。

### 工程会话与上下文

- 映射由插件 Host 唯一拥有并持久化：`projectId → sessionIds/activeSessionId`，一工程多会话、一 Session 只属于一工程；文件带版本号，写入串行并使用临时文件 + rename，坏文件/未知版本不被静默清空。消息、标题与模型选择仍以 DSH Session 为权威，插件不复制聊天日志或凭据。
- 新会话由 Host 侧 Session Controller 以受信 `sessionCwd` 创建，只接纳实际返回的 id；客户端双击/重试以 requestId 与单飞去重。历史只列本 Host 登记到该工程的会话；工程内切换会话不导航宿主、不回滚工程。
- 绑定期间 Host 通过受支持的 `systemPrompt.context` 为对应 Agent 提供实时工程 id、最近 revision 与可用目标能力摘要；上下文不是授权，每个 Tool 操作仍按持久映射检查。
- `video_engine` 的工程/作业操作从**可信 `exec.agent`** 提取 Session 身份（`agent.session.id`，与 `agent.id` 同时存在时必须一致），按映射校验 projectId 与 job 归属；无 Agent、未绑定、跨工程分别返回 `E_AGENT_REQUIRED` / `E_SESSION_NOT_BOUND` / `E_PROJECT_SCOPE`。`doctor` 不受绑定限制；UI Fetch 路径保持自身连接与工程边界。
- 工程会话允许被宿主搜索/历史发现，不创建独立 Workspace，不通过归档隐藏。模型选择复用原生 Composer seat，下一次请求生效。

### Host 请求与 Tool

- 请求体为 JSON `{ "method": "...", "params": { ... } }`，正文默认上限 64 KiB；拒绝额外字段、未知方法、任意 path/URL。项目参数只能是配置 allowlist 的 id；`status`/`cancel`/`artifact` 还必须对应该 Host 实例已登记、由本实例启动的 job。
- Tool 与路由调用同一个 dispatcher；错误统一为 `{ code, message, stage, uncertain?, jobUnknown? }`，保留 edit 的结果不确定性、frame/render 丢失 jobId 的不确定性；Host 不自动重试写/渲染，也不保存第二份 revision 或 operationId 结果。Tool execute 与渲染共用 64 KiB 原始 UTF-8 字节预算；超限返回 `E_RESULT_LIMIT`，不截断后伪装成功。
- 成功 frame/render 登记 `jobId → projectId/revision`；`GET/HEAD artifact` 会重新向 worker 取 succeeded 记录，再校验 UUID 文件名、realpath 在输出根、普通文件、大小上限与 SHA-256，才发布 PNG/MP4。只支持完整 GET/HEAD，不做 Range、目录列表或任意 URL 代理；不返回绝对路径、源码、stderr。
- 无 per-session ACL、无多用户工程隔离；当前只允许受控 fixture。worker 路径校验不是安全沙箱。

### 界面

- 无工程时左侧保留一句「尚无工程」和一个可工作的「打开示例」动作；右侧 AI 常驻并给出真实状态。
- 打开后：左侧显示来自真实 `inspect` 的标题/尺寸/时长与当前 revision 的 PNG；画面时间、更新画面、目标/标题/时序编辑、导出 MP4、取消与真实作业状态保留。右侧为原生 Conversation embedded occurrence（无宿主主 Header、无宽把手），保留原生 Composer、模型 seat、权限、审批、附件与 Stop；`hero:false` 保证不会经 hero 入口导航宿主。
- 右上提供「新会话」与「创作历史」：历史只列本工程已登记会话并标出归档/不可用状态；选择旧会话清空当前编辑根后重新绑定，不回滚工程。无可用配置或宿主 kit 缺失时显示准确提示，预览与导出不受影响。
- 打开中/打开失败/就绪按 Session snapshot 表达，不会用无条件 active 掩盖 open 错误。详细元数据（stableId/capabilities）放在按需展开的「属性」区；没有假播放、时间线、场景卡片或静默自建聊天。

## 开发 staging（固定引擎提交）

根仓库不是完整发行包；worker/client 依赖通过**不可变开发快照**准备。最终 staging 必须使用主会话复审通过的 P2-003 引擎提交。

```sh
node scripts/stage-dev.mjs   --engine-commit <reviewed-P2-003-sha>   --bundle-version <reviewed-bundle-version>   --node /absolute/real/node   --browser /absolute/chrome   [--font /absolute/font] [--out /absolute/staging-dir]
```

`--bundle-version` 必须显式给出，且与所固定提交根 `package.json` 的版本（当前 **0.3.0-alpha.1**）完全一致；非法 semver 或不一致会在创建输出目录、安装依赖之前失败，脚本不会猜测或隐式接受任意版本。后续升级根版本时同步传入新版本，不删除这项校验。

脚本要求根 worktree 干净、引擎包版本为复审的 `0.1.1` 且暴露 `./worker` / `./package.json` 导出；用该提交的 client/worker 快照 + `npm ci --ignore-scripts` 准备依赖闭包与受控 fixture，生成：

```text
<staging>/
  bundle/                  # 0.3.0-alpha.1 根 bundle；仅此快照内加本地依赖与 node_modules 链接
  engine-client/           # 固定 engine commit 快照
  engine-worker/           # 固定 engine commit 快照 + 依赖闭包 + artifacts fixture/registry/output
  config.json              # 仅此快照的绝对路径 Host 配置（含 sessionStatePath/sessionCwd）
  session-cwd/             # 仅此快照的受信创作会话 cwd
  INTEGRITY.json           # 根/引擎提交、版本、文件摘要、依赖/解析证据、限制
```

- 相对 `file:` 依赖与链接只对这个开发快照有效，**不是可移植发行 tarball**；正式分发另行定义。staging 会在**快照副本**的 `cordis.patch.yml` 注入本次可信 config（根提交的 patch 仍是空 `config: {}`），因此 link 安装后无需手改 profile。
- 缺 esbuild 二进制或 pendingBuilds 时记录为阻塞，不运行 postinstall/未知构建脚本、不升级依赖。
- staging 校验/真实受控引擎链（不改 DSH 安装）由 `scripts/lib/staged-host.mjs` 先核对 INTEGRITY 中的 Host/config/patch/engine 源文件摘要和包解析，再实际 import **staging 内的** Host，拒绝被改动或混入未记录源文件的快照：

```sh
node scripts/test-host-engine.mjs --staging /absolute/staging-dir
```

该脚本通过 staging 内的 `VideoBridge` 跑 doctor→open→inspect→title/timing edit→inspect→frame/status/PNG 字节→render/status/MP4 字节→取消→close→dispose，并把脱敏证据写入 staging 同级的 `evidence/`（不修改不可变快照）；它**不等于** DSH 真实激活或真页面验收。

## 安装（需用户明确授权；由 DSH 界面执行）

本仓库未做 profile 修改，0.3.0-alpha.1 未安装。复审通过并完成 staging 后：

1. 侧栏 **Plugins → Add plugin**，填入 staging 的 `bundle/` 绝对路径（开发 link）或审阅通过的固定包；
2. **Install**，完成后 **Enable now**；
3. 在插件 Loader 行填入 `config.json` 对应的可信配置（或由部署安装流程写入）。

安装后最小人工清单（需另行授权）：

1. 打开 **Vedio Editor**，确认左侧画面/导出仍工作、右侧 AI 常驻且无宿主主 Header；
2. 点「开始创作」，确认只创建一个会话、Composer 出现并可切换模型（不发送真实请求前不冒充回复）；
3. 再点「新会话」创建第二个，确认历史列表按工程出现并可在两者间切换；切走其他导航再返回，确认同一 Session 只有一个编辑根且历史可恢复；
4. 若宿主同时打开同一会话，插件应显示提示而不是抢占编辑根；审批/权限 UI 只来自宿主原生 take-over。

不要在 shell/profile 中手改 `package.json`、`cordis.patch.yml` 或 `node_modules`；安装和 bundle 选择由 Plugin Manager 负责。

## 停用与回滚

- **停用**：Plugins 页面关闭 `dsh-video`。Host 停止接受新请求并 `await` 一次 worker dispose；UI/侧栏/路由/Tool/会话引用与 prompt context 随 fiber 释放。worker 只在插件停用/移除时收尾，切换视频面板或返回对话不会停止共享 worker。
- **重新启用**：再次打开开关；worker 在第一次业务请求时惰性启动，不随面板挂载启动；历史与映射从 `sessionStatePath` 恢复，草稿由宿主会话保留。
- **回滚**：保留并恢复当前已安装的受控候选；移除 0.3.0-alpha.1 bundle 后重新安装上一固定 tarball，或按 Plugin Manager 历史选择回退。浏览器偏好可删除 `localStorage['dsh-video.ui.v1']`；如需清理插件映射，可在插件停用后按运维流程删除 `sessionStatePath`（不会删除 DSH Session）。
- **数据影响**：本插件不写 DSH session 事件、不写 profile；工程内容只由受控 worker 写入其配置的 registry 工程目录；云不可用或映射文件损坏时不会静默删除任何会话或工程。

## 本地检查（零构建，无安装）

```sh
node --check index.js
node --check client.js
node --check scripts/check-host.mjs
node scripts/check.mjs          # manifest/patch/exports/files/locale/侧栏契约/会话接线/UI 范围
node scripts/smoke-client.mjs   # Client 模块、侧栏原子生命周期、原生会话 kit/历史/切换、真实打开/编辑/帧/导出/取消/错误
node scripts/check-host.mjs     # Host 配置/env/启动单飞/参数/job 归属/路由/Tool/会话持久化与范围/artifact 字节校验
node scripts/test-stage-version.mjs  # staging 版本门禁行为回归（不安装依赖、不生成快照）
npm run check
```

`scripts/` 只用于本地检查与 staging，不在根包 `files` 安装清单内。

## 未验证（复审/安装后按另行授权验收）

- 真实 DSH 激活后的 kit 形状与 SessionProvider 实际渲染、嵌入聊天/焦点/审批/模型切换、HMR/停用/重连与真实模型请求；
- 真实页面视觉/键盘焦点/明暗/窄窗/草稿保持、真实 worker 启停与产物字节；
- 真实引擎子进程链只能在复审通过的固定 staging/引擎提交上运行，证据归属以 `INTEGRITY.json`/执行路径为准；
- Windows/Linux、Chrome/FFmpeg 缺失、用户素材与资产导入（PNG/JPEG 先行，SVG/音视频仍缺口）、多用户权限、OS 沙箱、Range/连续预览均未验证。

仓库中的原始方案、开发包及截图用于追溯，采纳范围以产品文档、决策和当前任务为准。
