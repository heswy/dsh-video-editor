# AGENT BRIEF — 开发一个 DSH（DeepSeek Harness）插件

> 本文件可直接作为任务说明交给任意 Agent（DSH 内的 Agent、Codex、Claude Code 等）。
> 环境基线：macOS 桌面版 DSH 0.2.0-rc.2；本机持久化 profile 为 `desktop`
> （`DSH_PROFILE=desktop`，`DSH_PROFILE_DIR=~/.dsh/profiles/desktop`）。
>
> 配套材料：
> - 官方技能原文：`/Users/orange/Documents/deepseek-harness/dsh-plugin-dev-kit/skill/`
> - 本机已跑通的参考实现：`../dsh-git-graph/`、`../dsh-token-stats/`、`../dsh-plugin-codex-bridge/`
>   （均相对本文件所在目录 `/Users/orange/Documents/deepseek-harness/`）

---

## 0. 目标与边界

你要产出一个 **DSH bundle 插件**：一个普通 npm 包目录，装进当前 profile 后，在桌面 Web UI
出现一个新页面/面板/侧栏入口/工具，或在 Host 侧提供新能力。

**边界（不做的事）**

- 不修改 DSH 源码或 `app.asar`，不 fork DSH。
- 不手改 profile 的 `package.json`、`node_modules`，不在 profile 目录跑 `pnpm`
  （正式安装由 DSH 的 Plugins 页面 / `plugin_manager` 完成）。
- 不新造 session 事件类型，不写 `session.lock`，不碰用户凭据。
- 不为了"预览"生成 mock 截图/HTML 冒充验证。

**交付**

1. workspace 下新建插件目录（建议 `/Users/orange/Documents/deepseek-harness/<plugin-name>/`）；
2. 目录内至少：`package.json`、`cordis.patch.yml`、`index.js`（Host 半）、`client.js`（UI 半）；
3. 一份 `README.md`：用途、安装方式、配置项、生效/回滚方式、已知限制；
4. 回复用户：目录绝对路径 + 安装步骤 + 验证结果 + 未验证项。

---

## 1. 先读什么（按顺序）

1. 本文件。
2. `skill/cordis-plugin-development/SKILL.md`（官方主流程，短）。
3. 按需读它的 `references/`：
   - `host-plugin.md`：bundle manifest、Host 导出形式、安装/启用语义、Config；
   - `ui-plugin.md`：浏览器半 manifest、模块加载器、slot 注册；
   - `practices.md`：扩展点选择、稳定性、性能、UI 规范（**写 UI 前必读**）；
   - `user-actions.md`（插件 UI 需要触发操作时）、`verification.md`（验证边界）。
4. `skill/cordis-plugin-development/templates/` 里有 4 个可复制的起步文件
   （decoration：package.json / cordis.patch.yml / index.js / client.js）。
5. 参考实现（真实、已验证、无依赖）：
   - `dsh-git-graph`：侧栏图标 + `main` 整页面板 + Host HTTP 路由 → 最接近"加一个页面"；
   - `dsh-token-stats`：同类看板 + 本地 JSON 存储；
   - `dsh-plugin-codex-bridge`：正式 bundle 安装、跨进程投递（复杂案例，别照抄结构）。

---

## 2. 最小插件结构

目录：

```
my-plugin/
├─ package.json
├─ cordis.patch.yml
├─ index.js      # Host 半（Node 侧，注册服务/路由/工具）
└─ client.js     # 浏览器半（Web UI 的 React 组件，slot 注册）
```

`package.json`（UI 插件；只有 Host 半时删掉 `dsh.client` 和 `./client` 导出即可）：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "一句话说明",
  "main": "index.js",
  "exports": { ".": "./index.js", "./client": "./client.js", "./package.json": "./package.json" },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

`cordis.patch.yml`（bundle 层，负责插入自己的行）：

```yaml
- insert:
    - id: my-plugin
      name: 'my-plugin'
      config: {}
```

> 行 `id` 必须唯一（profile 全局）。`name` 写包名；用绝对路径做本机开发可按 §3-B 写路径。

`index.js`（Host 半）：

```js
export const name = 'my-plugin'
export const inject = ['connection']          // 用到的服务都要声明

export function apply(ctx, config) {
  // 所有注册都放进 ctx.effect / ctx.on，并返回清理函数
  ctx.effect(() => {
    const dispose = ctx.get('connection').fetch.register({
      path: '/api/my-plugin',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        return new Response(JSON.stringify({ ok: true, data: {} }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    return () => dispose?.()
  }, 'my-plugin: route')
}
```

