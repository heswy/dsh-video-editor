# DSH 插件开发交接包（dsh-plugin-dev-kit）

一套给「让别的 Agent 去开发 DSH（DeepSeek Harness）插件」用的材料。
2026-10-17 从本机 DSH **0.2.0-rc.2** 的安装包里导出，随 DSH 升级需要重新导出。

## 一句话结论

**有官方 skill，而且不止一个。** DSH 安装包内置了这套造插件技能：

| 技能 | 作用 |
|---|---|
| `cordis-plugin-development` | 主流程：设计 → 写 bundle → 安装 → 验证（带 references 与可复制的 templates） |
| `cordis-composition-reference` | Loader patch 语法（insert / 覆盖 / group / `!!js`）+ 全部可挂载包清单 |
| `editing-cordis-compositions` | 写/改 Agent 预设（preset） |

但它们只在 **Cordis 预设（Creator 模式）** 里通过 `skill-filesystem` 挂载，并且和
`plugin_manager`、`cordis_inspect_list` / `cordis_inspect_query` 两个只读检查工具配套。
本机 Desktop 默认会话是 `standard` 预设，所以默认状态下 Agent 的技能目录里看不到它们。

## 里面有什么

| 路径 | 用途 |
|---|---|
| `AGENT-BRIEF.md` | **直接粘给别的 Agent 的任务说明**，自包含，不依赖它读过内置技能 |
| `skill/cordis-plugin-development/` | 官方主技能原文（SKILL.md + references + templates） |
| `skill/cordis-composition-reference/` | Loader 语法 + 可挂载包清单 `references/packages.md` |
| `skill/editing-cordis-compositions/` | 官方预设编辑技能原文 |
| `VERSION.txt` | 来源版本与导出日期、本机参考实现路径 |

> 这些技能原文在所有 DSH 部署里都位于 `app.asar` 内部，**普通 shell / node / 外部 Agent 读不到**
> （只有 DSH Host 进程自己的文件读取能打开）。所以这里放了一份解压副本。

## 用法 A：让 DSH 自己的 Agent 开发（推荐）

1. 打开 **Settings → Agent presets**（或新建任务时的模式选择器），把默认预设换成
   **Cordis**，或直接点 **Creator**（Creator 入口就是用 `cordis` 预设新开一个任务）。
2. 该会话自动拥有：`cordis-plugin-development` 技能 + `cordis_inspect_*` 检查工具 +
   `plugin_manager` 安装工具。**不用手动装任何东西。**
3. 直接对它说：

   > 用 cordis-plugin-development 技能做一个 DSH 插件：<需求>。
   > 先给出最小可用版本并装上，再按需迭代；装之前告诉我你选的 slot 和验收方式。

它会在 workspace 里写 bundle 目录，用 `plugin_manager install_bundle` 装进当前 profile，
再用 `cordis_inspect_query` 和页面验证。**预设按会话生效**：已经开着的 standard 会话不会变，
要新开任务。

## 用法 B：外部 Agent（Codex / Claude Code / 其它）

外部 Agent 没有 `plugin_manager`，也读不到 `app.asar`。给它三样东西：

1. 本目录的 `AGENT-BRIEF.md`（把它作为任务开头一起发过去）；
2. `skill/` 目录（让它按需读 references / templates）；
3. 本机参考实现（已经在跑的插件代码，直接读）：
   - `dsh-git-graph`：侧栏图标 + 整页面板 + Host 侧 HTTP 路由，零依赖手写 client，最贴近「加一个页面」的需求；
   - `dsh-token-stats`：同类形态的看板，含本地 JSON 存储；
   - `dsh-plugin-codex-bridge`：正式 bundle 安装、宿主↔外部进程通信，复杂案例。

