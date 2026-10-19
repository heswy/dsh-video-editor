# DSH Video

> UI 候选：`codex/ui-polish` / `0.3.0-alpha.5`，基于已审 `19a7743`，引擎仍固定 `0deef8f` / `0.4.0`。紧凑工程导航、底部播放条、原生对话高度修正与预览超时恢复见 `docs/tasks/P3-014-ui-polish.md`。此分支不表示已安装；下文 alpha.4 的固定路径仍是历史候选，不能混用版本/摘要。


运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。当前目标是用户通过右侧对话生成视频，左侧自动预览/播放，再通过对话持续修改同一作品；用户手动编辑后续再加。

用户确定的入口（P0-005，延续到本阶段）：DSH 左侧原生导航中，在「上下文洞察」之后、「工作区」分组之前，单行 **Vedio Editor** + 细线条视频图标。原顶部「普通｜视频」胶囊已移除。入口是产品工作区导航，不改变 Agent preset、模型或权限。

当前唯一开发线为 **video-studio / codex/video-studio**。当前任务 **P3-012：对话生成→左侧自动预览/播放→对话续改→自动更新同一作品**；选中、拖拽、原位文字、属性表单等用户手动编辑延期。鹈鹕/球是旧故障回归，功能验收采用通用闭环及不同题材。本候选代码基线根0.3.0-alpha.4、引擎0.4.0：新增受控完整作品提交/读取（project.compose/project.source），左侧改为只读自动预览，交付门禁与开发 staging 通过；**真实 DSH 安装与真实模型对话尚未验收**。最新事实和交接读[STATUS](docs/STATUS.md)、[video-studio](docs/handoffs/video-studio.md)。

- [当前状态与下一步](docs/STATUS.md)
- [开发与协作规则](docs/DEVELOPMENT.md)
- [产品范围](docs/product/PRODUCT.md)
- [前端设计规划](docs/design/FRONTEND-DESIGN.md)
- [决策记录](docs/DECISIONS.md)
- [ADR-0001 引擎 worker](docs/adr/0001-independent-video-worker.md)
- [ADR-0002 Host 桥运行时与边界](docs/adr/0002-host-bridge-runtime-and-boundaries.md)
- [P2-002 Host 契约调查](docs/research/P2-002-host-bridge-contract.md)
- [P3-005-A 原生会话契约调查](docs/research/P3-005A-native-conversation-contract.md)

## 本版交付（0.3.0-alpha.4，本地开发候选）

| 项 | 值 |
|---|---|
| 包名 / Loader 行 id / Client 模块 id | `dsh-video` |
| Bundle 版本 | `0.3.0-alpha.4` |
| Host 路由 | `POST /api/dsh-video/request`、`GET/HEAD /api/dsh-video/artifact?jobId=…`、`POST /api/dsh-video/asset-upload`、`GET/HEAD /api/dsh-video/preview/<snapshotId>/<manifest path>`、`GET/HEAD /api/dsh-video/canvas-runtime.js` |
| Host 请求方法 | doctor/open/inspect/edit/frame/render/status/cancel/close、session.*、preview（文件预览），P3-008 的 project.create/project.list/asset.import/scene.create/scene.update/scene.remove/scene.reorder/project.revise/history/undo/redo/preview.snapshot/preview.release，以及 P3-012 的 project.compose/project.source；asset 上传与 preview.snapshot 为 UI-only，Tool 不能调用 |
| Tool | `video_engine`（同一 dispatcher；非 doctor action 必须来自绑定工程的受信 Agent Session）；P3-012 增加 conversation-first 创作/修改入口 `project.compose`、`project.source` |
| 侧栏入口 | `sidebar.panellist`，`id: dsh-video`、`order: 30`、label `Vedio Editor` |
| 面板 key | `main` keyed slot 的 `dsh-video`；另声明私有 session child，仅用于取得原生 `SessionProvider` kit |
| 引擎依赖 | 独立 `dsh-video-engine-client` / `dsh-video-engine-worker`，仅开发 staging 快照内解析；R2-follow-up 后固定 root `a59fb13` / engine 保持 `0deef8f` / 两包 `0.4.0`（重打 tarball：client 8610 B `14b85c39e89e912d6ab0924c88967c85c83c43921420a8b44334f4a5f35ed513` 内容未变，worker 68190 B `b56dba237e0612497caea40cc53e6b1ef22b7b18f7d36be96f8b94e5502e09f8`） |

