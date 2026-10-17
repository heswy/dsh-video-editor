# DSH Video

运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。目标是让 AI 创建可编辑的视频工程，用户直接修改后，AI 能继续编辑同一份工程并导出 MP4。

用户最新确定的入口（P0-005）：DSH 左侧原生导航中，在「上下文洞察」之后、「工作区」分组之前，单行 **Vedio Editor** + 细线条视频图标。文字按用户指定拼写保留。原顶部「普通｜视频」胶囊已移除。这里的入口是产品工作区导航，不改变 Agent preset、模型或权限。

当前阶段：P0-005 已实现侧栏入口、精简空工作区与原生导航契约验证，产出 `0.1.2` 固定包（未安装）。当前机器上安装并启用的是 `0.1.0`，本仓库的 `0.1.2` 待主会话复审、由用户授权后替换。工作基线为本机 DSH Desktop **0.2.0-rc.2**。

- [当前状态与下一步](docs/STATUS.md)
- [开发与协作规则](docs/DEVELOPMENT.md)
- [产品范围](docs/product/PRODUCT.md)
- [前端设计规划](docs/design/FRONTEND-DESIGN.md)
- [决策记录](docs/DECISIONS.md)
- [阶段路线](docs/ROADMAP.md)
- [DSH 首任务交接](docs/handoffs/DSH-START.md)
- [原始调研](docs/research/2026-10-17-video-workflows-and-dsh-plugins.md)
- [P0-002 运行时 API 摘录](docs/research/P0-002-runtime-api-excerpts.md)
- [P0-005 侧栏契约与交付记录](docs/research/P0-005-sidebar-contract.md)

仓库中的原始方案、开发包及截图用于追溯，采纳范围以产品文档、决策和当前任务为准。

## 可安装 bundle（P0-005 交付）

**本仓库根目录就是一个可安装 bundle**，零构建、无运行时依赖。

| 项 | 值 |
|---|---|
| 包名 / Loader 行 id / Client 模块 id | `dsh-video`（当前包版本 `0.1.2`） |
| 全局面板 key | `main` keyed slot 中的 `dsh-video` |
| 侧栏入口 | `sidebar.panellist` 中 `id: dsh-video`、`order: 30`、`label: Vedio Editor` |
| 包内文件 | `package.json`、`cordis.patch.yml`、`index.js`、`client.js`、`locale/en.json`、`locale/zh.json`、`icon.svg`、本 README |

`index.js` 是空的 Host half（P0 没有业务路由、Tool 或存储）；`client.js` 是手写的浏览器半，遵循 `window.__ModuleLoader__.load({ id, factory(require) {...} })` 格式，只 require 宿主 React。

### 支持范围

- **侧栏入口**：注册进 `sidebar.panellist`（list），与宿主的「插件 / 自动化任务 / 上下文洞察」行共存，排在它们之后、「工作区」分组之前；行、间距、颜色、展开/折叠与选中反馈全部由宿主渲染，插件只提供 16-unit `currentColor` 细线条图标与本地化 label。选中态来自宿主布局 store（`activePanelId`），插件不保存第二份模式状态。
- **视频面板**：全局面板 `dsh-video`，无工程时主区只显示一句「尚无工程」；顶栏仅保留轻量「返回对话」和一个可访问的「显示选项」菜单（含「简化界面效果」开关）。不渲染创建/导出/时间线/预览等尚未实现的能力。
- **原子生命周期**：视频面板与侧栏入口是一个原子对——先注册面板、再注册入口；入口注册失败会同步回滚面板，任一侧声明消失/失败/冲突都会释放两侧并安全回会话；声明恢复后自动重试。不会出现「有面板、无入口」的不可达状态，也不抢占其它面板或其它侧栏条目。
- **返回与卸载**：顶栏「返回对话」调用 `ctx.layout.selectPanel(null)`；禁用插件时宿主 `retainMainPanels` 回退，插件另带卸载兜底。返回失败会在面板内以 `role="alert"` 明确提示。
- **显示偏好**：只持久化「简化界面效果」到 `localStorage` 键 `dsh-video.ui.v1`（版本化；损坏/旧版本/读写异常回退默认值）。简化效果与系统 `prefers-reduced-motion` 都会关闭面板入场过渡。
- 字号跟随宿主 `--dsh-content-font-size`；macOS 顶栏按 `--dsh-frame-top-clearance` 避让窗口 chrome，侧栏折叠时按 `--dsh-frame-leading-clearance` 避让 shell 控件；颜色只使用已核实的主题 token。

### 不包含（P0）

工程创建/保存、预览、时间线、素材、AI 生成、导出；替换宿主 header；自定义 Remote；HyperFrames/ffmpeg；真实媒体持久化；任何侧栏 DOM 覆盖或排序 hack。

### 安装（需用户明确授权；由 DSH 界面执行）

本仓库未做任何 profile 修改；`0.1.2` 也未安装。安装由用户在 DSH 中完成：

1. 侧栏 **Plugins → Add plugin**；
2. 填入本仓库根目录的绝对路径（或审阅通过的固定 tarball）；
3. **Install**，完成后选择 **Enable now**。

不要在 shell/profile 中手改 `package.json`、`cordis.patch.yml` 或 `node_modules`；安装和 bundle 选择由 Plugin Manager 负责。

### 诊断

- 插件会在拒绝挂载时向当前页面控制台写 `dsh-video:` 前缀的诊断：`main-key-conflict`、`sidebar-entry-conflict`、`main-register-failed`、`sidebar-register-failed`、`sidebar-entry-unavailable`、`main-entries-unavailable` / `sidebar-entries-unavailable` 等。**插件行已启用但侧栏没有 Vedio Editor 行**时先查这些日志；不要用 DOM/overlay 或占位 side seat 抢占位置。
- 侧栏行或面板因宿主声明重建而暂时消失时整对会被撤回，声明恢复后自动重现；这是保护行为，不是加载失败。
- 本地检查 `npm run check` 只覆盖代码/契约层面，不代表真实页面位置、图标、主题或交互已通过。

### 停用与回滚

- **停用**：Plugins 页面关闭 `dsh-video` 的开关。插件行卸载时，浏览器半的 `main` / `sidebar.panellist` 条目、locale 与样式会被注销；若停用时正在视频模式，宿主 `retainMainPanels` 会把中央面板恢复为 Conversation（真实页面行为需安装后验证）。
- **重新启用**：再次打开开关即可，无需重建。
- **回滚/卸载**：Plugins 页面移除该 bundle；浏览器偏好可另行删除 `localStorage` 中的 `dsh-video.ui.v1`。
- **数据影响**：P0 不写 profile、不写工程/媒体、不写 session 事件；卸载不会影响会话与草稿。

### 本地检查（零构建）

```sh
node --check index.js
node --check client.js
node scripts/check.mjs          # manifest / patch / exports / files / locale / 侧栏契约 / 原子生命周期 / 空状态文案
node scripts/smoke-client.mjs   # Client 模块、侧栏注册、原子生命周期、面板内容、显示菜单、持久化与清理 smoke
# 或一次运行：
npm run check
```

`scripts/` 只用于本地检查，不在 `files` 安装清单内。

### 未验证（需安装 0.1.2 后按另行授权验收）

真实宿主中侧栏行的精确位置/间距/图标观感、展开与折叠、浅深主题、窄窗口与字号、键盘 Tab/焦点/返回、侧栏行与面板的真实启停与卸载回退、草稿/引用/附件保持、静态阅读位置、冷启动、console。契约证据来自 0.2.0-rc.2 的只读 Slots inspection 与宿主包源码；真实页面验收不得由契约或 mock 截图代替。
