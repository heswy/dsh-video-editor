# P0-001 运行中宿主契约调查（Desktop 0.2.0-rc.2）

调查日期：2026-10-17。
调查者：DSH 开发 Agent（用户指定）。
分支：`dsh/p0-mode-shell`（base `4d5572edf26dca619c861eae4fdfa0d7e4f2a9a7`）。
性质：**只读调查**。本轮未安装/启用插件，未改 profile，未写功能代码，未 push。本文区分「运行时事实」「随应用包证据」「建议」；建议不是已实现能力。

## 1. 环境与版本证据

| 项 | 值 |
|---|---|
| 宿主 | DeepSeek Harness Desktop `0.2.0-rc.2`（`Info.plist` `CFBundleShortVersionString` = `0.2.0-rc.2`） |
| 随应用 DSH 包 | `@deepseek-ai/dsh` `0.2.0-rc.2`（从 `app.asar` 内读取 `dsh/package.json`） |
| `app.asar` | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，sha256 `18d5036bbb58eaff41d351ede99314b8d06505aec06fb2e164c49874ada30f9e` |
| Profile | `DSH_PROFILE=desktop`，`DSH_PROFILE_DIR=~/.dsh/profiles/desktop`（只读环境变量，未读写 profile 文件） |
| Web GUI | `http://127.0.0.1:19387`（桌面窗口正在使用的页面） |
| Shell Node | v24.14.0 |
| 官方 Skill 包 | `docs/reference/dsh-plugin-dev-kit-20261017` 的 16 个 skill 文件与运行中 `app.asar` 内 `dsh-agent-preset/skills/` **逐字节相同**（本次逐文件 `cmp`：SAME=16 DIFF=0） |

技能文档版本与本机宿主匹配；本轮按任务要求读取了 `cordis-plugin-development/SKILL.md`、`references/practices.md`、`ui-plugin.md`、`user-actions.md`、`host-plugin.md`。整理材料 `AGENT-BRIEF.md` 只作为线索，不作为约束。

**证据分级**：运行时 `cordis_inspect_*` 结果（最权威）→ 随应用 `0.2.0-rc.2` 包的包 README/`lib/client.js`（用于回答 inspection 不覆盖的挂载/卸载语义，只读解包到 `/tmp`，未改动安装）→ 官方 skill 原文 → 本机参考插件 `dsh-git-graph`/`dsh-token-stats`（只读）。本文没有 live 插件运行证据：P0-A 不安装，因此凡涉及「注册后页面表现」的条目都标为**未验证**。

## 2. 已执行的 inspection 查询（脱敏）

共执行 22 次定向查询；未枚举会话、消息或私有内容，结果中不记录本机安装的第三方插件身份。