`client.js`（浏览器半）——**手写模块，不是普通 ESM 文件**：

```js
window.__ModuleLoader__.load({
  id: 'my-plugin',                 // 必须等于 package.json 的 name
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function MyPanel() {
      return h('div', { style: { padding: 24 } }, 'Hello DSH')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'my-plugin' }, MyPanel))
      },
    }
  },
})
```

---

## 3. 安装与生效（二选一）

### A. 正式安装（推荐交付方式）

由 **DSH 窗口这一侧**执行，不要在 shell 里自己动 profile：

1. 侧栏 **Plugins → Add plugin**，填插件目录绝对路径（或包名 / Git 地址 / tarball）；
2. **Install** → 完成后 **Enable now**；
3. 若该实例带 Creator 预设，也可以由 Creator 会话调用
   `plugin_manager install_bundle` 并传绝对目录作为 `target`，它自己完成安装与启用。

安装/启用会执行 Host 代码（in-process，沙箱外），用户侧需要 Full access 或确认授权。
**外部 Agent 不要代替用户安装**，把目录路径交给用户。

### B. 本机开发模式（快速迭代，本机已验证）

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加一行指向插件绝对路径
（见 `dsh-git-graph/README.md` §1）：

```yaml
- insert:
    - id: my-plugin
      name: '/Users/orange/Documents/deepseek-harness/my-plugin/index.js'
      config: {}
```

- 改 `client.js`：页面自动换新（本机实测约 0.5s），不用重启；
- 改 `index.js`：需要重启 DSH，或在 Plugins 页把该行停用再启用；
- 交付前把这行留给用户决定（这是本机开发开关，不属于插件本身）。

---

## 4. Host 半硬规则

- 导出形式：`export function apply(ctx, config)`（可加 `export const inject`、
  `export const Config`），或默认导出 Cordis service class；**不要混用**。
- **不要 import `@deepseek-ai/*`，也不要 import 第三方 npm 包**：profile 安装的路径包无法
  从自身位置解析它们（本机两个插件的注释里都踩过这个坑）。只用 `node:` 内置模块；
  需要能力就通过 `ctx` 已注入的服务取。
- 用到的服务必须写进 `inject`。`connection` 必须在 `inject` 里而不是临时 `ctx.get`
  （冷启动时 Web 连接服务注册晚于 session 服务，只读会拿到 undefined → 路由 404）。
- 注册路由的已验证写法：`connection.fetch.register({ path: '/api/xxx', methods,
  requestBody: 'buffered', fetch: handler })`，`handler` 返回 Web `Response`；
  拿不到 `connection` 时回退 `ctx.get('webServer').register(...)`（可选）。
- 所有注册放进 `ctx.effect(...)` 并返回 cleanup；失败要 log 出来，不要静默降级。
- 配置：默认值写在插件里，`cordis.patch.yml` 给行默认 config，用户可在 profile patch 覆盖；
  插件里对 `config` 做防御式读取（类型不符回退默认，不要因坏配置启动失败）。
- **不要 append 新类型的 session 事件**（旧读者/重开会被拒）；状态从现有事件派生，
  或用自己的存储文件（如 `$DSH_HOME/storages/<name>/`）。
- 不要轮询 `agent/status`；等 `turn/end`、`assistant/message`、`tool/result` 等持久事件。

---

## 5. UI 半硬规则

- 浏览器产物格式固定：`window.__ModuleLoader__.load({ id: '<包名>', factory(require){...} })`，
  `id` 必须等于包名；`factory` 是惰性工厂，不要在工厂里做副作用。
- 只能 `require` 种子模块。`react` 最稳；本机参考实现还 require 了
  `@deepseek-ai/dsh-client-ui-primitives`（可用，但官方技能明确不建议依赖它做长期插件，
  升级可能破坏，且无类型检查）。**优先只依赖 react，自己写小组件和样式。**
- 扩展点用 slot：`ctx.slots.inject(ownerKey, () => ctx.slots.register(options, Component))`。
  本机已跑通的组合：
  - 整页：`main` + `{ name:'main', key:'<id>', locale:'<ns>', inject: () => ({...}) }`；
  - 侧栏入口：`sidebar.panellist` + `{ name:'sidebar.panellist', id, order, label, locale }`；
  - 其他常见 slot（需按需确认 props/选项）：`conversation.composer.dock`、`shell.overlay`、
    `conversation.chat.node`。**slot 的注册选项和 props 因 slot 而异**，不要照搬。