| 开发 staging | `artifacts/p2-b/staging-p3-012-r2f-0deef8f-a59fb13`（rootCommit=`a59fb13` / engineCommit=`0deef8f`，clean；`INTEGRITY.json` sha256 `c28b60adadd1fdb419651598220e0dddddb096663d0699f9112058c91bdfe46a`）；仅开发快照，不随包分发 |

`index.js` 是 Host half：一个 plugin-local `VideoBridge` 同时服务精确 Fetch 路由和 Tool；`host/` 保存校验、错误映射、环境清理、worker 适配、产物发布、会话映射、局部图片预览、受控项目/素材收件箱与预览快照路由。`client.js` 是手写浏览器半（`window.__ModuleLoader__.load` 格式），只 `require('react')`，通过文档相对 `fetch('api/dsh-video/request')` 调用 Host；右侧 AI 直接渲染宿主原生 `conversation.content` Factory，不自建聊天。

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
    # P3-008/P3-009 受控工程/素材（0.3.x managed 模式；worker registry 文件同时声明这些根）
    projectsRoot: /absolute/managed/projects                  # 受控工程目录；worker 注册表条目必须 realpath 在此根内
    assetInboxRoot: /absolute/private/asset-inbox             # Host 上传收件箱；UI 不能传任意路径
    # 可选上限：startupTimeoutMs/requestTimeoutMs/shutdownTimeoutMs/maxRequestBytes/
    # maxArtifactBytes/maxResultBytes/maxPreviewBytes/maxAssetBytes/maxPending 等，见 host/config.js
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

### 嵌入会话图片预览（P3-006-C）

全局主面板中宿主右侧栏没有挂载会话 surface，原生会话的文件打开事件不能走 `ctx.sidebarRight`。本版不修改宿主/不猴补全局服务，而是在插件自己的嵌入 AI 区域内按需打开局部预览：

- 点击原生文件卡、内联文件 mention 或 Markdown 本地文件链接时，插件只在该面板的捕获阶段识别路径类目标并拦截；其他点击与宿主原生行为不变。
- 路径交给 Host 受信 `preview` 路由：调用必须携带已登记 `sessionId`，Host 用持久映射校验工程归属，并只允许读取**确有归属**的文件：该工程自己的工程目录、该工程绑定 Session 的工程独立工作目录（新会话创建在 `<sessionCwd>/<projectId>`）、登记到该工程的 worker job 产物、Host 颁发的上传 receipt，以及旧共享根中能由该 Session 自己的消息事件明确引用该绝对路径的遗留文件。同根跨工程文件、任意绝对路径、目录/符号链接逃逸与未支持类型全部拒绝。
- 只按**实际文件字节**嗅探 PNG/JPEG/GIF/WebP 并核对扩展名，不接受重命名为图片的 HTML；超过 `maxPreviewBytes`（默认 8 MiB）直接拒绝。返回有界 data URL，不把 Host 绝对路径作为浏览器 URL。
- 图片显示在右 AI 区域的局部 dialog 中，关闭即回到原会话；不导航普通对话、不占第三列、不替换左工程预览。当前只支持图片内嵌预览；PDF/Office/视频等明确显示“暂不支持内嵌预览”，不假装已支持全部原生文件类型。

### 对话生成、自动预览与续改（P3-012，当前主流程）