| 平台 | Provider | 查询 | 主要用途 / 结论 |
|---|---|---|---|
| client | `Slots.listSubTree` | 无 root（全量 Slot/Factory 拓扑） | 得到完整 Slot 树、kind、scope、registration 字段 |
| client | `Slots.listSubTree` | root = `main` | keyed、按 activePanelId 分派、已占 key |
| client | `Slots.listSubTree` | root = `conversation.header.leading` | 顶部候选座位：single、root scope、**无占用** |
| client | `Slots.listSubTree` | root = `conversation.header` | 常驻 header 结构、scope=session-maybe |
| client | `Slots.listSubTree` | root = `conversation.session.header` | View 导航所在；session scope |
| client | `Slots.listSubTree` | root = `conversation.view` | 会话视图列表，同一时刻渲染一个 |
| client | `Slots.listSubTree` | root = `sidebar.panellist` | 全局面板入口；id 寻址 main key |
| client | `Slots.listSubTree` | root = `shell.leading` | 已被占用且仅在 macOS 侧栏全隐藏时挂载 |
| client | `Slots.listSubTree` | root = `shell.overlay` | frame 级浮层，click-through、无分配空间 |
| client | `Slots.listSubTree` | root = `conversation.session.header.corner` | single、session scope、已被占用 |
| client | `Service.listService` | 目录 | 8 个 Client Service：layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces |
| client | `Service.listService` | `layout` | `selectPanel` 精确签名与错误语义；`MainPanelId` |
| client | `Service.listService` | `sessions` | retain/binding 面；与状态保持相关 |
| client | `Event.listEvents` | 目录 | 仅 connection/reset、locale/change、slots/changed、theme/change |
| client | `Theme.listTokens` | — | 14 个 `--dsw-alias-*` / `--dsw-specific-*` token，均要求 light+dark |
| client | `Builtin.listBuiltins` | — | 动态 Client 半（`cordis_run` 类包）可用符号；**不等于安装型 bundle 的 client loader 契约**，见 §6.5 |
| host | `Service.listService` | 目录 | 全量 Host 服务目录（与 UI→Host 入口、Tool、存储相关部分见 §6） |
| host | `Service.listService` | `connection` | `connection.fetch` 精确路由契约 |
| host | `Service.listService` | `tools` | `tools.register` / `ToolDefinition` 精确契约 |
| host | `Event.listEvents` | 目录 | 与插件相关的 emit/waterfall 生命周期事件 |
| host | `Tool.listTools` | — | 本 Agent 可见工具清单（用于理解 Tool 注册的可见性，不含业务数据） |
| host | `Config.listConfigs` | limit=3 | 仅抽查目录分页形状（id/patchId/name/status/total），未展开具体插件配置 |

说明：全量 Slot 树与 Host Service 目录中会出现本机 profile 安装的插件信息。本文只保留与本任务相关的内置结构（`mf` 外壳、conversation、sidebar、layout 等），其余第三方插件名称一律省略。`app.asar` 内的源码/README 只读解包到 `/tmp/p0-asar/` 供诊断，未改动安装目录或 profile。

## 3. 已确认的 Slot 与主视图契约

### 3.1 frame root 与三类位置

随应用 `ui-layout`（registrant `mf`）在 `root` single slot 中声明了唯一的子结构（源码与 inspection 一致）：

```
root (single, root)
├─ sidebar                   (single, root)
├─ main                      (keyed,  root)   ← 中央面板，按 key 分派
├─ rightbar                  (single, root)
├─ shell.overlay             (list,   root)   ← frame 级浮层（click-through）
└─ shell.leading             (single, root)   ← 窗口 chrome 左上座
```

`main` 的渲染方式是 `renderSlot("main", {}, { entryKey: usePanelInfo(info => info.activePanelId) ?? "conversation" })`。**只有当前 key 的条目会被渲染**；因此切到其它 `main` key 时 Conversation 子树会卸载（随应用包源码事实，未 live 复测，见 §5）。

`shell.overlay` 层 CSS：`position:absolute; inset:0; z-index:20; pointer-events:none`，其直接子元素 `pointer-events:auto`。即它覆盖整个 frame、本身点击穿透，条目自行定位。

### 3.2 顶部候选位置（逐项结论）

