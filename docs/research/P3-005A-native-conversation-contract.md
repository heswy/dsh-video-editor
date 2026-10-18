# P3-005-A：原生 AI 对话、历史、模型与素材接入契约（只读调查）

日期：2026-10-18（Asia/Shanghai）。执行：p0-mode-shell（`dsh/p0-mode-shell` / PR #3），开工 HEAD `b204760`。目标：为已确认的 v0.3 界面（左侧直接编辑、右侧常驻 AI、按工程的历史会话、DSH 模型选择、用户素材抽屉）核实**可实施路线与精确契约**；本文件是只读调查与提案，不改根插件/Host/engine，不安装，不创建或编辑会话，不发送消息，不调用模型。

结论标记：**事实**＝本轮从 0.2.1-rc.2 随包源码/文档或 live Inspect 直接取得；**推断**＝由事实组合得出、未 live 验证；**建议**＝落地提案；**未测**＝不能宣称通过。

## 0. 方法与证据边界

- 只读对象：`/Applications/DeepSeek Harness.app/Contents/Resources/`（`Info.plist`、`app.asar`）。`app.asar` 内的包由本地只读脚本 [spikes/dsh-native-conversation/asar-read.mjs](../../spikes/dsh-native-conversation/asar-read.mjs) 解析头部后按路径读取；不执行包内代码，不读 profile 会话正文/凭据/模型密钥。
- live 事实：`cordis_inspect_query`（client/host 的 `Service`/`Slots`/`Builtin`）由**当前运行 Host** 回答；Slot 拓扑取自运行中的页面。
- 协调记忆：本轮 `git fetch origin` 失败（网络错误），按 DEVELOPMENT 规则使用本地缓存的协调提交 `920957d6401b6aa1253b81af48eb91d4d8ec7e72`（2026-10-18 10:01:39 +0800，含 P3-005-A 指南与 p0 handoff）；开发 HEAD 为 `b204760`。
- 官方 skill：`cordis-plugin-development`（随包 `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development`，与 Host 同版本 0.2.1-rc.2）；其 `references/ui-plugin.md` 明确浏览器插件用 `ctx.slots.inject/register`、React 来自模块表、非 baseline import 用 `dsh.client.external`。DESKTOP 内 `app.asar` 目录只有文件读取工具能打开，shell/glob/grep 不能。

## 1. 版本与运行身份（Q1）

**事实**

| 项 | 值 | 来源 |
|---|---|---|
| 应用包版本 | `0.2.1-rc.2` | `Info.plist` `CFBundleShortVersionString`/`CFBundleVersion`；`app.asar/dsh/package.json` 为 `@deepseek-ai/dsh-desktop-runtime` 0.2.1-rc.2 |
| 随包 UI 包版本 | 全部 `@deepseek-ai/dsh-*` 为 `0.2.1-rc.2` | `app.asar/dsh/package.json` dependencies |
| 运行中的 Host | Desktop 主进程 `/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness --expose-internals …`，本机 09:55 启动；本会话环境 `DSH_PROFILE=desktop`、`DSH_HOME=/Users/orange/.dsh`、`DSH_WEB_URL=http://127.0.0.1:49700`（与当前 GUI URL 一致） | 进程列表、本会话环境、运行时上下文 |
| live 契约可用 | 本轮 client/host `Service` 目录、client `Slots` 全树、`Builtin` 均由该运行 Host 返回 | `cordis_inspect_query` 输出 |

**判断**：本轮 live 查询来自 Desktop 0.2.1-rc.2 的运行 Host，与随包源码同版本；“应用包版本”和“实际运行 Host 身份”分开记录（进程/URL/profile 证据）。旧 rc.1 的结论只作历史，不作为本轮 API 依据。

**未测**：没有做安装/激活/重装；没有验证重启后插件与新 UI 的行为。

## 2. 结论先行

1. **原生对话可以嵌入**：`conversation.content` 是 ui-conversation 注册的 Component Factory（scope `session-maybe`），`main` keyed slot 的 occupant 通过标准 kit 拿到 `renderFactorySlot`；声明一个 session-scope child slot 后同一 kit 还会提供 `SessionProvider` 与 `renderSlot`。嵌入 occurrence 用 `{variant:'embedded'}` 时**不渲染宿主主 Header**、不显示 width handles，仍保留共享 body、Composer、审批 takeover、Attachments、Stop、流式消息（这些由 ui-conversation/composer 链和 ui-approval/ui-model-selection 等原生插件提供）。**不需要 iframe，也不复制宿主 DOM。**
2. **显式 Session 绑定可行但需要 SessionReference**：`SessionProvider` 的 `session` prop 接受 `ctx.sessions.retain(id, {source})` 返回的**已拥有** `SessionReference`（不是裸 sessionId）；显式绑定不会改变宿主当前普通会话。工程 panel 当前是 root scope、无 binding，必须自己 retain 并用 Provider 包住 factory occurrence。
3. **工程↔会话映射没有宿主原生字段**：`SessionCreateRequest` 仅 `workspaceId/cwd/sessionId/agentPreset`；`SessionHeader` 只有 `cwd/parentSession/agentPreset` 等，**没有自定义 metadata**。因此“一工程多会话、一会话一工程”必须由 **Video 插件 Host 自己持久化**（工程注册表里的 sessionId 列表），DSH 会话只负责消息与上下文。创建可用客户端 `ctx.sessions.create()`（不发导航、不改宿主选择）；标题用原生 title projection/rename。
4. **模型选择原生复用**：只要 ui-model-selection 与 ui-conversation 同时挂载（0.2.1-rc.2 是随包行），Composer 的模型 seat 自动出现；选择走 per-session provider-grouped 目录，**下一次请求生效**，运行中的 step 保持原模型；插件不建第二套 key/供应商设置。嵌入 occurrence 无需额外接线。
5. **工具有工程上下文**：Host `ToolExecutionInput.agent` 给出 `SessionId`；Tool 可通过插件自己的 session→project 映射做范围校验，或用 `agent.ctx.tools` 注册 per-session 工具。这是“防止历史会话操作另一工程”的落点，不能假设“调现有 Tool 自然正确”。AI 工具写操作的原生审批可见性依赖 ui-approval 的 Composer takeover（嵌入内可见），但**把 VideoBridge 写操作接入审批仍待实现验证**。
6. **素材先做工程自有副本**：原生附件（图片 PNG/JPEG/WebP/GIF 归一化；其它文件 verbatim）有 receipt→durable ref 链路和 Host 读取 API；但“AI 附件→工程 assetId”仍要插件 Host 自己完成：受 session 授权读取字节→校验/哈希→写工程资产库。画布素材导入建议走插件自有 Host 路由（PNG/JPEG 先行）；**SVG/视频/音频是明确缺口**（附件模型无对应媒体类型，音频/视频无专门处理）。
7. **主要未决风险**：工程会话在宿主侧栏/搜索可见性与“同一 Session 双编辑根”的产品约定；`SessionReference` 的 source 键需要插件自声明并避免与 `mainView` 混用；归档会阻断 Agent step（不能用来“隐藏但可聊”）；HMR/停用/重连的草稿与流式恢复只有源码边界，未 live 验证。

