# P3-006-A 交付记录：右侧原生 AI、创作历史与会话范围接线

日期：2026-10-18（Asia/Shanghai）。执行：p0-mode-shell（`dsh/p0-mode-shell` / PR #3）。基线 `7daa039`；实现提交 `26bd4c1ab1f7faabc6cb8a6f067dc9de4d5744f9`。根包 **0.3.0-alpha.1**；引擎仍固定已审 `54f467147ae2f61e118099c4947f55e8da877500`（client/worker 0.1.1）。本文件是开发者自述交付记录，不是总调度验收，也不是安装/真机证据。本轮**未安装、未启停/重启、未改 profile、未创建真实用户会话、未发模型请求、未 merge**。

## 1. 结论（先行）

- 右侧原生创作会话已按 P3-005-A 契约接线：`main` 面板声明私有 session child 取得 kit，用 `source:'videoView'` 的 owned SessionReference 显式绑定，渲染 embedded `conversation.content` Factory（`hero:false`、固定 Chat view、无 widthControls/宿主 Header），保留原生 Composer、模型 seat、权限、审批、附件与 Stop。
- Host 新增插件自有的工程↔会话映射与创建协调：可信 `sessionStatePath`/`sessionCwd`、版本化原子写、请求去重与单飞、重启恢复、坏文件/未知版本不静默清空；UI 只能传工程 id 与已登记 session id。
- `video_engine` 的工程/作业操作改从**可信 `exec.agent`** 取 Session 身份（实测随包调用点使用 `exec.agent.session.id`），按持久映射校验 projectId 与 job 归属；`doctor` 不受绑定限制。绑定期间通过受支持 `systemPrompt.context` 注入新鲜工程 id/revision/目标能力摘要，bridge dispose 时释放。
- 客户端左侧保留真实 PNG 预览/编辑/导出，右侧常驻 AI；提供真实「开始创作 / 新会话 / 创作历史」，无会话时显示真实状态而非伪造聊天；mainView 保留计数不再单独锁死视频页，宿主主对话可见时以提示代替第二编辑根，面板卸载会释放引用。
- 自动检查：静态 **40/40** + Client smoke **52/52** + Host 契约 **25/25** = **117/117**（原 103 项全部保留并通过，新增 14 项）；版本门禁回归 **10/10**。
- 固定包 `dsh-video-0.3.0-alpha.1.tgz`：**55,723 B / 19 files / SHA-256 `a5bbffa4…ccabd60`**，19/19 与实现提交逐字节一致。
- 新 staging `staging-54f4671-26bd4c1`：INTEGRITY SHA-256 **`c282cb11…4ee3af`**，源码/引擎/配置摘要与真实 Host→worker 链均通过；旧安装与旧候选未动。
- **未验证**：真实 DSH 安装后的 kit/Provider/Factory 渲染、真实 Session 创建与模型/审批/附件/历史交互、HMR/停用/重连；本轮没有真机证据。

## 2. 实现范围与关键选择

### 2.1 Host：会话映射与创建（新增 `host/session-state.js`、`host/sessions.js`）

- 配置新增可信键（`host/config.js`）：`sessionStatePath`（绝对路径，插件自有映射文件）、`sessionCwd`（绝对目录，Host 创建会话的受信 cwd）。二者缺失只禁用会话功能并返回 `E_SESSION_CONFIG`，预览/编辑/导出不受影响。UI 不能提供路径。
- `SessionStateStore`：文件格式 `{version:1, projects:{projectId:{sessionIds,activeSessionId,createdAt,updatedAt}}, sessions:{sessionId:{projectId,createdAt}}}`；只保存 id 关系，不存消息、标题、凭据或 revision。写入串行队列 + 同目录临时文件 `rename` 原子替换（0600）；读取时严格校验版本/字段/交叉引用，**坏文件与未知版本原样保留**，以 `E_SESSION_STATE_CORRUPT` / `E_SESSION_STATE_VERSION` 失败。未知 project 保留在文件中但不经 allowlist 暴露。
- `SessionService`：
  - `list(projectId)`：只列本 Host 登记的会话；按 `workspaceRegistry.archivedSessionIds` 与 `sessionController.inspect` 标注 `available/archived/unavailable/unknown`；不自动解归档。
  - `create(projectId, requestId?)`：使用 `sessionController.create({cwd: sessionCwd})`（Host 侧受支持 controller 接口），只接受**实际返回**的 id；`requestId` 去重 + 同工程并发单飞；映射写成功后才返回成功；写失败不报告绑定成功；标题 best-effort `projectId · 创作 N`，不因 rename 失败回滚。映射/控制器/状态文件错误分别映射 `E_SESSION_*`。
  - `select(projectId, sessionId)`：只允许该工程已登记会话；不导航宿主。
  - `diagnose()`：只读预检（contract/bundleVersion/enabled/error/controller/promptContext/store 计数），不含消息、标题、路径或凭据。
  - `ensurePromptContext()`：注册一次 `systemPrompt.context({name:'dsh-video:project', order:4500, text})`；text 从 assembly 的 `agent` 取 Session id，再查映射与 bridge 的最近 inspect 事实（projectId/revision/duration/size/targets），未绑定/无 agent 返回空串；bridge dispose 时调用 disposer。