| Slot | kind / scope | 无 Session 时 | 当前占用 | 对「主内容顶部切换」的结论 |
|---|---|---|---|---|
| `conversation.header.leading` | single / root | **可用**（常驻 header 的 leading 座位） | **空** | **唯一可加挂的顶部主内容座位**；位于会话头行、标题之前（左对齐），不是水平居中 |
| `conversation.header` | single / session-maybe | 渲染（blank 时保留 leading + corner） | 已占（`mf`） | 宿主常驻会话头；替换属 `shadows-shipped-ui`，不建议 |
| `conversation.session.header` | single / session | 不渲染（strict session） | 已占（`mf`） | 标题/操作/View 导航；替换风险高 |
| `conversation.session.header.utilities` | list / session | 不渲染 | 有占用 | 右对齐工具区，不适合 |
| `conversation.session.header.corner` | single / session | blank session 保留 | 已占（`mf`） | single 且已占，需降优先级替换；不适合 |
| `shell.leading` | single / root | 条件挂载 | 已占（`mf`，ui-sidebar 的 reopen/New Session 控件） | **不可用**：catalog 明确「仅当 sidebar 整列完全隐藏（macOS 桌面折叠）时挂载」且已占用 |
| `shell.overlay` | list / root | 可用 | 多个内置条目 | 可常驻，但**没有为主列分配空间/几何**；见 §4.4 |
| `sidebar.panellist` | list / root | 可用 | 内置 plugins / schedules 等 | 标准「全局面板入口」，但产品禁止把顶部切换降级成侧栏专属入口 |
| `conversation.view` | list / session | **不渲染**（blank session 不渲染该 slot） | 内置 chat / trajectory 及本机第三方注册的 view | 是会话内 View 导航，不是全局模式；无 Session/blank 时不可用；切换入口受限于宿主 View 标签 |

`conversation.header.leading` 的精确 catalog（inspection）：

- purpose：`Global navigation before the Session title, available without a Session.`
- `registration: []`（single，无 key/id/select 必填项）
- `ownerProps`：`{ children?: never }`（不传 owner 私有值）
- `standardProps`：`useResource`、`useWorkspaces`、`usePanelInfo`、`useSessions`、`useSessionStatus`、`useSessionRetainInfo`
- 所在结构：`<header data-window-drag>`（macOS 拖拽行）内 `div.headerLeading`（darwin 下 `-webkit-app-region:no-drag`）→ `renderSlot("conversation.header.leading")`
- blank session 会隐藏标题/actions/utilities/View tabs，但 leading 与 corner 保留（package README 与源码一致）

`conversation.header` 的宿主 CSS（随应用包内 `ConversationRoot.module.css` 编译产物）：`display:grid; grid-template-columns:auto minmax(0,1fr); padding:10px 28px 0 20px`；blank 时 `min-height:0; padding-bottom:0`；`titleRow` 的 `min-height:30px` 在 macOS 的 sessionless header 上保留，非 darwin 折叠。**精确像素几何需在 P0-B 真实页面测量**，本文不把编译 CSS 推算当作已验证尺寸。

### 3.3 主视图导航 / 注册方式（运行时事实）

Client `layout` 服务（`ctx.layout`，由 `ui-layout` 提供）精确签名：

```
selectPanel(panelId: MainPanelId | null): void
  - Select a global central panel without changing the current Session.
  - panelId: registered main key, or null to show the Conversation
  - throws: if the selected main key is not registered; preserves the current selection
beginNavigation(): AbortSignal
toggleSidebar(): void
openRightbar(track: boolean, fullscreen: boolean): void
closeRightbar(): void
```

`MainPanelId = Branded<'MainPanelId'>`（运行时仍是字符串；源码 `selectPanel` 先查 live `main` 注册表再写入 store）。

`main` catalog 补充：`The reserved "conversation" key hosts the Conversation; other keys receive no Session binding.` 当前 live key：`conversation`、`plugins`、`schedules`，另有一个本机第三方上下文面板（名称省略）。

主面板注册方式（本机参考插件已跑通的形式）：

```js
// client.js factory 内
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: 'dsh-video',          // 新 key，不能复用 conversation
  locale: NS,
  inject: () => ({ /* 业务 share，进入组件 props */ }),
}, VideoWorkspacePanel));

ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: 'dsh-video',
  order: 30,
  label: () => t('panel'),
  locale: NS,
}, VideoIcon));
```

- `sidebar.panellist` 的 `id` 寻址同 id 的 `main` key；选中不存在的主面板会抛错。
- **不注册 `sidebar.panellist` 也能**让 `main` 面板通过 `ctx.layout.selectPanel('dsh-video')` 显示（服务只校验 `main` 注册表）；侧栏图标只是入口。
- `conversation.header.leading` 的注册（single，无 key）：