- 样式只用主题 token：`--dsw-alias-*`、`--dsw-font-*`、`--dsw-radius-*` 等；
  不写死颜色（美术素材除外），同时检查明/暗主题。
- 不要 iframe、不要替换 app root、不要向 `document.body` 追加节点、不要读别的插件的
  DOM/样式来"估算位置"；渲染在分配的 slot 里。
- 文本走 Client locale 服务（`ctx.locale.register(ns, { zh, en })`），不要硬编码单语言。
- 样式/locale/监听器等资源放进 `ctx.effect` 并返回 cleanup；组件本地样式可渲染成 React 元素。
- 数据取法：Host 半注册 `/api/...` 路由，client 用同源相对路径 `fetch('api/my-plugin?...')`
  （本机参考实现就是这么做的）；不要在 client 里直接访问 Node / 文件系统。

---

## 6. 怎么确认 API（按环境二选一）

- **在 DSH 的 Cordis 预设会话里（有工具）**：用 `cordis_inspect_list`，
  再 `cordis_inspect_query` 查 `Service` / `Event` / `Tool` / `Config.listConfigs` /
  `Slots.listSubTree` / `Theme`。这是最准的，装完也用 `plugin_manager list_plugins`
  看行状态（`enabled`、`fiberPhase`）。
- **外部 Agent（没有工具）**：以本 kit 的 skill 原文 + 两个参考实现的源码为准；
  不确定的 slot/props 先向用户要一份 `cordis_inspect_query` 的结果，或先用
  本机已验证的 `main` / `sidebar.panellist` 形态做最小版本。

---

## 7. 验证清单（交付前逐条过）

1. `node --check index.js` / `node --check client.js` 通过；
2. manifest 合法：`package.json` 可 JSON.parse，`dsh.bundle.patch` 指向存在的文件；
3. 安装后 Plugins 页该行不是 failed/overridden；页面刷新后目标 slot 有内容；
4. Host 路由：`curl -s "$DSH_WEB_URL/api/<name>?view=..."`（`DSH_WEB_URL` 由桌面注入，
   本机当前是 `http://127.0.0.1:19387`）返回预期 JSON
   （或由用户在页面里确认数据出来了）；
5. 明/暗主题、窄窗口不溢出；浏览器 console 无 slot crash；
6. 停用/删除后 UI 恢复原样（说明清理逻辑生效）；
7. 诚实说明未验证项（例如没有浏览器控制时无法确认视觉效果）。

无浏览器控制时：不生成 mock 截图、不模拟 React——只做语法/manifest/路由/slot 注册检查，
并明确报告"视觉验证不可用"。

---

## 8. 已知坑（本机踩过/官方文档强调）

- 插件行 `id`、包名全局唯一；覆盖已有行要按 Loader patch 语义**整段替换 config**（不是深合并）。
- 不要用 `ctx.remote.*` 新增第三方 Remote（本机结论：第三方无法新增，走 `connection.fetch` 路由）。
- 手写 client 没有 JSX/打包器：用 `React.createElement`；纯字符串 CSS 注入 `<style>`
  （dedupe 后 `document.head.appendChild`，或在组件内渲染 style 元素）。
- Host 半 reload ≠ Client 半 reload：client 热更新快，host 代码需要重启/重挂行。
- 安装新 bundle 可能 HMR 生效；**替换已安装包需要重启**才能加载新的 JS 模块代。
- Desktop 里内置技能/包在 `app.asar` 内，shell/外部进程读不了；需要模板就从本 kit 复制。
- 别把 DSH client 包（`@deepseek-ai/dsh-client-ui-*`）当公共 API；样式 token 才是稳定接口。
- 改完立即在真页面看效果；"装上了/注册成功"不等于"用户能看到"。

---

## 9. 开工前先确认（只问一次，别反复问）

1. 插件的**形态**：整页 / 侧栏入口 / 对话区装饰 / 后台工具（决定 slot 与 Host 半结构）；
2. 数据来源：纯前端计算 / 需要 Host 读本机数据 / 需要网络（决定路由与权限）；
3. 插件目录名与包名（默认 `<plugin-name>`）。

确认后直接给最小可用版本，装上、验证，再迭代；不要先做设计稿或 mock 页面。