## 3. 嵌入形态：Factory、kit 与 SessionProvider（Q2）

### 3.1 事实：slot 与 factory 拓扑（live）

- `main` 是 root-scope keyed slot；当前 live 占位只有 `key='conversation'`。视频面板应以 `name:'main', key:'dsh-video'` 注册（现状见 `client.js:1860`，未改）。
- Factory `conversation.content`：scope `session-maybe`；注册（随包 `dsh-client-ui-conversation/lib/client.js:19733-19795`）：
  - children：`conversation.session`(single,session)、`conversation.composer`(chain,session)、`conversation.composer.bar`(single,session-maybe)、`conversation.input.dock`(list,session)、`conversation.hero.*`；
  - local slots：`views`(session)、`widthControls`(root)。
- 主 shell 只在该 Factory 之外渲染 Header：`dsh-client-ui-conversation/lib/client.js:17536-17555`
  ```js
  renderSlot("conversation.header", {}),
  renderFactorySlot("conversation.content", { variant: "main", phase, hero }, { slots: CONTENT_SLOTS })
  ```
  → 直接渲染 `conversation.content` occurrence **不会**带出主 Header。
- live Slot 树确认 composer 内部的 `conversation.input.model`（模型 seat）、`conversation.input.permission`、`conversation.input.attachments`、`conversation.approval.detail`、`conversation.composer.dock` 均存在。

### 3.2 事实：occupant kit 的合成规则（renderer 源码）

`dsh-client-ui-renderer/lib/client.js`：

- `standardKit`（:736-767）：每个 occupant 必有 `renderFactorySlot`；声明 `children` 后才有 `renderSlot`；**children 含非 root scope 时提供 `SessionProvider`**（`:756-760`）。locale 由 registration 的 `locale` 提供 `t`。
- `factoryKit`（:946-977）：Factory 同规则；occurrence 的 local Components 通过 `useFactorySlot` 选择。
- `scopeAreaProvider`（:705-723）：`explicit = Object.hasOwn(props,"session")`；显式时用 `adapter.bindingSource(props.session)` 的 snapshot 作为 binding，否则继承外层 binding。
- 参考注册形态（ui-conversation 自己的 `main` 行，`:20022-20030`）：
  ```js
  slots.register({ name: "main", key: "conversation",
    children: { "main.conversation": { kind: "single", scope: "session-maybe" } } }, ConversationPanel)
  ```

### 3.3 事实：SessionProvider 的显式绑定

`dsh-client-ui-session/lib/client.js`：

- `bindingSource(reference)`（:837-843）：`reference === undefined` → absent（session-maybe 的 inert/hero 形态）；否则要求是**已拥有、当前 Controller generation 中活跃的 SessionReference**（有 `.binding`/`.sessionId`），否则 `throw "ui-session: Session reference is not active in this Controller"`。
- 参考嵌入样例：`dsh-client-ui-subagent/lib/client.js:780-810`
  ```js
  renderFactorySlot("conversation.content", { variant: "embedded", phase, hero },
    { slots: { views: FixedChatConversationView } })            // FixedChatConversationView: props.renderSlot("conversation.session", { view: "chat" })
  // 外层：
  jsx(SessionProvider, { session: resource.value.reference, children: renderSlot("sidebar.chat.conversation", {}) })
  ```
- `dsh-client-ui-sidebar-right/lib/client.js:1583-1600` 同样用 `SessionProvider session={view.reference}`。

### 3.4 事实：Factory 的嵌入行为

- `ConversationContent`（`dsh-client-ui-conversation/lib/client.js:17741-17878`）读取 `{sessionId, phase, hero, useSession, useSessions, useSessionStatus, useInput, useComposerBlock, renderSlot, renderSlotChain, selectWorkspace, t, useFactorySlot}`；`variant === "embedded"` 只影响 body 的 CSS 类（:17864），不改变数据路径。
- Composer 是 chain：`renderSlotChain("conversation.composer", {sessionId, session, pendingInteraction}, {fallback: composerBar, fallbackOnly: sessionId === undefined, overlay: true})`（:17846-17854）→ 审批/提问等原生 takeover 在嵌入内同样生效。
- `views` 默认 `ConversationSessionView`；嵌入可按样例换成固定 Chat 视图，避免宿主 View 偏好影响。
- **同一 Session 的编辑根**：`inputHub.shellFor(binding)` 以 binding 为键复用唯一 shell（:15757-15801）；README 明确“does not support simultaneous editable roots for one Session”（`dsh-client-ui-conversation/README.md:77,183`）→ 插件必须保证同一 Session **只挂载一个** occurrence（工程切换先 unmount 旧 occurrence）。