```js
ctx.slots.inject('conversation.header.leading', () =>
  ctx.slots.register({ name: 'conversation.header.leading', locale: NS }, ModeSwitch));
```

### 3.4 Slot 注册与生命周期机制（随应用包 `dsh-client-ui-slots`/`ui-renderer` 源码）

- `ctx.slots.register(options, Component)`：`options.name` 定位已声明 slot；**single** 每 priority 一个占位者（同 priority 冲突抛错，低 priority 渲染、可影子替换）；**keyed** 必须有 `key`；**list** 必须有 `id`；**chain** 必须有 `select`。通用 options：`priority/order/label/inject/children/store/locale/registrant`。
- `ctx.slots.inject(key, callback)`：按声明生命周期运行——已声明则同步执行，未声明则等声明提交后执行；声明折叠时 dispose；再次声明重新执行；控制器属于调用方 fiber，插件卸载会取消等待并移除贡献。这是向宿主 Slot 注册的推荐方式。
- 条目 disposer 递归移除其声明的子 slot；store 席位与 scope 绑定（同一 handle 不能跨 scope）。
- `usePanelInfo(info => info.activePanelId)` 是选中态来源；面板内与侧栏图标都能读。`panelInfo` 只含 `activePanelId`；frame 的列宽/几何 `layoutInfo` 不通过该 hook 暴露。

## 4. 顶部「普通｜视频」切换可行性

### 4.1 目标与事实差距

用户截图（`docs/product/references/mode-switch-request.png`）把两段切换画在主内容区域顶部、水平接近主列中心，位于窗口顶部空白带。运行中宿主**没有一个「主列顶部居中、可加挂」的 Slot**：

1. 顶部主列唯一空闲座位是 `conversation.header.leading`：在会话头行内、Session 标题之前，**靠左**（header 为 `grid-template-columns:auto minmax(0,1fr)`，leading 是第一列 auto 宽）。
2. `shell.leading` 被 ui-sidebar 占用，且仅在 macOS 侧栏整列隐藏时挂载，不能承载常驻模式开关。
3. `shell.overlay` 是唯一跨 `main` 面板常驻的 root 座位；但它是覆盖整个 frame 的绝对定位层，宿主**不向占用者暴露主列几何**（`usePanelInfo` 只有 activePanelId；无 sidebar 宽度 CSS 变量，Windows 专用的 `--dsh-windows-sidebar-width` 除外）；把开关对齐到「主列中心」只能硬编码/测量 DOM，违反「不猜 CSS 定位」的项目约束。
4. `conversation.view` 是 session-scoped 且 blank session 不渲染，不能作为全局模式入口；且没有受支持的「从 header 座位切换 View」API（`openView` 只作为 `conversation.view` 占用者的 owner props 提供）。

**结论**：顶部「左/右两段」控件能原生、低风险地落在**主内容顶部带（会话头行）靠左位置**；**水平居中在 0.2.0-rc.2 没有专属 Slot**，需要主会话/用户选择替代（见 §4.3–4.5）。

### 4.2 方案 A（建议作为 P0-B 基线）：global main panel + 两处同组件挂载

- 注册新 `main` key（建议 `dsh-video`，避开已占的 `conversation`/`plugins`/`schedules`/第三方 key）。
- 切换：正常 → `ctx.layout.selectPanel('dsh-video')`；视频 → `ctx.layout.selectPanel(null)`（显示 Conversation）。不改变当前 Session（服务文档明示）。
- 开关组件挂两处：
  1. `conversation.header.leading`：普通模式顶部带、标题之前（水平靠左）；blank session 也可用（截图状态可切换）；
  2. 视频工作区页面自己的顶栏：完全由插件控制布局，可把同一开关放到页面顶部的同一水平位置；页面作为入口型主面板，可按 `--dsh-frame-top-clearance`（macOS 48px）避让窗口 chrome，具体版式 P0-B 实测定。