- Bridge（`host/bridge.js`）：
  - 请求方法增加 `session.list/session.create/session.select/session.diagnose`，参数严格白名单（projectId、可选 requestId、sessionId 均受格式校验）；tool source 不能调用会话管理方法。
  - `invoke(..., {source:'tool', agentSessionId})`：非 doctor 的工程/作业 action 调用 `assertToolScope`——无身份 `E_AGENT_REQUIRED`、未绑定 `E_SESSION_NOT_BOUND`、工程不匹配或 job 归属不符 `E_PROJECT_SCOPE`；doctor 仍可无绑定诊断；UI Fetch 路径不伪装 Agent。
  - 维护最近 `inspect/open` 的有界工程事实（revision/duration/尺寸/最多 40 个 stableId+capabilities）供 prompt context 与诊断使用，不写回工程内容。
- Tool（`host/tool.js`）：集中 adapter `agentSessionIdFromToolExec` 从 `exec.agent.session.id`（随包 tool runtime 真实使用）取身份，兼容公开投影的 `agent.id`，两者同时存在必须一致，否则 `E_AGENT_IDENTITY`；身份随 `{source:'tool', agentSessionId}` 交给 dispatcher，工具参数中没有、也不信任 `sessionId`。
- `index.js` 未改：bridge 内部创建 SessionService；无新硬依赖。缺 `systemPrompt`/`sessionController`/`workspaceRegistry` 时相应能力以 `E_SESSION_CONFIG` 或 status=`unknown` 降级。

### 2.2 Client：右侧原生会话与历史（`client.js`）

- `main` 注册新增私有 `children: {'dsh-video.chat': {kind:'single', scope:'session'}}`，只用于让 renderer 合成 `SessionProvider`/`renderSlot`；不注册 child occupant，Factory 在显式 Provider 内直接渲染。client inject 仍为 `['slots','layout','locale']`，通过可选 `ctx.get('sessions')` 取浏览器 Session 服务。
- `SessionConversationHost`：以 `sessions.retain(sessionId,{source:'videoView'})` 取得 owned reference；`ready` 后读 binding 的 session snapshot，`openState:error` 显示本地化错误而不是 Factory，loading 用 `settling`、open 用 `active`；订阅 snapshot，unmount 时先解订阅再 `release()`；父级以 `sessionId:retryTick` 作 key，保证切换时旧组件先卸载释放、再接新引用（迟到 promise 以 cancelled + generation 丢弃）。
- Factory 调用固定为 `renderFactorySlot('conversation.content', {variant:'embedded', phase, hero:false}, {slots:{views: SessionChatView}})`；`SessionChatView` 只 `renderSlot('conversation.session',{view:'chat'})`，不传 widthControls，不渲染宿主 Header；模型 seat、审批 takeover、Composer/Stop/附件全部来自原生。
- 宿主可见性：订阅 `layout.panelInfo`；当宿主主对话面板可见（`activePanelId==='conversation'`）时渲染「已在宿主对话中打开」提示，不挂第二个编辑根；mainView 保留计数本身**不阻止**视频页嵌入（避免返回路径被永久锁死）。真实宿主切走视频面板会卸载本面板，effect cleanup 释放引用。
- 历史/新会话/创建：会话列表来自 Host `session.list`；标题优先读浏览器会话列表的 `title` projection，未命名回退 id；「新会话/开始创作」只在显式按钮 handler 创建，含同步 ref 单飞（双击/重试一次），成功采用 Host 返回 id；「创作历史」列出映射会话并标出归档/不可用，选择走 `session.select`，失败就地提示。
- 布局：`.dv-main` 改为左（真实画面 + 紧凑控制在画面下方）右（AI 常驻，320–400px）两区；窄容器下上下堆叠；无第三列、无场景卡片。根节点暴露只读 `data-session`/`data-session-kit`/`data-session-active`/`data-session-contract`/`data-session-controller`/`data-session-context` 供安装后最小预检，不记录消息或密钥。
- 错误本地化：`E_SESSION_CONFIG/STATE/CREATE/NOT_BOUND/ALREADY_BOUND/AGENT_REQUIRED/PROJECT_SCOPE/OPEN/UNAVAILABLE` 均有中英文案；不复用旧 UI 的「目标下拉」作为主路径。