### 3.5 建议的最小嵌入骨架（**未经 live 验证**）

```js
// client.js（bundle client half；React 来自模块表，无需 import）
ctx.slots.inject('main', function* () {
  yield ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS,
    children: { 'dsh-video.conversation': { kind: 'single', scope: 'session' } },
    inject: navigation,                    // 现有导航注入保持不变
  }, VideoPanel)
  yield ctx.slots.register({ name: 'dsh-video.conversation' }, VideoConversationArea)
})

function VideoPanel({ SessionProvider, renderSlot }) {
  // reference: 本项目当前创作会话的 ctx.sessions.retain(...)，见 §5
  return reference === undefined ? null
    : jsx(SessionProvider, { session: reference }, renderSlot('dsh-video.conversation', {}))
}

function VideoConversationArea({ renderFactorySlot, renderSlot }) {
  return renderFactorySlot('conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },       // phase/hero 省略推导，固定为已有会话的活跃态（未验证）
    { slots: { views: FixedChatView } })                          // 不传 widthControls ⇒ 无宽把手
}

function FixedChatView(props) { return props.renderSlot('conversation.session', { view: 'chat' }) }
```

说明：声明 `children` 的目的是取得 kit 中的 `SessionProvider`/`renderSlot`（§3.2）；如宿主未来提供更直接的 Provider seat 可简化。**本骨架没有实现**，也没有在真实 Host 中运行；`main` occupant 的 kit 实际是否包含 `SessionProvider`/`renderSlot` 需在实现轮以 live slot 验证（源码规则 + 同 slot 的 ConversationPanel 用法支持该推断）。

### 3.6 manifest external（Q2 补充）

- 事实：`dsh.client.external` 是**字符串数组**（`dsh-client-modules/lib/client.js:67` `optionalStringArray(... "dsh.client.external", decl.external)`）；external 请求按 `<pkg>/client` 归一到动态包 row 或精确静态表键，缺提供方/畸形/自请求/同步环在组合期拒绝（`dsh-client-modules/README.md:50`；解析错误见 `lib/client.js:783-788,833-840`）。
- 本嵌入路线**不需要任何外部 require**：`renderFactorySlot`/`SessionProvider`/`renderSlot` 由 slot kit 注入，`ctx.sessions` 由服务取得，React 是 baseline。因此 `package.json` 的 `dsh.client.external` 可以保持缺省/空数组；只有将来直接 import `@deepseek-ai/dsh-client-ui-conversation/client` 等才需声明（例如类型不可用、需本地组件 API 时）。
- 注意：桌面 app.asar 未随包 `.d.ts`（`files` 声明有 `lib/types/**/*.d.ts`，实际 asar 只有 `lib/*.js`）→ 实现轮以源码/README 契约 + 运行时校验为准，不能依赖本地类型包。

### 3.7 事实：审批 takeover 与 Stop/Composer 的关系

- 审批 UI 通过 `conversation.composer` chain 接管：`dsh-client-ui-approval/lib/client.js:344-354` 注册 `{name:"conversation.composer", select: ({pendingInteraction}) => pendingInteraction instanceof PendingApproval ? pendingInteraction : null}`，children 含 `conversation.approval.detail`（session single）；panel 内 `renderSlot("conversation.approval.detail", {callId})`。
- 该 chain 渲染在 content factory 体内：`renderSlotChain("conversation.composer", {sessionId, session, pendingInteraction}, {fallback: composerBar, overlay:true})`（ui-conversation:17846-17854）。overlay 语义（renderer:1224-1230）：被选中时 fallback（默认 composer，含 Stop/Send）以 `style:{display:"none"}` 隐藏。
- 审批期间固定键（Enter 允许 / Escape 拒绝）由 approval 保留，README 明确 approval 打断 Esc-Esc Stop 序列；`PendingInteraction kind = approval | plan-review | question`（`dsh-client-ui-workspace/lib/client.js:1048-1054`）。
- 推论：embedded `conversation.content` 保留审批 takeover 与 detail；审批进行时 composer 与 Stop 被隐藏。**产品需决定**嵌入处是否要在审批中另给 Stop，或接受宿主行为。
- 未验证：embedded 实例内审批/plan-review/question 的真实渲染与键盘；`ctx.approval.request` 的 open-turn 前提在 Video Tool 调用路径中的满足方式。

## 4. SessionReference 与生命周期（Q2/Q3）

**事实（client `sessions` 服务契约，live Inspect）**

- `retain(target: SessionId|SubagentAddress, {source, signal?}): SessionReference`：立即返回 owned reference 并开始共享 initial history opening；`reference.ready: Promise<SessionBinding>`；`release(): void`。
- `using(target, options, operation)`：回调期间持有，失败也释放；`retainInfo(id)` 是只读 retainedBy 计数；`binding(id)`/`scope(id)` 只借用已 retain 的 generation；`fork`/`search`/`refreshProjections` 另有契约。
- `SessionReferenceSourceMap` 默认只列 `controllerOperation|gateway`，但随包真实调用点使用**声明合并的 source 名**：`ui-workspace` 用 `source: "mainView"`（`dsh-client-ui-workspace/lib/client.js:1653`），`sidebar-right` 用 `source: "sidebarView"`（`:1638`）。源码里 `mainView` retention 同时被 layout/workspace/agent-preset 用来识别“宿主主视图当前会话”（例如 `ui-session/lib/client.js:917,974`；`ui-workspace/lib/client.js:867`）。
- 建议：Video 插件使用**自己的 source 名**（如 `"videoPanel"`，通过运行时字符串传入手写 JS），既不冒用 `mainView`（会改变宿主“当前会话”语义），又能在 `retainInfo().retainedBy` 里被诊断/清理。运行期 source 只是计数键；没有找到会拒绝未知 source 的运行时校验（未 live 验证）。