- 两处渲染的是同一组件与同一状态源；`usePanelInfo` 可判断当前 active key，避免状态分叉。
- 不建议首版注册 `sidebar.panellist`（产品不允许把顶部入口降级为侧栏入口）；如日后要补充侧栏入口，属 additive，不替代顶部开关。
- 与截图差异：普通模式下开关在左侧而**不是居中**。这是当前契约下唯一「不替换宿主 UI、不猜定位」的落点。若产品必须居中，需要在 §4.4 / §4.5 之间做决定。

### 4.3 方案 B（居中替代 1）：`shell.overlay` 常驻浮层

- 单一挂载点，跨普通/视频/其它全局面板常驻；点击穿透层内自行 opt-in 指针事件。
- 可水平**相对 frame** 居中；由于 sidebar 展开时主列不在 frame 中心（默认 280px 侧栏），相对主列的精确居中无法从受支持的 hook/CSS 变量取得。可选做法：
  - 接受相对 frame 居中（与截图偏左约 sidebar/2）；
  - 插件硬编码一个偏移（脆弱，侧栏折叠/拖动后会错位，不建议）；
  - 读取宿主 DOM 测量（违反「不要读别的插件/宿主 DOM 来估算位置」的规范，不建议）。
- 与 toast/限额提示等内置 overlay 条目共享 z-index 20 层，需处理重叠；顶部还与 macOS 窗口拖拽带相邻。
- **判定**：技术上可挂，但位置正确性无法用原生契约保证；需要产品接受「frame 居中」或另做决定。P0-B 若采用必须先做真页面验证。

### 4.4 方案 C（居中替代 2）：影子替换 `conversation.header`

- Slot 机制支持以更低 `priority` 影子替换 single 占用者（低 priority 渲染）。替换后需自行 `renderSlot("conversation.header.leading")`、`renderSlot("conversation.session.header", { hideChrome })`，并复刻 drag 行、blank/sessionless 状态、corner 控件与 40px 顶部条。
- 属 catalog 标注的 `shadows-shipped-ui`，维护与回归风险高；任何宿主升级都可能破坏现有会话头的标题/操作/View 导航。
- **判定**：不推荐进入 P0-B 最小版本；只有产品明确「必须居中且接受替换宿主 UI 风险」时才考虑。

### 4.5 窗口拖拽区域与顶部避让（已核实机制，未 live 验证）

- macOS：`html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}`；`[data-window-drag-recall]{-webkit-app-region:no-drag}`（web shell base CSS）。会话头行本身带 `data-window-drag`，而 `.headerLeading/.headerActions/.headerUtilities/.headerCorner` 在 darwin 下是 `no-drag`，所以放进 `conversation.header.leading` 的控件可点击。
- 自有视频页面若要在顶部画拖拽行，可对行设置 `data-window-drag`，并对交互控件设置 `-webkit-app-region:no-drag`（或 `data-window-drag-recall`）；web shell 另有 drag-recall 机制在动画/布局变化时短时给 `body` 打 recall 标记。此路径 P0-B 必须真机验证。
- 宿主发布 `--dsh-frame-top-clearance`（macOS 48px）、`--dsh-frame-overlay-top`（+20px）、`--dsh-frame-leading-clearance` 等变量；入口型主面板（插件管理器等）按 top-clearance 避让。

## 5. 普通会话挂载与状态保持

### 5.1 事实：切到视频主面板时 Conversation 会卸载

`main` 是 keyed，frame 只 `renderSlot` 当前 activePanelId 对应的条目（随应用包源码 + inspection 一致）。切到 `dsh-video` 后 conversation 子树卸载；frame 三列的容器本身保持挂载（ui-layout README）。这是方案 A 的主要代价；以下状态由宿主自身兜底：

