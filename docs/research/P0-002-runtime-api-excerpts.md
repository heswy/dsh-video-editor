# P0-002 运行时 API 摘录（P0-B 实际使用项）

日期：2026-10-17。版本固定：DeepSeek Harness Desktop **0.2.0-rc.2**（`app.asar` sha256
`18d5036bbb58eaff41d351ede99314b8d06505aec06fb2e164c49874ada30f9e`）。

本文只记录 P0-B 实现**实际用到**的接口与字段，作为 [P0-001 调查](P0-001-runtime-contract.md) 的补充摘录。证据来源：运行中 `cordis_inspect_*`（只读）＋随应用包只读源码/README；未安装、未启用插件，未读取用户会话内容。第三方插件信息已省略。

## 1. 安装形态与 Client loader

| 项 | 摘录 | 来源 |
|---|---|---|
| bundle patch | `package.json.dsh.bundle.patch -> ./cordis.patch.yml`；patch 用 `- insert:` 列表插入 `{ id, name, config }` 行 | 官方 skill `host-plugin.md`；本机参考插件 `dsh-git-graph` |
| Client 声明 | `dsh.client = { platform: 'web', inject?: string[], external?: string[], immediately?: boolean }`；`platform` 必填字符串，`inject`/`external` 为字符串数组，`immediately` 为布尔 | 随包 `@deepseek-ai/dsh-client-modules/lib/index.js`（`parseDshClient`） |
| Client 产物 | `exports["./client"]` 指向已构建的浏览器 bundle；构建期必须存在该文件 | `@deepseek-ai/dsh-client-modules` README |
| 模块格式 | `window.__ModuleLoader__.load({ id, factory(require) {...} })`；`id` 等于包名（模块身份＝manifest 包名）；factory 惰性、CJS 风格 | `dsh-client-modules` README/源码；本机参考插件 |
| `dsh.client.inject` 语义 | 先注册/到达列出的 package row，再到达消费者；只影响激活顺序，不产生模块 import 边 | `dsh-client-modules/lib/client.js`（`arriveGraphRow`） |
| `external` 语义 | 基座之外的精确模块请求，解析到动态包 row 或静态模块表键；本插件不使用（只 require React） | 同上 |

静态模块表 seed（随包 web shell `dsh-web-frontend/dist/assets/index-*.js` 内）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。P0-B 只使用 `react`；**不**运行时导入 `ui-primitives` 等内部 UI 包。

## 2. Client Service 摘录（inspection 原文）

### `slots`（Slot 注册表）

```
inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void
  - Install an effect for each declaration lifetime of a slot. The callback runs
    synchronously when the declaration already exists; otherwise it runs inside the
    declaring register() call after the declaration is committed. Collapse disposes
    the effect and a later declaration runs it again. ... The controller belongs to
    the caller's fiber, so plugin unload cancels a pending wait and removes any
    active contribution.
register = SlotCore['register']
```

- 实现类 `SlotRegistry` 另暴露 `entries(key)`、`spec(key)`（用于 P0-B 的占用冲突诊断；均在能力检测后调用，不依赖它们完成注册）。
- 来源：`@deepseek-ai/dsh-client-ui-renderer/lib/client.js`（SlotRegistry）、`@deepseek-ai/dsh-client-ui-slots/lib/index.js`（SlotCore 注册校验/options）。

### `layout`（面板导航）

```
selectPanel(panelId: MainPanelId | null): void
  - Select a global central panel without changing the current Session.
  - panelId: registered main key, or null to show the Conversation
  - throws: if the selected main key is not registered; preserves the current selection
```

- `MainPanelId = Branded<'MainPanelId'>`（运行时为字符串）。
- 实现类 `LayoutController` 暴露 `panelInfo` 可观察源 `{ getSnapshot(), subscribe() }`，`getSnapshot().activePanelId` 为当前面板。P0-B 只在卸载清理时能力检测后读取它，主路径的选中态来自 Slot 标准 prop `usePanelInfo`。
- 来源：`@deepseek-ai/dsh-client-ui-layout/lib/client.js`（LayoutController、root slot 声明、`retainMainPanels`）。

### `locale`（字典）

```
register(ns, dicts: Record<BuiltInLocaleId, LocaleDict>): () => void   // 双语一次注册
register(ns: string, locale: string, dict: LocaleDict): () => void     // 单语言非类型化形式
bind(ns): Translate
```

