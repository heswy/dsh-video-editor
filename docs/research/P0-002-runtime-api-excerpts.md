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

## 6. 首轮评审修复（R1–R3）用到的补充契约

### R1：`slots.inject` 的等待与重声明语义（inspection 原文，已在 smoke 中按此建模）

```
inject(key, callback)
  - The callback runs synchronously when the declaration already exists; otherwise it
    runs inside the declaring register() call after the declaration is committed.
    Collapse disposes the effect and a later declaration runs it again.
  - The controller belongs to the caller's fiber, so plugin unload cancels a pending
    wait and removes any active contribution.
```

因此 `inject` 对「尚未声明」是**等待**而不是错误。P0-004 起，实现把视频面板与普通模式胶囊作为**一个原子对**，链仍挂在 `main` 声明回调内部，但注册顺序改为：先 `inject` leading，并在每个 leading 声明生命周期内先注册胶囊、再注册视频面板；任一环节失败/冲突/枚举不可用则整对不注册或撤回，leading 声明折叠时同步撤回已注册的一对（`main` 面板先撤、胶囊后撤，并在宿主仍报告视频面板时兜底 `selectPanel(null)`）。`main` 声明折叠时关闭整条链，重新声明后重建；leading 的后续声明会重试整对，因此晚到/独立重声明失败不会留下不可达面板。`Slots.entries(key)`（SlotRegistry 方法，见 `dsh-client-ui-renderer/lib/client.js`）仍是每次声明时的占用检查来源，不做低 priority 影子替换。

### R2：跨挂载点的呈现连续性没有宿主 API

两个挂载点（会话头 leading / 视频顶栏）在切换时必然各自卸载、重新挂载，宿主不提供跨挂载的视觉状态。实现使用插件内**短暂呈现提示**：导航前记录「离开的段」到插件级 store（`thumbOrigin`），新挂载点首次渲染时让玻璃底片从该段开始，随后两帧内切到宿主 `activePanel` 对应的真实位置；提示只被一个挂载点消费并立即清除，导航本身不等待动画。断言来源仍只有宿主 `usePanelInfo.activePanelId`。简化效果开启或 `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 为真时不记录提示；导航失败会清除提示。

### R3：模式胶囊的宿主字号

胶囊在 `.dv-root` 之外（普通模式会话头），因此不能依赖视频根字号；实现让 `.dv-mode` 自身 `font-size: var(--dsh-content-font-size, 14px)`，按钮文字用 `0.93em`，胶囊宽高用 `em` + `clamp()` 随字号增长并设上限；窄窗口只折叠品牌/简化开关文案等次要 chrome，不缩小导航文字。`--dsh-content-font-size` 由 `ui-layout` 的 ThemePresenter 写在 body 上（见 §4）。

### P0-004：入口与面板的原子对生命周期（修复 D-P0-003-1）

`conversation.header.leading` 是 single 座位，`main` 是 keyed 座位，两者声明生命周期独立；旧实现 main 先注册、再等待/注册 leading，当 leading 晚到或被占用时就会留下「main 已注册、胶囊缺席」的不可达视频面板。P0-004 的契约：

- `main` 声明回调只建立链，不直接注册面板；链内对每个 leading 声明生命周期执行一次获取：
  1. 检查 leading 占用；冲突/枚举不可用 → 报价诊断并放弃本次获取（不注册任何一侧）；
  2. 注册 leading 胶囊；失败 → 报告 `leading-register-failed` / `leading-entry-unavailable`，不注册面板；
  3. 再检查 main key（防竞争），注册视频面板；失败 → 立即 dispose 已注册的胶囊，不留下半对；
  4. 一对都成功后记录 disposal 句柄；该 leading 声明折叠时，先撤面板再撤胶囊，并检查 `panelInfo.activePanelId`，若仍是 `dsh-video` 则兜底 `selectPanel(null)`。
- leading 声明再次出现时（座位重新可用）重试整对；main 声明折叠时关闭链（dispose leading inject 句柄 + 当前对），main 重新声明后重建。
- 每个对只释放一次（`disposed` 标志）；不递归 dispose、不重复注册、每个失败都带 `dsh-video:` 诊断。
- 合约测试（`scripts/smoke-client.mjs`，30 条）覆盖：晚到 leading 且无占用（仅在声明时成对挂载，胶囊先于面板）、晚到 leading 且有竞争（零注册、冲突诊断、清除竞争并重声明后成对恢复）、已有的对因独立重声明失败而整体撤回并可在清除竞争后恢复、连续 3 轮 leading 折叠/重声明无重复注册/无 cleanup 错误、main 折叠时在视频模式下的安全回落、未成对/被拒状态下卸载零残留。

## 7. 明确未使用 / 未验证

- 未使用：`sidebar.panellist`、`shell.overlay`、`shell.leading`、替换宿主 header、自定义 Remote、`defineStore` 宿主存储、任何业务 HTTP 路由。
- P0-003 已在本机真实页面覆盖：Slot 渲染与尺寸、胶囊位置、R2 动画真实播放、模式往返/快速反向、停用与重启用、视频模式内停用回退、草稿文字+图片附件、宿主字号、深色主题、1000×760 窄窗；证据见 `P0-003-live-validation.md` 与 `evidence/P0-003/`。
- 仍未验证：冷启动/首次加载、no-drag 拖动、浏览器 console、reduced-motion、引用 chip、普通文件附件、静态阅读位置、键盘 Tab/焦点环；以及 0.1.1 修复包在真实宿主上的替换验证（需用户另行授权，先不替换已安装 0.1.0）。