- **唯一提交路径**：AI 通过 `video_engine` 的 `project.compose` 提交**完整 HTML composition**（同一路径同时用于首次生成与每轮修改）；发布前 Host+worker 共同校验 composition 契约（原始 48 KiB 且 JSON-escaped 60 KiB 双上限、唯一 `#main`+`data-composition-id`+数值尺寸/时长、inline `<script>` 中的 `window.__timelines={main:…}`、无外部 URL/嵌入元素、仅已声明本地资产、SDK 回环），再原子写入口、字节回读、私有快照证明、写历史；任一失败回滚最后有效作品并返回可操作 typed error（回滚失败才标 `uncertain`）。`project.source` 读取当前权威 HTML+revision 作为修改基线（同样受 escaped 上限，保证单次 Tool 结果有界）。
- **AI 与预览同一修订**：compose 成功返回 `publishedRevision` 与 `preview:{mode:'snapshot',status:'ready',checked:'composition+snapshot'}`（只证明契约+快照管线可服务，不声称浏览器已播放）；Host 立即刷新 prompt facts。左侧 `preview.snapshot` 按同一 revision 加载，播放/seek 由 fixed runtime 自身时钟驱动。
- **自动更新**：左面板对任意已载入工程每 1500ms `inspect` 一次，revision 变化自动换新快照，无需刷新/重开；加载中保留最后有效画面；快照失败显示可恢复错误+重试，不再有旧 PNG/表单降级或永久“画面尚未生成”。迟到的旧工程/旧 revision 结果有 projectId/mounted 守卫，不覆盖当前作品。
- **首开即创作**：`project.list` 返回 `{projects:[{projectId,updatedAt}], defaultProjectId}`；Plugin 自动打开记住的/最近的受管工程并载入其绑定原生 Session，工程无会话时自动创建一次；完全无工程时自动创建一次「空工程+会话」。右侧原生 Conversation/历史/模型/文件预览不变，不常驻第三列、无场景卡片。
- **产品 UI 只读**：对象点选/描边/拖动/缩放手柄、原位文字编辑、浮动属性、目标下拉/颜色/字号/时间表单、“保存修改”、素材抽屉/场景按钮/导出按钮均不出现在当前产品 UI；底层 typed edit/scene API 与旧手动画布实现保留，后续恢复直接编辑时复用。
- **失败保护（协调复审 R1/R2 补修，2026-10-18 第二轮）**：R1 = `project.compose` 的权威 commit 点为入口写+回读+快照证明；其后历史写入失败返回**成功**并以 `history:{status:"degraded",code:"E_HISTORY"}` 结构化降级（真实 `publishedRevision` 不丢，不把已发布内容报成失败，同 operationId 重试返回同一结果）。R2 = 左侧失败时**保留最后有效作品**：新 revision 在隐藏 candidate iframe 预加载，只有其 runtime ready 才替换并释放旧快照；snapshot/runtime 失败保留旧画面（仍可播放）并在就近显示可恢复提示+重试，`data-canvas-revision`/`data-canvas-target-revision` 分别表示已显示/请求中的 revision。Host 快照路由按工程有界保留，切换成功后显式释放。**R2-follow-up（review-02 唯一残留）**：width/height/duration 绑定到每个预览实例，等待/失败期间旧作品的 viewport、letterbox、seek 范围与时长显示不受新 target props 影响，runtime ready 后才原子切换全部显示元数据。独立真 Chrome：chain 261/261（含 R1）、preview 151/151（B1–B5）、R2 压力 159/159、R1 对抗 probe 32/32；R1/R2/R2-follow-up 均 CLOSED。
- **独立复审**：独立 verifier 在冻结 staging 上发现 1 项 HIGH availability 缺陷（quote 密集但契约合法的 HTML 经 JSON 转义后可逾 64 KiB JSONL 帧并杀死 worker）与 2 项校验/声言问题；已在 `d84ec5d` 修复：Host+worker 双侧 escaped ≤60 KiB 上限、timeline 只认 inline `<script>` 且拒绝 null/undefined，并用 post-fix probe 闭环。最终 fix staging 上独立 harness A–E 全过（chain 230/230、browser 41/41）。
- 支持范围由上述 composition 契约决定，不绑定 `product-launch-v1` 模板；首轮采用已验证的 HTML/SVG/GSAP 程序化作品形式，不引入新渲染后端。已知边界：48 KiB（且 JSON-escaped ≤60 KiB）是 AI 编辑路径上限；timeline 暴露是静态必要校验，真正播放由左侧 runtime 证明，静态检查通过但运行时不播放会显示可恢复预览错误而不是假“已完成”；compose 全量替换文档，未要求修改的内容由 AI 保留；真实模型生成质量/长对话效果未在本轮授权内验收。