P0-B 用双语形式 `{ zh, en }` 注册命名空间 `dshVideo`，Slot 注册选项 `locale: 'dshVideo'` 提供 `t`。

## 3. Slot 摘录（inspection 原文）

### `main`（keyed / root）——视频全局面板

```
purpose: Central panel selected by sidebar entry id.
scope: root
registration: [{ name: 'key', type: 'string', required: true }]
description: ... The reserved `conversation` key hosts the Conversation; other keys
             receive no Session binding.
occupants (0.2.0-rc.2 live): conversation / plugins / schedules / 一个本机第三方面板（省略）
```

宿主渲染：`renderSlot("main", {}, { entryKey: usePanelInfo(info => info.activePanelId) ?? "conversation" })` —— 只有当前 key 的条目被渲染，切换即卸载 Conversation（P0-B 状态策略依据）。

### `conversation.header.leading`（single / root）——普通模式入口

```
purpose: Global navigation before the Session title, available without a Session.
scope: root
registration: []                       // single：无 key/id/select 必填
ownerProps: { children?: never }       // 不传 owner 私有值
standardProps: useResource, useWorkspaces, usePanelInfo, useSessions,
               useSessionStatus, useSessionRetainInfo, useWorkspaces
occupants (0.2.0-rc.2 live): []
```

- 位于宿主常驻会话头 `<header data-window-drag>` 内、标题之前；blank session 也保留。
- single Slot 每个 priority 只允许一个占位者；同 priority 冲突时注册抛错。P0-B 不用低 priority 影子替换；检测到占用即拒绝挂载并报诊断。
- 来源：`@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（ConversationHeader）、SlotCore。

### 通用注册 options

`name`（定位已声明 Slot）＋按 kind 的 `key`/`id`/`select`，另可带 `priority`、`order`、`label`、`locale`、`inject`、`store`、`children`。本插件使用 `name/key/locale/inject`。

## 4. Theme token 与宿主 CSS 变量

P0-B 使用的 inspection 主题 token（全部要求 light+dark）：

`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、
`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、
`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-idle-primary`。

派生颜色只用 `color-mix(...)` 或透明度，不写主题色 hex；阴影内高光等纯光效使用半透明白/黑。

宿主发布的 CSS 变量（非 theme token，按用途能力检测/带 fallback 使用）：

| 变量 | 用途 | 来源 |
|---|---|---|
| `--dsh-frame-leading-clearance` | macOS 侧栏完全折叠时窗口 chrome 座占用的行内带宽；普通模式胶囊与视频顶栏用它避让红绿灯与 shell.leading 控件 | `ui-layout` README/源码（仅在 darwin 侧栏折叠时发布） |
| `--dsh-content-font-size` | 宿主正文字号；视频页根字号跟随，实现宿主字号缩放 | `ui-layout` `ThemePresenter`（写在 body 上） |

拖拽带机制：`html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}`，控件用 `-webkit-app-region:no-drag`（本插件对胶囊/开关自身声明 no-drag；视频顶栏只设置 `data-window-drag` 属性，由宿主基础 CSS 决定是否成为拖拽行）。来源：`dsh-web-frontend/dist/assets/index-*.css`。

## 5. 生命周期与卸载

- `ui-layout` 的 `retainMainPanels`：订阅 `main` Slot 变化，当 `activePanelId` 不在 live 主面板 keys 中时将其清为 `null`（回到 Conversation）。这是「视频模式中停用插件」的主要安全返回机制；P0-B 另加一个带能力检测的卸载清理，仅在宿主仍报告 `dsh-video` 时调用 `selectPanel(null)` 作为兜底。
- 所有注册都经 `ctx.slots.inject` / `ctx.effect` 持有，插件 fiber 卸载时自动 dispose；本地 smoke 测试以模拟 disposer 验证「注册可全部移除」。
- Host 半为空 `apply()`；P0-B 无路由、Tool、存储或 session 事件。

## 6. 明确未使用 / 未验证

- 未使用：`sidebar.panellist`、`shell.overlay`、`shell.leading`、替换宿主 header、自定义 Remote、`defineStore` 宿主存储、任何业务 HTTP 路由。
- 未验证（需安装后真机执行 P0-002 验收清单）：真实 Slot 渲染与尺寸、拖拽带内控件点击、`selectPanel` 在插件上下文的真实调用、切换前后草稿/滚动、停用/重新启用清理、明暗主题与窄窗口。