**建议生命周期**

| 事件 | 动作 |
|---|---|
| 打开/切换工程 | 释放旧工程的 `SessionReference`（先 unmount 旧 occurrence），再对目标工程当前会话 `retain`；等 `reference.ready` 失败则展示本地化错误并保留旧画面 |
| 新建创作会话 | `ctx.sessions.create({cwd?})` → 拿到 SessionId → 写入工程映射 → retain 并挂载 |
| 选历史会话 | 释放当前 reference，retain 目标 id；不调用任何宿主导航（`layout.selectPanel` 只用于切到视频面板） |
| 面板切换/离开 | unmount occurrence（dispose render），release reference；不删除会话 |
| 插件停用/HMR | `ctx.effect` 清理顺序：先 unmount/释放 render，再 release reference；Host 侧会话日志、运行中请求留在 Host，重连后 `retain` 重开 |
| 关闭会话（产品动作） | 无“关闭会话”原生 API；可停止运行（`cancel`）、归档（会阻断 step，见 §5.4）或仅从工程映射移除（不删宿主会话） |

**同一 Session 双编辑根**：源码只有“一个 shell per binding”和 README 限制；没有发现显式拒绝第二次 mount 的 guard。推断：两个 occurrence 会共享同一个 input shell/editor，行为不被支持；插件必须自己保证唯一挂载（例如面板按 projectId+sessionId 渲染一个 conversation，切换用 key 强制卸载）。

## 5. 工程↔创作会话（Q3）

### 5.1 事实：创建/列举/恢复/关闭

- 客户端 `ctx.sessions.create(opts?: {workspaceId?, cwd?, sessionId?, agentPreset?}): Promise<SessionId>`（`dsh-api-session-controller/lib/client.js:3972`；具体实现 `manager.create` :3321）：只调用 Host `session.create` 并把 summary 合并进列表，**没有**导航/selectPanel/openSession 调用；`sessionId` 可显式传入，正常做法用 Host mint 的 id。`SessionCreateError` 带请求 id。
- Host `sessionController.create`（`lib/index.js:755-787`）：`workspaceId` 或 `cwd` 二选一；`workspace` 会 `attachSession`；最后返回 `{sessionId, agentPreset?}`。**没有 project/title/自定义 metadata 字段**。
- 列举：客户端 `ctx.sessions.list`（`ObservableSnapshot<SessionListState>: ids/byId/projectionsBySession`）；`SessionSummary` 不含 title，标题来自 **projection key `title`**（`dsh-session-title/lib/index.js:172-182`）→ 取 `projectionsBySession[id].values.title`。`rename` 可写标题（Host remote `session.rename` / client `ISession.rename`）。
- 恢复/打开：`retain` 打开历史（共享 initial history opening）；没有“选择 Session”的副作用 API 被嵌入调用。
- 关闭：无 remove/delete；`cancel` 只停当前 turn；`archiveSession` 见 5.4。
- 草稿/滚动/运行中请求：由 ui-conversation/inputHub/Session store 在 Host/Client 各自持久化（README:77-79,97-99）；插件只负责挂载生命周期。**HMR、重连、停用时的行为未 live 验证。**

### 5.2 建议：映射由插件 Host 持久化

- 工程注册表（Video 自己的 project store）保存 `{projectId, sessionIds: [...], activeSessionId}`；会话元数据（title/cwd/updatedAt）可用宿主列表投影读取，不复制消息正文。
- 新建会话：`ctx.sessions.create({ cwd })`（cwd 用工程目录或固定占位；**不要**传 `workspaceId` 以自动挂到宿主 Workspace，见 5.3）→ 把 id 写进工程注册表 → 可选 `rename("<工程名> · 创作会话 N")`。
- 一会话一工程：映射写入时做双向校验；一个 sessionId 只能属于一个 projectId（Host 侧拒绝重复绑定）。
- 切工程不修改宿主当前会话：嵌入只 retain 自己的 SessionReference；不使用 `mainView` source、不调用 `uiWorkspace.openSession/startSession`。

### 5.3 事实/风险：工程会话在宿主 UI 的可见性

- 宿主侧栏/历史按 Workspace 账户成员渲染：`WorkspaceBaseline` 只有 `{items: WorkspaceView[], archivedSessionIds, pinnedSessionIds}`，每个 `WorkspaceView.sessionIds` 是“accounted to this Workspace”的会话（`dsh-api-workspace-controller/lib/typert.host.js:39-160,821`）。Host `session.create` 只有显式 `workspaceId` 才 `attachSession`（`lib/index.js:775-782`）。
- 推断：用 `create({cwd})` 创建、不传 workspaceId 的会话**不属于任何 Workspace**，因此大概率不出现在侧栏 Workspace 树/扁平历史行（这些行由 workspace 成员/顺序驱动，`dsh-client-ui-workspace/lib/client.js:1129-1154,908-935`）；但会话搜索会遍历完整 `list.ids`（`lib/client.js:1169-1185`），可能仍能搜到。**未 live 验证**（本轮不允许创建会话）。
- 没有找到“隐藏但在宿主侧栏外可寻址”的受支持 API；`archiveSession` 会让会话从可见列表消失，但归档网关会拒绝该会话（及其子代）的 `agent/pre-step`（`dsh-api-session-controller/lib/index.js:2491-2541`：archived session 的 step 被 `reject`），即**归档=不能继续聊天**。因此不能用归档来“隐藏长聊”。
- **建议产品决策**（交总调度）：允许这些工程会话出现在宿主历史（用标题前缀/固定工程命名区分），或为 Video 建独立 Workspace（会多一个宿主侧栏分组，且需要目录路径），或接受“仅由插件历史入口访问”但承认搜索可见。当前不做隐藏 hack。