| 状态 | 是否保留 | 证据（0.2.0-rc.2 随应用包 / inspection） | 备注 |
|---|---|---|---|
| 当前 Session 选择 | 保留 | `layout.selectPanel` 文档：不改变当前 Session；选择只决定中央面板 key | 本轮未 live 复测 |
| 输入草稿 | 保留 | `ui-conversation` 的每 Session Conversation store：`defineStore({ init: { draft, view, viewRequest }, persist: "dsh.conversation" })`，浏览器 `localStorage` 键形如 `dsh.conversation.<sessionId>`；挂载时 adopt-on-bind（store 中的持久草稿回填 editor） | 跨卸载与页面刷新保留；live 未测 |
| 聊天滚动/阅读位置 | 保留（语义锚点） | `ui-chat` 在插件 apply 作用域内的 `Map<sessionId, position>` 保存阅读位置（随插件启用常驻，不随面板卸载），Chat 挂载时 `restore()`；README 明示「历史前插与 renderer 重新挂载时恢复语义锚点」 | 仅同一次页面进程内；刷新页面丢失 |
| View 偏好 | 保留 | 同一 Conversation store 的 `view` 字段持久化，壳层渲染前读取偏好 | |
| DOM 文本选择 / 光标 / 输入法状态 | **不保留**（预期） | 卸载即销毁 DOM；宿主无跨卸载恢复 API | 结构性推断，未 live 测 |
| Chat 过程展开态等视图态 | 不保留 | `ui-chat` 的 Chat store 无 `persist`，按 Session scope 物化 | 影响小 |
| 媒体/会话事件流 | 保留在 Host | 会话日志由 Host 唯一负责，重挂载重新订阅 | |

**结论**：产品要求的「普通模式状态继续保留」在输入与阅读位置层面有宿主机制保障；但**文本选区/光标/焦点这类 DOM 瞬时态会丢**。P0-B 验收要按此口径写：验证草稿文字、会话、滚动位置不丢；不承诺像素级选区保持。

### 5.2 视频模式状态

- 视频工作区是 `main` 的全局 key 条目，**没有 Session binding**（`main` catalog 明示非 conversation key 不接收 Session 绑定）。因此视频模式状态不能挂在 session 生命周期上。
- 切回普通模式会卸载视频面板组件 → **React 局部 state 丢失**。视频模式状态必须放在组件外：
  - 首版建议：插件 Client 模块内自带 store（模块在插件启用期间常驻，跨面板卸载/模式切换保留；页面刷新或插件重载丢失）；
  - 可选浏览器持久化：`@deepseek-ai/dsh-client-store` 是静态模块表 seed 之一，可 `require`；其 `defineStore` 支持可选 `localStorage` 持久化（仅浏览器本地，不跨设备）；
  - 工程内容（工程/Scene/素材）的权威持久化属于后续任务，按 DEVELOPMENT「Host 统一负责内容持久化」设计；本机 Host 有 `storageDomain`（schema 校验 KV 域、写入持久、`domain/changed`）与 `storage` 等能力，但**第三方 bundle 直接使用 `defineDomain` 的路径未验证**，不在 P0-A 结论内。
- 模式切换只改视图：不产生 Session 事件、不改模型/权限/Agent preset、不写工程内容。

## 6. UI→Host、Tool 与清理契约

### 6.1 bundle 与 Host 半

- bundle 包 `package.json`：`dsh.bundle.patch` 指向 `cordis.patch.yml`；patch 用 `insert:` 列表插入行 `{id, name, config}`；显示元数据来自 locale `meta` 与 `package.json.icon`。
- Host 半导出形式：`export function apply(ctx, config)`（可带 `export const inject`、`export const Config`）或默认导出 service class；所有注册放进 `ctx.effect`/`ctx.on` 并返回清理。
- 安装/启用/停用由 `plugin_manager`（P0-B 经用户授权）执行，不手改 profile。