### 受控画布、工程与素材（P3-008）

- **工程**：0.3.0 managed 模式下，Host `project.list/project.create` 只接受受控模板 `product-launch-v1`，并从 worker 管理的注册表发现/校验 `projectsRoot` 下的工程；新工程先由 worker 真实创建，再创建并绑定原生创作 Session。UI 只采用 worker 返回的 projectId；创建/绑定失败保留已创建工程并诚实报错，可重试会话绑定。
- **画布**：`preview.snapshot` 让 worker 生成私有只读快照；Host 按 manifest 逐文件校验 bytes/sha256 后注册精确 Fetch 路由，entry 注入固定 runtime 并下发严格 CSP（`connect-src 'none'`、inline script hash、`frame-ancestors 'self'`）。客户端以 `sandbox="allow-scripts"`（无 allow-same-origin）加载，按 composition CSS px 做 letterbox/hitTest；播放/暂停/seek 由 runtime 自身时钟驱动，不靠 PNG 轮询冒充播放。
- **直接编辑**：文字/位置/尺寸/颜色/字号通过 worker `edit` 的 `text/layout/style` typed ops 提交，携带 `expectedRevision`+`operationId`；成功换新 revision 并重载快照，失败保留原状并显示可恢复错误。播放中禁止写；Scene 级底色走 `scene.update`，不把调色副产物当工程已改。
- **复审 R1–R5 修复（P3-008 review 01）**：Scene 换色/换 shot 先取当次权威 `inspect` 的完整 `scenes[].template`，只改目标字段并携带新鲜 `expectedRevision`，无完整模板时拒绝破坏性写而不是用 UI 默认值补；拖动/缩放以 `elements[].layout` 静态基座和当前动画逆映射求 patch，移动不携带无关尺寸、不把动画矩形/transform 烘焙进 HTML；原位文字在成功后才关闭编辑，失败/冲突保留草稿、目标与显式重试，不自动重放 uncertain 写；运行时消息恢复严格 v1 信封/允许事件/载荷/单调序号，并明确结算被销毁实例的 pending；Host 文件预览按工程/Session/产物/receipt 归属校验，所有已接请求与上传统一准入/排空，停用后不再发布路由、文件或 receipt。
- **第二轮复审补修（P3-008 review 02）**：Scene 模板文本上限与冻结引擎 0.3.2 对齐（title 1–2048、subtitle/badge 0–2048，Client 复制校验与 Host 模板校验一致，不截断合法文本，2049 超界拒绝且到不了 worker）；原位文字的 operationId 绑定**一次不可变写入尝试**（冻结 operationId/expectedRevision/ops），原样重试发送完全相同的请求并由 worker 幂等返回，不再读取最新 revision 或变化草稿冒充原请求；修改保留草稿或显式刷新形成新意图时，先结算旧尝试的确定/不确定结果，再用新 operationId 与结算后 revision 提交，冲突走显式刷新路径，E_OPERATION_REUSED 不再是死路，用户无需 Esc/重开编辑器脱困。
- **AI 同工程**：右 AI 仍使用原生 Conversation；Host 在 Tool/UI 两条路径上按 Session→工程持久映射校验，Tool 的 `edit` 已支持 text/timing/layout/style，并有受控 scene/history/revise actions（这些是针对 template Scene 的底层能力，产品 UI 当前不再暴露手动入口）。会话 prompt context 注入新鲜 revision、Scene/可编辑 stableId/capabilities 与素材摘要；P3-012 起自由创作工程改用 `project.source`+`project.compose` 全文档路径，prompt 中同时保留 typed edit 提示。
- **素材**：Host `POST /api/dsh-video/asset-upload` 只接受 PNG/JPEG（≤8 MiB、签名/扩展名一致），写入受信 inbox 并返回短期 receipt；`asset.import` 只收 receipt，worker 再按自己的 assetInboxRoot 复制并重算 revision。UI/Tool 都不能传绝对路径或任意 URL；不支持视频/音频/SVG。
- **兼容**：旧 legacy demo 已从产品 UI 过滤（不在自动打开/切换列表中出现）；engine 仍能读取旧 legacy 工程，旧手动画布/表单实现保留在 `previewOnly:false` 代码路径，不伪装具备不存在的 layout/style 能力。