### 5.4 未决：同一 Session 在宿主主视图被手工打开

- 若用户在宿主历史里点开同一工程会话，宿主 `mainView` retain + 插件 retain 会同时存在；ui-conversation 只按 binding 复用唯一 shell，README 声明双编辑根不受支持。**建议**：工程会话命名可识别 + 插件在检测到 `retainInfo(id).retainedBy.mainView > 0` 时给只读提示/要求先关闭宿主视图（具体交互待产品确认）；或按 5.3 的路线避免它出现在宿主历史。

## 6. 模型与推理强度（Q4）

**事实（随包源码 + README）**

- 模型 seat 由 **ui-model-selection 自己注册**到 `conversation.input.model`（`dsh-client-ui-model-selection/lib/client.js:1903`，children 含 `conversation.input.model.label` :1906）；ui-conversation 只声明该 slot 并渲染 `renderSlot("conversation.input.model", { locked: modelSeatLocked })`（`dsh-client-ui-conversation/lib/client.js:19908,19080`），`locked = removed || inert || !live`（:18822）。
- seat 的注入面：`{available, directory: directory.store, load(), select(selection)}`（:1911-1921）；组件 props `{locked, available, directory, load, select, t, renderSlot}`（:1152）。
- 目录来自**进程级共享** Host 目录 `ctx.remote.session.modelCatalog()`（:752），按会话惰性建目录；当前选择读 Session projection `modelSelection`（`binding.session.projections.faceOf("modelSelection")` :1034），`projected.next ?? catalog.value.default`（:946-979）。
- 提交 `directory.select` → `ctx.remote.session.selectModel({sessionId, provider, model, reasoningEffort?})`（:880-885）；Host `selectModel`（`dsh-api-session-controller/lib/index.js:793-812`）→ `requireModel`（不可用抛 `session/model-unavailable`，:967-972）→ `llm.resolveCallConfig` → `agents.selectForNextRequest`；默认模型保存是后台 best-effort，不阻塞返回。
- 生效规则：README:14 “A complete selection applies to the next request; a running step keeps the model and effort it started with”；Host 在下一 prompt-assembly 边界快照。
- 缺省/失败状态：无选择或目录缺项显示 “Select model” 并隐藏 effort；空目录 “No models available”；目录加载失败行 / 不可路由仍可发送并在执行时报告；`session/writer-held` 时提示退出其它 DSH 实例；subagent addressed 会话两个入口都不暴露。
- **模型切换不经过 approval/permission**：`selectModel` 路径只做可用性与 writer 校验；权限预设（`dsh-permission-presets`）把 sandbox + approval 打包，`conversation.input.permission` 是该预设选择器（`dsh-client-ui-permission-presets`）。
- `conversation.input.model.label` 是 session 级 single 扩展 slot，owner props 含 `provider{id,name}`、`model`、`placement: trigger|menu|option`、`selected`（README:48-54）——不给 URL/凭据。
- 官方 embedded 先例只替换 views、不接管 composer（`dsh-client-ui-subagent/lib/client.js:793-797`）→ 嵌入 occurrence 中 seat/目录/权限座位原样保留。

**建议**：嵌入后**不添加**模型写接口；直接复用，只有需要轻量视频标签时才用 `conversation.input.model.label`。插件不读取/持久化模型密钥，不缓存供应商配置；工程设置里的“当前模型”只作显示名读取。

**未测**：嵌入 occurrence 中模型菜单/搜索/effort 的行高与浮层边界、真实切换后下一次请求生效、无模型/未登录/目录失败文案在窄窗下的表现。

## 7. AI 工具与工程上下文（Q5）

**事实**

- Host `tools` 服务（live Inspect）：`register(definition)` 支持“全局或调用方 agent scope”；scoped tools 覆盖全局；`guard(guard)` 可全局或经 `agent.ctx` 仅对某 agent；`restrict` 只允许 scoped。`ToolExecutionInput` 含 `agent?: Agent`，`Agent = { readonly id: SessionId }`；`ToolDefinition.execute(args, exec: ToolRunContext)`；`ToolRunContext` 追加 `deferContext/concludeTurn`。实现侧 `execute` 里可用 `exec.agent.session.id`（`dsh-tools/lib/index.js:1531`）。
- per-agent 注册：`agent.ctx.tools.register(...)` 只影响该 agent，dispose 即撤销（`dsh-agent` README “Scope registrations to one agent”）；全局注册用普通 `ctx.tools.register`。
- 当前实现现状：仓库 `index.js:19` inject `['connection','tools','subprocess']`，`index.js:60` `ctx.tools.register(createVideoTool(bridge))` 为**全局**注册；`host/tool.js:154` `bridge.invoke(action, params, {source:'tool'})`，**没有任何 session/agent 校验**。
- systemPrompt：`section({name, order, text})` 静态段、`context({name, order, ...})` 动态运行时事实（以 sourced user-role 快照进入历史）；scoped 覆盖 global、同名 shadow；`refreshContext` 每请求刷新（`dsh-system-prompt/lib/index.js:253-281`，README “Use/Contribute”）。→ 工程 revision/Scene/stableId/素材摘要适合放 `context`，工具用法/规则放 `section`。
- 审批：`ctx.approval.request({agent, toolName, callId?, reason?, signal?})` 需要 open turn，`allowed-once` 是唯一授权（api-catalog:336-339）；`tools/pre-execute` 的 ask 也走它。ui-approval 通过 `conversation.composer` chain 接管（见 §3.4/§3.7），嵌入内可见。
- `agent.session.header` 可用（fileUploads 用 `agent.session.header.origin` 判 subagent）；`exec.agent` 可空（直接 Remote/HTTP 调用时无 agent）。
- 失败码建议：`E_SESSION_REQUIRED`、`E_SESSION_PROJECT_MISMATCH`、`E_PROJECT_NOT_BOUND`、`E_SESSION_CREATE`、`E_RENDERER_UNAVAILABLE`、`E_ASSET_*`（见 §8）、既有 `E_REVISION_CONFLICT`。