### 6.2 Host HTTP 路由（UI→Host 的已确认入口）

inspection 精确契约：

```
connection.fetch.register(route: ConnectionFetchRoute): () => Promise<void>
ConnectionFetchRoute {
  path: string
  methods: readonly ('GET' | 'HEAD' | 'POST')[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}
```

- `connection` 需写入 `inject`，`apply` 内 `ctx.effect(() => ctx.connection.fetch.register(...))`。
- Client 侧用同源相对路径 `fetch('api/<name>?...')` 调用（本机 `dsh-git-graph`/`dsh-token-stats` 参考实现的已跑通形态；本轮未在 P0-B 插件中复测）。
- 可选替代：Host `webServer.register(route)`。
- Client Service 目录中没有暴露给第三方 bundle 的通用 Host RPC/Remote namespace；自定义 Remote 生成链对第三方包的可用性**未验证**，本文不假设可以用。P0-B 需要通信时先用 `connection.fetch` 最小验证。

### 6.3 Tool 注册（P1 相关，P0-B 不需要）

inspection 精确契约：`ctx.tools.register(definition: ToolDefinition): () => void`；`ToolDefinition` 继承 `ToolSchema { name, description, parameters, deferLoading? }`，并含 `output { schema, render(args,value), presentationMeta? }`、`execute(args, exec): Promise<unknown>`、可选 `timeoutMs`、`isConcurrencySafe`、`presentCall/presentResult`。scoped 注册影子全局，disposer 精确移除；另有 `guards`/`restrict` 策略层。

### 6.4 effect 与清理

- Host：`ctx.effect(callback, label)` 返回 disposer；`ctx.on(name, listener)` 返回 disposer；路由/Tool/命令/监听器都应在 effect 内注册并返回清理，插件行停用/卸载时由 Cordis fiber 统一 dispose（P0-B 用真实停用验证）。
- Client：`ctx.slots.inject(key, callback)` 的注册随声明折叠/插件卸载清理；`ctx.locale.register(...)` 返回 disposer（应放 `ctx.effect`）；组件内 `<style>` 元素随组件卸载移除；模块系统会认领并清理 factory 物化期间注入的 `<style>` 标签（随应用包 `dsh-client-modules`/`ui-renderer` 行为）。
- P0-B 验收需实际执行「停用/卸载插件 → 页面无残留 Slot 条目、无 crash、无样式残留」，不以语法通过替代。

### 6.5 Client loader 与依赖（随应用包证据）

- 浏览器产物格式：`window.__ModuleLoader__.load({ id: '<包名>', factory(require) { ... } })`；`id` 必须等于包名；factory 惰性、无副作用，物化时才执行模块体。
- `package.json` 的 `dsh.client` 字段（随应用包 parser）：`platform`（`'web'`）、`inject?: string[]`（先注册/到达这些包再到达本包，用于激活顺序）、`external?: string[]`（基座之外的精确模块请求，解析到动态包 row 或静态表键）、`immediately?: boolean`（启动即激活）。构建期必须已有 `lib/client.js`，宿主消费的是**预构建** client bundle。
- 静态模块表 seed（随应用 web shell bundle）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。手写零构建 client 首版只需要 `react`；官方 practices 不建议依赖 `ui-primitives` 做长期插件。
- Client 半本身是一个 Cordis 插件对象（`exports = { inject: [...], apply(ctx) {...} }`），由模块系统在页面根树中激活；`inject` 里声明用到的 Client Service（如 `slots`、`layout`、`locale`）。
- 热更新：client bundle 改动可热替换；Host 代码改动需重启/重挂行。安装新 bundle 可能 HMR 生效，替换已安装包需重启（官方 host-plugin.md）。

## 7. 建议的 P0-B 组件边界（建议，未实现）