### Host 请求与 Tool

- 请求体为 JSON `{ "method": "...", "params": { ... } }`，正文默认上限 64 KiB；拒绝额外字段、未知方法、任意 path/URL。项目参数只能是配置 allowlist 的 id；`status`/`cancel`/`artifact` 还必须对应该 Host 实例已登记、由本实例启动的 job。
- Tool 与路由调用同一个 dispatcher；错误统一为 `{ code, message, stage, uncertain?, jobUnknown? }`，保留 edit 的结果不确定性、frame/render 丢失 jobId 的不确定性；Host 不自动重试写/渲染，也不保存第二份 revision 或 operationId 结果。Tool execute 与渲染共用 64 KiB 原始 UTF-8 字节预算；超限返回 `E_RESULT_LIMIT`，不截断后伪装成功。
- 成功 frame/render 登记 `jobId → projectId/revision`；`GET/HEAD artifact` 会重新向 worker 取 succeeded 记录，再校验 UUID 文件名、realpath 在输出根、普通文件、大小上限与 SHA-256，才发布 PNG/MP4。只支持完整 GET/HEAD，不做 Range、目录列表或任意 URL 代理；不返回绝对路径、源码、stderr。
- 无 per-session ACL、无多用户工程隔离；当前只允许受控 fixture。worker 路径校验不是安全沙箱。

### 界面

- 打开 **Vedio Editor** 即进入创作：左侧自动出现只读预览（快照加载中显示准备状态；无工程时自动创建一个空工程）；右侧原生 Conversation 常驻，直接输入即可开始。
- 左侧 = 作品预览 + 播放/暂停 + 连续进度条(seek) + 时间；无对象选择/手柄/原位文字/属性表单/素材抽屉/场景卡片/导出按钮；失败显示本地化可恢复错误+重试。
- 打开后左侧按 Host 上报 revision 自动显示并可播放；AI 通过对话提交新 revision 后自动更新同一作品，无需点击“更新画面”。工程切换/返回面板保留当前工程与绑定会话；历史会话切换不回滚工程。
- 右侧为原生 Conversation embedded occurrence（无宿主主 Header、无宽把手），保留原生 Composer、模型 seat、权限、审批、附件与 Stop；`hero:false` 保证不会经 hero 入口导航宿主。上方保留「新会话」与「创作历史」（只列本工程已登记会话）。
- 打开中/打开失败/就绪按真实状态表达，不会用无条件 active 掩盖 open 错误；没有假播放、时间线或静默自建聊天。

## 开发 staging（固定引擎提交）

根仓库不是完整发行包；worker/client 依赖通过**不可变开发快照**准备。最终 staging 必须使用主会话复审通过的 P2-003 引擎提交。

```sh
node scripts/stage-dev.mjs   --engine-commit <reviewed-P2-003-sha>   --bundle-version <reviewed-bundle-version>   --node /absolute/real/node   --browser /absolute/chrome   [--font /absolute/font] [--out /absolute/staging-dir]
```

`--bundle-version` 必须显式给出，且与所固定提交根 `package.json` 的版本（当前 **0.3.0-alpha.4**）完全一致；非法 semver 或不一致会在创建输出目录、安装依赖之前失败，脚本不会猜测或隐式接受任意版本。后续升级根版本时同步传入新版本，不删除这项校验。

引擎版本只接受主会话已复审的固定版本对（当前 `0.1.1/0.1.1`、`0.3.0/0.3.0`、`0.3.1/0.3.1`、`0.3.2/0.3.2`、`0.4.0/0.4.0`）；0.3.x 起使用 managed `projectsRoot`/`assetInboxRoot`。版本对只按主会话明确固定的提交维护，**绝不自动跟随 p1 分支 HEAD**。

脚本要求根 worktree 干净、引擎包版本属于已复审版本对且暴露 `./worker` / `./package.json` 导出；用该提交的 client/worker 快照 + `npm ci --ignore-scripts` 准备依赖闭包与受控 fixture，生成：