**建议（P3-006 实现点）**

1. 绑定工程会话时，Host 建立 `SessionId → projectId` 映射（工程注册表持久化），Tool `execute` 用 `exec.agent?.id` 查映射并交叉校验 `params.projectId`；无 agent 的写调用拒绝（只读/诊断可例外）。
2. 更严格版本：为每个工程会话在 `agent.ctx` 注册 per-session Tool，或全局 Tool + `agent.ctx.tools.guard` 拒绝跨工程；两者都需要“从 VideoBridge 拿当前 Agent”的路径（`ctx.agents.get(sessionId)`）——本任务只读到契约，未实测。
3. 工程上下文：会话创建/绑定时在 `agent.ctx.systemPrompt.context/provider` 注入 `{projectId, revision, selectedStableId, sceneIds, asset summaries}`；Host 在 inspect/edit 后触发 `refreshContext`。不把全文素材/路径塞进 prompt。
4. 写操作审批：破坏性 action 前 `ctx.approval.request(...)`（需 open turn），依赖宿主的 ask/never 策略；嵌入内 UI 已具备（§3.7），但 VideoBridge 与审批的接线未实现。
5. 注意：审批接管期间 composer fallback（含 Stop/Send）被 `display:none` 隐藏（renderer overlay，见 §3.7）——产品需决定嵌入处是否要独立 Stop。

**未测**：Tool 与嵌入会话的 scope 绑定在真实 HMR/停用/Host 重启下的行为；`exec.agent` 在 VideoBridge 实际调用路径中的可用性；审批与 Tool 的端到端流程。

## 8. 素材与附件（Q6）

### 8.1 事实：原生附件链路

- 媒体类型：`ImageMediaType = 'image/png'|'image/jpeg'|'image/webp'|'image/gif'`；`ImageAttachmentRef {attachmentId, mediaType, bytes, width, height, name?, originalDimensions?}`；`FileAttachmentRef {attachmentId, name, bytes}`；`PromptContentPart = text | image{mediaType,data(base64),name?} | file{receiptId}`。
- 浏览器入口：composer 私有隐藏 `<input type=file multiple>`（ui-conversation:19060-19067）与 `installDraftFilePicker` 的 File 命令（:18334-18338，注册 :19696-19698）；**插件不能复用**。
- `addFiles`（ui-conversation:19945-19985）：图片或没有真实路径的文件 → `uploads` → `conversation.createDrafts`；Desktop 下带 `__DSH_HOST_PATHS__` 真实路径的非图片/文件夹 → `@path` reference chip。图片发送走 `encodeImage`（只接受四种 mediaType，base64 data，:4990-5007）；文件发送走 `ctx.fileUpload.upload(sessionId, body, name, signal, onProgress)`（`dsh-client-file-upload/README.md`）。
- Desktop bridge：`app.asar/lib/preload-app.cjs:862` 仅暴露 `__DSH_HOST_PATHS__.pathFor(file)`（`electron.webUtils.getPathForFile`），**没有文件对话框 IPC**；`showOpenDialog` 只有目录模式（`app.asar/lib/main.js:7039`）。
- Host 收据：`ctx.fileUploads` 的 receipt 表以 **Agent 的精确 Session 对象**为 key；`upload(agent, request, signal)` / `uploadStream({sessionId,data,name?})` → `FileUploadValue {receiptId, file}`；`resolve(agent, receiptId)`；`bindPrompt(agent, ids, requestId)` 事务绑定，queue/history 观察或 session dispose 后退休。普通 Session 才允许（subagent 拒绝 `subagent/attachment-invalid`）。
- 持久化：`ctx.attachments.admitPromptContent(parts)` 只把 image 换成 durable ref（text/file 原样），图片在摄入时校验+归一化；receipt 由 `fileUploads` 在 prompt 投递时消费。
- 存储/读取 API（Host `attachments`，由 `dsh-attachment-local` 实现）：`saveImages/saveImage/validateImage`、`readImage → {ref,data}`（校验字节）、`readFileStream(ref,signal)` 有界分块并校验 digest/长度、`saveFile/saveFileStream`、`fileHostPath(ref)` 返回只读硬链接绝对路径或 undefined、`readImageRequest`。
- **附件服务本身不做会话授权**：Host `attachments.readImage/readFileStream/fileHostPath` 不校验归属；唯一会话授权在 `sessionController.attachment({sessionId, attachmentId})`——它扫描该 Session 事件证明引用（`dsh-api-session-controller/lib/index.js:978-993,1186-1191`），失败 `session/attachment-invalid` → `ATTACHMENT_NOT_REFERENCED`。→ VideoBridge 若接收任意 ref 必须自己证明归属。
- 限制（`dsh-attachment-local/lib/index.js:998-1010`）：`imageLimits = {maxImageBytes: 20 MiB, maxImagesPerMessage: 20, maxMessageImageBytes: 200 MiB, maxImagePixels: 64e6, maxImageDimension: 8192, mediaTypes: [png,jpeg,webp,gif]}`；归一化至 2048²/4 MiB。其它文件 verbatim、无 type/size 上限；**音频/视频没有专门处理**（`dsh-attachment/README.md:32,40,52,71,118`）。
- 会话侧读取：Host `sessionController.attachment` 返回 `{attachment: ImageAttachmentRef, data: base64}`（只对图片）；client `ISession.readAttachment(attachmentId)` 返回 image ref+bytes。
- 客户端图片 URL：`ctx.uiConversation.imageUrl(sessionId, attachment)`（README:14）→ `HistoricalImageCache.resolve`（conversation `lib/client.js:4107-4109`，缓存按 binding、key=attachmentId，:3499-3513；`binding.session.readAttachment` 生成 blob URL，binding 释放即 revoke :3558-3602）。只服务 **session 日志引用的 durable image**。
- PendingInteraction kind：`approval | plan-review | question`（`dsh-client-ui-workspace/lib/client.js:1048-1054`）。