提示词模板（可复制）：

   > 你是 DSH 插件开发者。先完整读
   > /Users/orange/Documents/deepseek-harness/dsh-plugin-dev-kit/AGENT-BRIEF.md，
   > 再读 skill/cordis-plugin-development/references/practices.md 与 ui-plugin.md。
   > 参考 /Users/orange/Documents/deepseek-harness/dsh-git-graph 的 Host/Client 两半写法。
   > 需求：<一句话需求>。
   > 只写 workspace 里的新插件目录，不要改 profile 配置、不要跑 pnpm；安装由我来做。
   > 交付：目录绝对路径 + 安装步骤 + 验证步骤 + 已知限制。

外部 Agent 的会话结束后，你在 **DSH 窗口**里装它：侧栏 **Plugins → Add plugin →
填插件目录的绝对路径 → Install → Enable now**；或者把目录路径丢给一个 Creator 会话让它装。

## 用法 C：让任意 DSH 会话都能加载这份技能

`skill-filesystem` 会扫描用户级技能根目录并热发现，不需要重启：

```sh
mkdir -p ~/.agents/skills
cp -R /Users/orange/Documents/deepseek-harness/dsh-plugin-dev-kit/skill/cordis-plugin-development \
      /Users/orange/Documents/deepseek-harness/dsh-plugin-dev-kit/skill/cordis-composition-reference \
      /Users/orange/Documents/deepseek-harness/dsh-plugin-dev-kit/skill/editing-cordis-compositions \
      ~/.agents/skills/
```

（`~/.dsh/skills/` 是另一个用户级 root，效果相同；`~/.agents/skills/` 是本机现有技能实际所在的位置。）

装完后 `standard` 等预设的会话也能通过 skill 工具加载它。但注意：技能里的安装步骤依赖
`plugin_manager`（仅 Cordis 预设提供），`standard` 会话执行到安装那一步会卡住——
所以**开发插件仍建议直接用 Cordis 预设**，这个副本更适合给「只想读规范/审代码」的会话。

## 本机已验证的关键事实（写进 brief 的原因）

- 插件包 = 一个普通 npm 包目录：`package.json`（`dsh.bundle.patch` + 可选 `dsh.client`）、
  `cordis.patch.yml`（bundle 层）、`index.js`（Host 半）、`client.js`（浏览器半）。
- **正式安装**走 DSH 侧栏 Plugins 页（或 Cordis 会话的 `plugin_manager install_bundle`）；
  不要手改 profile 的 `package.json` / `node_modules`。
- **本机开发模式**：在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `insert` 一行指向
  插件绝对路径（`dsh-git-graph/README.md` §1 有现成写法），改 `client.js` 页面约 0.5s 热更新，
  改 `index.js` 需要重启 DSH 或停用/启用该行。
- 浏览器半是**手写模块**：`window.__ModuleLoader__.load({ id: '<包名>', factory(require){...} })`，
  `id` 必须等于包名；只有种子 specifier 可 `require`（`react` 最稳）。
- UI 用 slot 扩展：`ctx.slots.inject(...)` + `ctx.slots.register(...)`，常用
  `main`（整页）、`sidebar.panellist`（侧栏入口）、`conversation.composer.dock`、
  `shell.overlay`；样式只用 `--dsw-alias-*` 等主题 token。
- Host 半**不要 import `@deepseek-ai/*` 或第三方 npm 包**（profile 路径包解析不到），
  只用 `node:` 内置模块；数据经 `ctx` 服务或自注册 HTTP 路由
  （`inject: ['connection']` 后 `connection.fetch.register({ path, handler })`）。
- 改界面不需要重启应用，改 Host 代码需要；**不要**伪造截图来"验证"。

详见 `AGENT-BRIEF.md` 与 `skill/cordis-plugin-development/`。

## 维护

DSH 升级后重新导出：

- 源路径（Host 视角）：`<app.asar>/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/`
- 本机应用路径：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`
- `cordis-composition-reference/references/packages.md` 是可挂载包的全量清单，
  升级后包名/Config 可能变化，以新版技能原文为准。
