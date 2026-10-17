# DSH Video

运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。目标是让 AI 创建可编辑的视频工程，用户直接修改后，AI 能继续编辑同一份工程并导出 MP4。

用户已确定入口：主内容区域顶部的「普通｜视频」切换。普通模式保留 DSH 原有体验，视频模式进入插件工作区。这里的模式是产品工作区视图，不是修改 Agent preset。

当前阶段：P0-B 已实现可安装 bundle（原生顶部模式切换 + 诚实的视频空工作区），**尚未安装/启用，也尚未通过真机验收**。开发基线为本机 DSH Desktop **0.2.0-rc.2**。

- [当前状态与下一步](docs/STATUS.md)
- [开发与协作规则](docs/DEVELOPMENT.md)
- [产品范围](docs/product/PRODUCT.md)
- [前端设计规划](docs/design/FRONTEND-DESIGN.md)
- [决策记录](docs/DECISIONS.md)
- [阶段路线](docs/ROADMAP.md)
- [DSH 首任务交接](docs/handoffs/DSH-START.md)
- [原始调研](docs/research/2026-10-17-video-workflows-and-dsh-plugins.md)
- [P0-002 运行时 API 摘录](docs/research/P0-002-runtime-api-excerpts.md)

仓库中的原始方案、开发包及截图用于追溯，采纳范围以产品文档、决策和当前任务为准。

## 可安装 bundle（P0-B 交付）

**本仓库根目录就是一个可安装 bundle**，零构建、无运行时依赖。

| 项 | 值 |
|---|---|
| 包名 / Loader 行 id | `dsh-video` |
| Client 模块 id | `dsh-video`（与包名一致） |
| 全局面板 key | `main` keyed slot 中的 `dsh-video` |
| 普通模式入口 | `conversation.header.leading`（single，additive） |
| 包内文件 | `package.json`、`cordis.patch.yml`、`index.js`、`client.js`、`locale/en.json`、`locale/zh.json`、`icon.svg`、本 README |

`index.js` 是空的 Host half（P0-B 没有业务路由、Tool 或存储）；`client.js` 是手写的浏览器半，遵循 `window.__ModuleLoader__.load({ id, factory(require) {...} })` 格式，只 require 宿主 React。

### 支持范围

- 正常模式：会话头行（`conversation.header.leading`）中的玻璃胶囊「普通｜视频」，空闲/blank/已有会话均可用，选中态读取宿主 `usePanelInfo.activePanelId`。
- 视频模式：全局面板「视频」，渲染同一胶囊 + 诚实的空工作区（无工程时如实说明）、可工作的「返回普通模式」入口、以及「简化界面效果」开关。
- 切换使用 `ctx.layout.selectPanel('dsh-video' | null)`，不改变当前 Session、模型、权限或 preset，不写 session 事件。
- 「简化界面效果」偏好保存在浏览器 `localStorage` 键 `dsh-video.ui.v1`（版本化；损坏/旧版本/读写异常回退默认值，不影响使用）。
- 普通会话的草稿、阅读位置与 View 偏好由 DSH 宿主自身保存；插件不操纵宿主编辑器内部状态。DOM 文本选区/光标/IME 瞬时态不承诺保留。

### 不包含（P0-B）

工程创建/保存、预览、时间线、素材、AI 生成、导出；侧栏入口；overlay 浮层；替换宿主 header；自定义 Remote；HyperFrames/ffmpeg；真实媒体持久化。

### 安装（需用户明确授权；由 DSH 界面执行）

P0-B 交付时未获安装授权，本仓库未做任何 profile 修改。安装由用户在 DSH 中完成：

1. 侧栏 **Plugins → Add plugin**；
2. 填入本仓库根目录的绝对路径（例如 `/Users/<user>/.../dsh-video-editor-worktrees/p0-mode-shell`）；
3. **Install**，完成后选择 **Enable now**。

不要在 shell/profile 中手改 `package.json`、`cordis.patch.yml` 或 `node_modules`；安装和 bundle 选择由 Plugin Manager 负责。

### 停用与回滚

- **停用**：Plugins 页面关闭 `dsh-video` 的开关。插件行卸载时，浏览器半的 Slot 条目、locale 与样式会被注销；若停用时正处于视频模式，宿主 `retainMainPanels` 会在 `main` 条目消失后把中央面板恢复为 Conversation（该机制需真机验证）。
- **重新启用**：再次打开开关即可，无需重建。
- **回滚/卸载**：Plugins 页面移除该 bundle；浏览器偏好可另行删除 `localStorage` 中的 `dsh-video.ui.v1`。
- **数据影响**：P0-B 不写 profile、不写工程/媒体、不写 session 事件；卸载不会影响会话与草稿。

### 本地检查（零构建）

```sh
node --check index.js
node --check client.js
node scripts/check.mjs          # manifest / patch / exports / files / locale / README 一致性
node scripts/smoke-client.mjs   # Client 模块、Slot 注册、导航、冲突、持久化与清理 smoke
# 或一次运行：
npm run check
```

`scripts/` 只用于本地检查，不在 `files` 安装清单内。

### 未验证（需安装后按 P0-002 验收清单执行）

真实宿主激活与 Slot 渲染、胶囊在会话头中的位置/尺寸与窗口拖拽带交互、视频面板布局与明暗主题、窄窗口与缩小动效、切换后草稿/滚动真机表现、停用/重新启用清理、与其他插件共存。