```
dsh-video/
├─ package.json            # name/version/type=module/exports "." ./client
│                          # dsh.bundle.patch + dsh.client{platform:'web'}
├─ cordis.patch.yml        # - insert: [{ id: dsh-video, name: <pkg>, config: {} }]
├─ index.js                # Host 半：首版可为空 apply（+ 后续 connection.fetch 路由、Tool、存储）
├─ client.js               # 手写 __ModuleLoader__ 模块：
│                          #   ModeSwitch（分段开关，共用）
│                          #   VideoWorkspacePanel（main key 'dsh-video'）
│                          #   ModeSwitch 注册到 conversation.header.leading
│                          #   videoStore（模块级状态，跨面板卸载保留）
├─ locale/{zh,en}.json     # 显示元数据与 UI 文案
├─ icon.svg
└─ README.md               # 安装/启用/禁用/回滚/已知限制
```

关键边界：

- 视频面板组件**不依赖 Session**，状态自持；普通模式不改宿主 Session 行为。
- 开关两个挂载点共用同一 store 与 locale；`usePanelInfo` 判断 active key。
- 首版不注册 `sidebar.panellist`；不加自定义 Remote；不写 session 事件；不覆盖 app root、不做 DOM 注入。
- 顶部位置按 §4.2 落在会话头行 leading；若主会话决定要居中，先按 §4.3/§4.4 做决定再实现。

## 8. 不可满足项、替代与待决策

**不可满足（0.2.0-rc.2 事实）**

1. 没有「主内容顶部居中」的专用 Slot；`shell.leading` 不可用（条件挂载且被占用）。
2. 不能用原生契约让 switch 精确水平居中于主列（overlay 无主列几何；读取宿主 DOM 不合规）。
3. 切到全局面板时 Conversation 子树卸载；文本选区/光标等多半丢失，宿主只兜底输入草稿与语义滚动位置。
4. 视频主面板没有 Session binding；视频状态必须插件自持，不能挂 session 生命周期。

**建议与待主会话/用户决定**

- D-A：顶部开关在普通模式接受**靠左**（`conversation.header.leading`），视频页面同位置对齐；还是要求居中而采用 overlay/影子替换（更高风险）？
- D-B：P0-B 最小版是否接受「从其它全局面板（插件/计划任务等）看不到模式开关」——若要求全局常驻，原生方案里只能走 overlay（§4.3），或影子替换 `shell.leading`（不可取）。
- D-C：视频模式状态首版用模块级 store（刷新丢失）即可，还是 P0-B 就要浏览器持久化（`dsh-client-store` localStorage）？
- D-D：工程内容持久化（Host 权威）留到哪个任务；P0-A 不提供实现结论。

**未验证（P0-B 需真机验证）**

- slot 注册后的真实渲染/位置/尺寸、drag 带交互；
- `selectPanel` 在插件 Client 上下文的调用与错误路径；
- 切换前后输入草稿、滚动语义锚点的真机表现与释放/重建时序；
- 停用插件后的清理；
- light/dark、窄窗口、其它插件共存；
- 自定义 Remote、Host 存储域对第三方 bundle 的可用性。

## 9. 证据来源与限制

- 运行时 inspection：22 次只读 `cordis_inspect_*` 查询（见 §2），未读取会话/消息/凭据内容。
- 随应用包：只读解包 `app.asar` 中 `@deepseek-ai/dsh-client-ui-{layout,conversation,chat,slots,sidebar,plugin-manager,renderer,store}`、`dsh-client-modules`、`dsh-web-frontend` 的 README/编译产物到 `/tmp/p0-asar/`；未修改安装目录。`read` 工具直接读 `app.asar` 虚拟路径报错，故采用只读解包。
- 官方 skill：归档 16 文件与 `app.asar` 内原文逐字节一致。
- 本机参考插件：`dsh-git-graph`/`dsh-token-stats` 的 main/panellist/slot 注册形态（只读）。
- 未做：安装插件、profile patch、真实页面交互、截图、视觉验证；本文件不代表 P0-B 已可运行。