```text
<staging>/
  bundle/                  # 0.3.0-alpha.4 根 bundle；仅此快照内加本地依赖与 node_modules 链接
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

本仓库未做 profile 修改，0.3.0-alpha.4 未安装。复审通过并完成 staging 后：

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
- **回滚**：保留并恢复当前已安装的受控候选；移除 0.3.0-alpha.4 bundle 后重新安装上一固定 tarball，或按 Plugin Manager 历史选择回退。浏览器偏好可删除 `localStorage['dsh-video.ui.v1']`；如需清理插件映射，可在插件停用后按运维流程删除 `sessionStatePath`（不会删除 DSH Session）。
- **数据影响**：本插件不写 DSH session 事件、不写 profile；工程内容只由受控 worker 写入其配置的 registry 工程目录；云不可用或映射文件损坏时不会静默删除任何会话或工程。

## 本地检查（零构建，无安装）

```sh
node --check index.js
node --check client.js
node --check scripts/check-host.mjs
node scripts/check.mjs          # manifest/patch/exports/files/locale/侧栏契约/会话接线/UI 范围
node scripts/smoke-client.mjs   # Client 模块、侧栏原子生命周期、原生会话 kit/历史/切换、真实打开/编辑/帧/导出/取消/错误
node scripts/check-host.mjs     # Host 配置/env/启动单飞/参数/job 归属/路由/Tool/会话持久化与范围/artifact 字节校验/预览归属/准入排空
node scripts/test-stage-version.mjs  # staging 版本门禁行为回归（不安装依赖、不生成快照）
npm run check
```

固定 staging 上的真实链（需要绝对 staging 路径；不安装、不改 profile）：

```sh
node scripts/test-host-engine.mjs --staging /absolute/staging-dir          # 旧 demo Host→worker 兼容链 + artifact 字节
node scripts/test-canvas-chain.mjs --staging /absolute/staging-dir         # 受控新工程全链 + R1 scene.template/R3 预览归属条件断言 + Tool project.revise 续改
node scripts/test-canvas-browser.mjs --staging /absolute/staging-dir       # 真 Chrome 快照 runtime 播放/seek/命中
node scripts/test-canvas-workspace.mjs --staging /absolute/staging-dir     # 真 Chrome 驱动真实 CanvasWorkspace 鼠标手势与失败恢复（默认 false 手动路径，产品 UI 当前不可达）
node scripts/test-conversation-chain.mjs --staging /absolute/staging-dir   # P3-012：Tool compose/source 真实链、两题材、连续续改、失败矩阵、真 Chrome 快照播放/seek
node scripts/test-conversation-preview.mjs --staging /absolute/staging-dir # P3-012：真实 client 工作区在真 Chrome 中自动首预览/续改跟随/失败恢复/无手动控件
```

`scripts/` 只用于本地检查与 staging，不在根包 `files` 安装清单内。

## 未验证（复审/安装后按另行授权验收）

- 真实 DSH 激活后的 kit 形状与 SessionProvider 实际渲染、嵌入聊天/焦点/审批/模型切换、HMR/停用/重连与真实模型请求；
- 本轮 P3-012 固定提交 staging（R2-follow-up 后 `artifacts/p2-b/staging-p3-012-r2f-0deef8f-a59fb13`，engine 0.4.0）的本地链/浏览器证据见 docs/research 与交付消息；真实 DSH 安装点击验收仍需另行授权，不能把本地 staging/浏览器证据当安装验收；
- 真实页面视觉/键盘焦点/明暗/窄窗/草稿保持、真实 worker 启停与产物字节；
- 真实引擎子进程链只能在复审通过的固定 staging/引擎提交上运行，证据归属以 `INTEGRITY.json`/执行路径为准；
- Windows/Linux、Chrome/FFmpeg 缺失、用户素材与资产导入（PNG/JPEG 先行，SVG/音视频仍缺口）、多用户权限、OS 沙箱、Range/连续预览均未验证。

仓库中的原始方案、开发包及截图用于追溯，采纳范围以产品文档、决策和当前任务为准。