### 8.2 建议：AI 附件→工程 assetId（P3-006 实现点）

1. 工程资产库由 Video Host 拥有：`{assetId, sha256, mediaType, width/height, bytes, originalName, provenance}`，文件落在工程自己的 asset 目录；同内容去重；不把临时 URL/任意本机 path 交 worker。
2. **原生附件→工程副本**（图片）：插件 Host 新增受控方法 `importAsset({sessionId, attachmentId, name?})`：先用 `sessionController.attachment(sessionId, attachmentId)` 证明该图片可达于该 Session log（或走 receipt 路径，见 3），再用 `attachments.readImage` 读授权字节 → 校验 magic/尺寸/媒体类型/上限 → 写工程资产副本 → 返回 assetId。**不使用** `imageUrl` 作为资产来源。
3. **发送前/草稿附件→工程**：受支持的字节入口是 `ctx.fileUpload.upload(sessionId, file)` 的 receipt；插件 Host 可在 receipt 尚 staged 时 `fileUploads.resolve(agent, receiptId)`。本轮源码**没有找到**插件从 native composer 草稿读取 receiptId 的受支持通路；如果允许用户在我们的素材入口选择文件，更简单的是让插件自己的 UI 先走 Host 导入（§8.2-4），再决定是否作为 AI 附件发送。
4. **画布素材导入（首批 PNG/JPEG）**：插件自己的 `<input type=file>`/drop → 插件 Host 的受控路由（现有 VideoBridge 模式）→ 校验类型/大小/哈希 → 写工程资产 → 素材抽屉；`SVG` 不在图片模型内（`UnsupportedImageMediaTypeError`）应明确拒绝并给文案；视频/音频维持缺口，不开放入口。
5. **三种语义分开**：素材拖到画布=插入工程（usage=used，产生视频引用）；拖到输入框=AI 引用（usage=referenced，不自动入片）；发送是否把附件交给模型由原生 Composer 决定。三者不共用第二套附件库。
6. **缩略图**：工程 asset 缩略图不能走 `uiConversation.imageUrl`（只接受 session-referenced image），需插件自有 Host GET 路由（连接鉴权 + project 校验），PNG 首验收；视频缩略图/波形是后续缺口。

**未测**：`fileUploads.resolve` 在“不立刻 prompt”的场景下是否一直可解析（现有 retire 只在 prompt 交付、队列观察或 session dispose）；`ctx.attachments.readImage` 只存在于挂载 `dsh-attachment-local` 的 Host 组合；`uiConversation` 服务对 bundle 插件是否可达（`super(ctx,"uiConversation")` 存在，但 live Inspect Service 目录未列出它）。

## 9. 落地拆分与文件白名单（Q7）

**建议阶段**（均需另行下发实现任务；本轮不做）

1. **P3-005 契约冻结（本任务）**：A 会话/模型/素材契约 + B 画布直接编辑；总调度合并后冻结 Session/消息/坐标生命周期。
2. **P3-006（Host/UI 接线）**：`client.js` 增加 session 映射/历史入口/嵌入 conversation；`host/**` 增加 session→project 映射、Tool scope 校验、会话创建/标题、AI 附件→资产导入（PNG/JPEG）；`package.json` 若引用外部模块再声明 `dsh.client.external`（当前骨架不需要）；scripts/check 与 smoke 增加契约回归。引擎仍固定当前已审版本，切换 df4b74f/0.2.1 另行更新 staging 与 Host 固定。
3. **P3-007（真实闭环）**：安装授权后验证“一句话→多场景→人工改→AI 续改→重开→导出”，模型 seat/审批/附件/历史恢复/HMR/停用/回滚。

**最小可验证闭环（P3-006 内）**：打开工程 → create/retain 创作会话 → 嵌入 conversation（无宿主 Header）→ 发送一条真实消息（不调模型即可用假 worker/固定响应做契约测试）→ VideoBridge 工具以该 session 的工程 scope 执行 → 切工程/切历史 → 卸载无泄漏（retainInfo 归零、无重复 shell、INTEGRITY 不变）。UI 契约测试不得冒充真机。

**文件白名单建议**：`client.js`、`host/**`（bridge/routes/tool/config/env/errors/limits 视需要）、`package.json`（仅 manifest/external 与版本，不加依赖）、`scripts/check.mjs`、`scripts/smoke-client.mjs`、`scripts/check-host.mjs`、`README.md`、任务/研究文档；**不改** engine 包、spikes 生产路径之外的无关文件、全局记忆、安装目录。