### 2.3 身份与 API 依据（本轮核对）

- `Agent` 身份：随包 `dsh-tools` 的 `run_code` execute 分支使用 `exec.agent.session.id`（已由 P3-005-A 与本轮实现核对）；`ToolExecutionInput.agent` 公开投影含 `id`，故 adapter 兼容两种真实形状并要求一致。
- `systemPrompt.context`：贡献的 `text` 可以是 `(assembly) => string`；随包 `assembleContextFor` 传入 `{agent, scope}`，因此单个全局 contribution 可对每个 Agent 动态读取映射，无需 per-agent 注册；disposer 随 bridge 释放。
- `sessionController.create`：Host Service 方法（`@Remote('create')`）直接调用 `create({cwd})`，返回 `{sessionId, agentPreset?}`；`SessionCreateRequest` 无 metadata/title，故映射只能由插件 Host 持有（P3-005-A 已核实）。
- 会话状态 store 使用 `node:fs/promises`（无新依赖）；UI require 仍只有 baseline `react`。

## 3. 自动检查与回归

在干净实现提交 `26bd4c1` 上执行：

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm run check` | **117/117** | 静态 **40**（原 37 全保留 + 3 项 P3-006-A 接线/范围/状态）+ Client smoke **52**（原 46 全保留 + 6 项会话）+ Host 契约 **25**（原 20 全保留 + 5 项会话/范围/context） |
| `node scripts/test-stage-version.mjs` | **10/10** | 版本同步 0.3.0-alpha.1；非法/错配/快速失败语义不变 |
| 版本门禁 | `--bundle-version 0.3.0-alpha.1` 通过 | staging 脚本仍只与固定提交 manifest 比较，引擎固定不放松 |

新增回归覆盖（都在自动检查内，用受控 Slot/controller adapter，不冒充真机）：

- Client：kit 存在时 `videoView` retain、`SessionProvider` 收到 owned reference、Factory 参数 embedded/hero:false/Chat/无 widthControls；ready 但 openState:error 不渲染 Factory；宿主对话可见时提示且不挂第二编辑根；mainView 保留计数不阻止隐藏宿主时嵌入；卸载释放引用；双击创建只发一次；历史只列 Host 映射并丢弃迟到切换；没有自造模型控件。
- Host：创建使用可信 sessionCwd、requestId 去重、并发单飞、返回 id 写回与 reverse mapping、select 更新 active；重启恢复；未登记 session/坏 JSON/未知版本拒绝且文件不被改写；缺会话配置只禁用会话功能（doctor 仍工作）；Tool 无身份/跨工程/外来 job 拒绝、`agent.id`-only 与 `agent.session.id` 两种真实形状可用、不一致身份拒绝；prompt context 贡献内容、未绑定为空、bridge dispose 释放。

## 4. 固定包（新目录，未覆盖旧包）

| 项 | 值 |
|---|---|
| 路径 | `artifacts/p2-b/26bd4c1/dsh-video-0.3.0-alpha.1.tgz` |
| 大小 / 文件数 | **55,723 B / 19 files** |
| SHA-256 | **`a5bbffa4f8dc65d131f42b479be313fb6d8c77b7676830fbf7a07ed91ccabd60`** |
| 包内字节 | 解包 19/19 与提交 `26bd4c1` 对应文件逐字节一致；`scripts/**`、`spikes/**`、docs 不在包内 |
| 旧包 | `0.2.2`（`97c0609`/`8c6bf26`）与 `0.3.0-alpha.1` 之前候选均保留未动 |

## 5. 新 staging（仓库原脚本直接生成）

命令（干净提交 `26bd4c1`）：

```sh
node scripts/stage-dev.mjs --engine-commit 54f4671 \
  --bundle-version 0.3.0-alpha.1 \
  --node '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node' \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --out '<artifacts>/p2-b/staging-54f4671-26bd4c1'
```

| 项 | 值 |
|---|---|
| 目录 | `artifacts/p2-b/staging-54f4671-26bd4c1`（255 MB，全新） |
| rootCommit / rootDirty | `26bd4c1ab1f7faabc6cb8a6f067dc9de4d5744f9` / `false` |
| engineCommit | `54f467147ae2f61e118099c4947f55e8da877500` |
| 版本 | bundle `0.3.0-alpha.1` / client `0.1.1` / worker `0.1.1` |
| 版本门禁 | expected=manifest=`0.3.0-alpha.1`，source 为 committed root package.json |
| INTEGRITY.json SHA-256 | **`c282cb11966a627eb4b816d5bd645399a903fff5cae9a3596e0e308b774ee3af`** |
| config.json SHA-256 | `41e9d5e3d8499421a7521eb877e68d7847fbfb4b6a844539fd84241dbeb720fb`（含 `sessionStatePath`/`sessionCwd`） |
| staged patch SHA-256 | `3bc7333dda666219f692661f798d8c0ef03ab8688e3ad988f73ae1a90b827815`（仅注入 config 对象，与 config.json 一致） |
| 文件摘要项 | bundle 18 / client 12 / worker 15，按 INTEGRITY 重算一致 |
| bundle 源文件 | 17 个未改运行时文件（含 `host/sessions.js`、`host/session-state.js`、README）与 `26bd4c1` 逐字节一致；package.json 仅按预期加 `file:` 依赖；patch 为部署变换 |
| engine 源文件 | 27 个 client/worker 源码文件与 `54f4671` 逐字节一致 |
| 会话配置 | `sessionStatePath=<staging>/session-state.json`、`sessionCwd=<staging>/session-cwd`（目录已创建）；旧 0.2.x 安装与 staging 未动 |

## 6. 真实 Host→worker 链（新 staging；不是 DSH 激活）

`node scripts/test-host-engine.mjs --staging <新 staging>` exit 0：

| 项 | 值 |
|---|---|
| 证据文件 | `artifacts/p2-b/evidence/engine-run-2026-10-18T03-15-52-552Z.json`（18,313 B / SHA-256 `ad675cbe04bed9abea3ab52be90754fb11982351f80860bcc1ed4ef96bfaacac`） |
| 执行归属 | staging 内 Host，`hostModuleSha256=5a19e216…`、`integrityVerified:true`；未 import 开发树 Host |
| 环境 | Node v24.21.0；Chrome 155.0.8059.xx；FFmpeg/ffprobe 8.0.1（与前候选同引擎） |
| 工程链 | open→inspect→`hf-title` 文本+时序 edit revision `135a529…`→`f714e71…`→inspect |
| 帧 / 导出 | PNG **279,463 B / `875b48c6…`**；H.264 MP4 **135,855 B / `fae2687e…`**（与 staging output 文件字节一致；与前候选确定性一致） |
| 取消 / 生命周期 | 第二次 render cancel `cancelled`+`cleaned:true`；`close.closed:true`、`disposed:true` |
| 恢复 | 用 staging `npm run prepare-fixture`（保留 browserPath）恢复 demo：`index.html` 与 fixture 字节一致（`8080d8b0…`）、标题 `让创意成为影像`、无 `· Host`；INTEGRITY SHA 未变 |

说明：本轮 Host 源码有变化（bridge/tool/session），因此复跑真实链；它验证现有 worker 路径不回归，**不验证 Session 创建/嵌入/模型/审批**（这些需要安装后的真实 DSH 激活）。

## 7. 未测与未决

- 未安装/启停/重启、未改 profile、未创建真实用户会话、未发模型请求；因此以下均为**未验证**：真实 Host 的 kit 形状与 SessionProvider/Factory 渲染、Composer/模型 seat/审批/附件/Stop 交互、工程会话在宿主侧栏/搜索的实际可见性、HMR/停用/重连、真实 sessionStatePath 权限与跨进程并发、安装/卸载/回滚。
- `sessionController.create` 的直调在受控 adapter 下通过；真实 Host 服务调用需要在安装验收中确认（若不可直调，最小差异是改走受支持的 Host API，不影响 UI 契约）。
- 审批期间原生 Composer/Stop 被 takeover 隐藏是已接受宿主行为；首版不提供独立 Stop。
- 工程会话可被宿主搜索/历史发现是已接受行为；没有创建独立 Workspace 或归档隐藏。
- 引擎仍为 `54f4671/0.1.1`；多 Scene/画布/素材资产导入按后续任务接（P3-005-B 与资产任务），本轮未改 engine、未做假播放/点选/素材按钮。
- 真实链证据只代表受控 fixture；不把它称为 DSH 真机激活。

## 8. 证据索引

| 主题 | 位置 |
|---|---|
| 实现提交范围 | `7daa039..26bd4c1`：README/client/host 5 文件/package/scripts 5 文件 |
| 会话状态与协调 | `host/session-state.js`、`host/sessions.js`、`host/bridge.js`（session 方法/assertToolScope/projectFacts）、`host/tool.js`（身份 adapter） |
| Host 配置 | `host/config.js`（sessionStatePath/sessionCwd）、README「Host 可信配置」 |
| 客户端嵌入/历史/生命周期 | `client.js`（SESSION_SOURCE/SESSION_CHILD_SLOT、SessionConversationHost、aiPanel、refreshSessions/createSession/chooseSession、面板可见性订阅） |
| 自动检查 | `scripts/check.mjs`、`scripts/smoke-client.mjs`、`scripts/check-host.mjs`、`scripts/test-stage-version.mjs` |
| 固定包 | `artifacts/p2-b/26bd4c1/dsh-video-0.3.0-alpha.1.tgz` |
| staging/INTEGRITY | `artifacts/p2-b/staging-54f4671-26bd4c1/INTEGRITY.json` |
| 真实链证据 | `artifacts/p2-b/evidence/engine-run-2026-10-18T03-15-52-552Z.json` |

## 9. 复审 R1–R4 修复交付（2026-10-18 复审后）

依据 [P3-006-A 复审](../reviews/P3-006A-review-01.md)。修复提交 **`b38268647bd926c205efcb1067a4eaaeecf93cee`**（`fix(session): publish mappings after durable write and drain session lifecycle`，父 `eb8d2d8`），沿用本树/PR #3、P3-006-A 白名单与固定引擎 `54f4671/0.1.1`；根版本保持 `0.3.0-alpha.1`。改动 4 文件：`host/session-state.js`、`host/sessions.js`、`host/bridge.js`、`scripts/check-host.mjs`；未改 client/UI、engine、全局文档。

### 9.1 R1 写盘失败不再发布内存映射/工具权限

- `SessionStateStore.queueWrite` 改为**候选状态隔离**：从已提交 `this.state` 深拷贝 candidate，`mutate(candidate)` 后先 `write(candidate)`（临时文件 + rename），**rename 成功后才 `this.state = candidate`**。失败时不改变权威内存，读者在写入期间仍看到旧状态；`write()` 失败会删除临时文件。
- 回归：目标路径为目录制造真实 `EISDIR` → `addSession` 失败、`projectForSession` 为 `null`、project 列表不变、无 `.tmp-*` 残留；移除故障后排队写入可成功；受控延迟 `write` 时读取者看不到 pending candidate，两个排队写正确组合。

### 9.2 R2 Session 准入/排空与停用顺序

- `bridge.invoke` 的 `session.*` 分支不再提前 return：与 worker 请求一样加入同一 `inFlight`，`dispose` 的 `Promise.allSettled([...inFlight])` 会等待已接受的 create/list/select 收束；closing 后新请求仍 `E_WORKER_DISPOSED`。
- `SessionService` 增加 `closing/disposed` 与幂等 `disposePromise`；`requireActive()` 拒绝关闭后的新工作；`dispose()` 先 `await Promise.allSettled([...creating.values()])`（create 任务包含 controller.create、映射原子写与 rename），**再** dispose store，**最后**释放 prompt context。`ensurePromptContext` 在 closing/disposed 后不再注册。
- 回归：controller.create 卡住时 `inFlight.size===1`、dispose 不提前完成、closing 后新请求拒绝、放行后 create 成功且映射已持久化、重复 dispose 同 promise；rename 延迟时 dispose 等待、映射在 context 清理前持久化、晚到 create 不再注册第二个 context。

### 9.3 R3 已知映射错误在宿主创建 Session 之前拒绝

- `create` 在调用 controller 前先 `await store.project(projectId)`（触发 `ready` 与完整校验），并检查 `MAX_SESSIONS_PER_PROJECT`；损坏/未知版本/工程归属/数量上限等已知不可恢复错误直接失败，**不再吞掉 ordinal 读取错误**。预检通过后磁盘才故障的情况仍诚实返回 `E_SESSION_STATE_*`，不声称回滚宿主已建 Session。
- 回归：坏 JSON、未知 version、200 会话上限三种情况下 `controller.create` 调用数均为 **0**，坏文件字节不变，错误码分别为 `E_SESSION_STATE_CORRUPT` / `E_SESSION_STATE_VERSION` / `E_SESSION_STATE_LIMIT`。

### 9.4 R4 requestId 去重按工程隔离

- `created` 缓存键改为 `projectId + "\\u0000" + requestId`；返回前校验缓存 value 的 `projectId`，异构工程不会拿到另一工程结果。同工程重试仍缓存复用，同工程并发仍单飞。
- 回归：允许工程 `a/b` 时同一 requestId 分别创建 → controller 调用 2 次、返回各自工程的不同 Session；同工程重试不新增 controller 调用；同工程并发 create 仍合并为一次。

### 9.5 自动检查与故障复现（修复提交上）

| 项 | 结果 |
|---|---|
| `npm run check` | **123/123**：静态 40/40、Client smoke 52/52、Host 契约 **31/31**（原 25 全保留 + R1×2、R2×2、R3×1、R4×1 故障回归） |
| 版本门禁 | `test-stage-version.mjs` **10/10**（0.3.0-alpha.1） |
| 独立故障探针（复刻复审场景、断言修复后行为） | `/tmp` 运行通过：R1 ghost=null/无临时残留/later write committed；R2 `inFlightWhileCreating=1`、accepted create 成功且持久化；R3 corrupt/unknown-version/cap 的 native create 均为 **0**；R4 异工程同 key 返回 b 自己的 session、controllerCalls=2。证据保存于 `artifacts/p2-b/evidence/p3-006a-fix-repro-2026-10-18T11-29-09.json`（SHA-256 `e9ed7f53f9593354f8496ef675e19a6ee102658add3ed77559099dd82166be20`）与同名 `.mjs` |

### 9.6 新固定包与新 staging（不覆盖旧候选/安装）

| 项 | 值 |
|---|---|
| 固定包 | `artifacts/p2-b/b382686/dsh-video-0.3.0-alpha.1.tgz`，**56,648 B / 19 files / SHA-256 `61e5743082652bfbd0da01d0a5bbacb6e831b84b72edfa781850cabb969f4a7a`**；解包 19/19 与 `b382686` 逐字节一致 |
| 新 staging | `artifacts/p2-b/staging-54f4671-b382686`，仓库原脚本 + `--bundle-version 0.3.0-alpha.1` 从干净 `b382686` 生成 |
| INTEGRITY | SHA-256 **`167f4c419dfc9b2da2d33141845fdd433fca3bff5824160ca4c35a0a3f367ab8`**；rootCommit `b382686…`、rootDirty=false、engine `54f4671…`、bundle/client/worker `0.3.0-alpha.1/0.1.1/0.1.1`、gate expected=manifest=`0.3.0-alpha.1` |
| config / patch | config SHA `a6b1ca4bfcd245d5ebce0bab255d4072299f2852627cf5b89f7618b54c5fd442`、staged patch SHA `d8c996619be48a124815d516705a4fdda4eb5bdb9e9d668e59b4dc73ab0677c3`；bundle 18/client 12/worker 15 摘要一致；未改 runtime 文件（含两个新 host 文件）与提交一致；engine 27 文件与 `54f4671` 一致；session 配置与 `session-cwd` 目录存在 |
| 真实链 | Host 变更后复跑：`artifacts/p2-b/evidence/engine-run-2026-10-18T03-30-02-337Z.json`（18,339 B / SHA-256 `b7251329ade019174e9171189b13826bfa178a3f0afc4b3881259602f80768a2`）；ok=true、rootCommit `b382686…`、worktree dirty=false、staged Host sha `c1538aa6…`、integrityVerified=true；PNG 279,463 B/`875b48c6…`、MP4 135,855 B/`fae2687e…`；cancel `cancelled`+cleaned、close/disposed；跑后 demo 恢复（`index.html`=`8080d8b0…`、无 `· Host`）、INTEGRITY 未变 |
| 旧候选 | `26bd4c1` 的包/staging、安装用旧 staging 与旧 0.2.x 候选均保留未动 |

### 9.7 仍未测

与 §7 相同：未安装/启停/重启、未改 profile、未创建真实用户会话/发模型请求；真实 kit/Provider/Factory 渲染、原生模型/审批/附件/历史、`sessionController.create` 真机直调、HMR/停用/重连、侧栏可见性仍待安装授权验收。本轮故障回归使用受控 controller 与临时目录，不冒充真机；原复审的独立复现脚本断言的是修复前行为，修复验证使用其同场景、断言修复后行为的副本（证据见 9.5）。