**P3-006 新增 Host 方法清单草案（只提案，未实现；均为受控 bridge 方法，非任意 URL/path）**

| 方法 | 输入/输出 | 用途与失败码 |
|---|---|---|
| `session.bindProject` / `session.project` | `{sessionId, projectId}` → `{bound}` / 查询 → `{projectId}` | 建立/读取 Host 侧映射；冲突 `E_SESSION_PROJECT_MISMATCH`，未知 `E_PROJECT_NOT_BOUND` |
| `session.createForProject` | `{projectId, title?}` → `{sessionId}` | 包装 `ctx.sessions.create`/Host controller 并写映射；失败 `E_SESSION_CREATE` |
| `asset.import` | `{projectId, sessionId?, receiptId? 或 attachmentId?, name?}` → `{assetId, mediaType, bytes, sha256}` | 走 receipt 或 session-referenced 附件授权读取后复制进工程；`E_ASSET_RECEIPT_UNKNOWN`/`E_ATTACHMENT_NOT_REFERENCED`/`E_ASSET_TYPE_UNSUPPORTED`/`E_ASSET_TOO_LARGE` |
| `asset.list/read/delete` | 按 projectId/assetId；删除在用资产要给影响提示 | 素材抽屉与缩略图数据 |
| `asset.route`（GET） | `/api/dsh-video/asset?assetId=…` | 工程缩略图/原图字节，连接鉴权 + project 校验；**不用** `uiConversation.imageUrl` |
| `agent.context`（内部） | 绑定后在 `agent.ctx.systemPrompt.context` 注入工程摘要 | 每请求刷新；解绑 dispose |

工具侧：`video_engine` 写 action 要求 `exec.agent` 存在且 `agent.id` 已绑定当前工程，写前按宿主策略 `ctx.approval.request`；无 agent/未绑定/跨工程分别失败。

**所需用户授权**：安装/启用/重启 DSH、以及真实模型调用（P3-007）；本轮均未请求。

## 10. 未测与未决问题

- 未 live 验证：`main` occupant 的 kit 是否确实含 `SessionProvider`/`renderSlot`（源码规则支持，但未在真实 Host 注册验证）；嵌入 occurrence 的 phase/hero 是否可固定；SessionProvider 显式绑定后的 composer/审批/模型 seat 的真实渲染。
- 未验证：`ctx.sessions.create({cwd})` 创建的会话在宿主侧栏/搜索中的实际可见性；自定义 source 名在运行期的统计/诊断行为；归档会话 retain/读取的实际可用性（gate 只拦 step）。
- 未实现/未验证：Video Tool 的 session 绑定与审批接线；AI 附件→工程资产的 receipt 通路（`fileUploads.resolve` 在不立刻 prompt 时是否持续可解析）；`attachments.readImage` 依赖 `dsh-attachment-local` 组合；`uiConversation` 服务对 bundle 插件是否可达；会话历史 UI 与标题投影的键路径（projection `title` 已在源码确认，客户端取值需实现轮验证）。
- 事实修正记录：`AttachmentStore` 的 abstract 方法不产生运行时 JS；“可读”契约由 api-catalog 声明、由 `dsh-attachment-local` 实现，VideoBridge 只能依赖挂载了该实现的 Host 组合。
- 产品未决：工程会话要不要出现在宿主历史；是否为其建独立 Workspace；宿主主视图与嵌入同一 Session 的冲突提示策略；审批接管期间 composer/Stop 被隐藏时嵌入处是否需要独立 Stop。
- 本轮没有安装、启停/重启、改 profile、创建/编辑会话、发消息、调模型；也未验证 HMR/停用/重连与浅色/深色/窄窗。

## 11. 证据索引（关键）

| 主题 | 位置 |
|---|---|
| 版本/身份 | `Info.plist`；`app.asar/dsh/package.json`；本会话 `DSH_*` 环境 |
| ui-conversation Factory/主 shell | `dsh-client-ui-conversation/lib/client.js:17536-17555,17741-17878,19733-19900,20022-20045` |
| renderer kit/SessionProvider | `dsh-client-ui-renderer/lib/client.js:705-723,736-767,946-977` |
| SessionProvider 绑定校验 | `dsh-client-ui-session/lib/client.js:802-843` |
| 嵌入样例 | `dsh-client-ui-subagent/lib/client.js:780-810`；`dsh-client-ui-sidebar-right/lib/client.js:1583-1600` |
| Session 客户端服务/创建 | `dsh-api-session-controller/lib/client.js:3321-3400,3842-3977`；Host `lib/index.js:264-267,755-787,3061-3116,2491-2541` |
| 会话标题投影 | `dsh-session-title/lib/index.js:172-182` |
| Workspace 成员/归档 | `dsh-api-workspace-controller/lib/typert.host.js:39-160,821`；`dsh-client-ui-workspace/lib/client.js:908-935,1129-1154,1653` |
| 模型 | `dsh-client-ui-model-selection/README.md`（Summary/Use/Model and effort）；Host `sessionController.modelCatalog/selectModel`（live Inspect） |
| 附件 | `dsh-attachment/README.md:32,40,52,71,118`；`dsh-client-file-upload/README.md`；live Inspect `attachments`/`fileUploads`/`sessionController.attachment` |
| 审批 | `dsh-client-ui-approval/README.md`；`dsh-client-ui-approval/lib/client.js:343-347` |
| 工具/上下文 | `dsh-tools`（live Inspect `ToolExecutionInput/ToolDefinition`）；`dsh-system-prompt/README.md` |
| manifest external | `dsh-client-modules/README.md:34,50`；`dsh-client-modules/lib/client.js:67,783-788,833-840` |
| 官方 skill | `dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/references/ui-plugin.md` |
