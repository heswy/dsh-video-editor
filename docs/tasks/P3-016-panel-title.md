# P3-016（A）面板布局、工程标题重命名、移除简化界面效果

日期：2026-10-20（Asia/Shanghai）。状态：**A1–A4 实现、自测、仓库门禁与真 Chrome 组件验证完成；已提交并 push 到分支，未开 PR / 未合并 / 未安装候选；真实 DSH 真机与本任务 B（预览、图片点击、导出）不在本记录范围。**

- 分支：`codex/p3-016-panel-title`（base `origin/main` `ec9ad47`），隔离 worktree `dsh-video-editor-worktrees/p3-016-panel-title`
- 实现提交：`7a739f6`（A1–A4 代码/测试/README；本文件为随后的 docs 提交）
- 未 bump `package.json`：候选版本与安装由 Lead 合并后统一处理；因此本分支上 `scripts/test-stage-version.mjs` 的 alpha.7 版本断言与 base 一样是**继承失败**（见“验证”）
- 未派生其它 Agent、未改其它 worktree / 主工作树 / 已安装插件 / 用户作品 / `~/.dsh`；临时文件与测试 fixture 均在 worktree 的忽略目录或 `/tmp`

## 范围与实现

### A1 右侧 AI 栏可拖拽加宽（`client.js`）

- 新增 `.dv-splitter`（`role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max`、可 Tab 聚焦）位于左预览与右栏之间；指针拖拽用 pointer capture，不安装 document/window 监听。
- 宽度不再固定 `clamp(340px, 34%, 440px)`：由 `.dv-main` 上内联 CSS 变量 `--dv-ai-width` 驱动 `width: var(--dv-ai-width, clamp(320px, 42%, min(720px, calc(100% - 360px))))`；默认 42%，AI 最小 320px、最大 720px，左侧保底 360px。窄容器（`@container dsh-video (max-width: 700px)`）仍上下堆叠且隐藏分隔条。
- 双击分隔条恢复默认；`ArrowLeft/ArrowRight` 每步 2%，`Home` 恢复默认；比例写入版本化 `localStorage` 键 `dsh-video.layout.v1`（`{version:1,aiPaneRatio}`），读取失败/损坏/未知版本/错误形状安全回退默认值，写入失败留在内存并报告一次。
- 纯函数 `normalizeAiPaneRatio / aiPaneWidthCss / stepAiPaneRatio / clampAiPaneWidth` 放在独立 `//#region layout splitter helpers`，smoke 与 Node VM 直接执行 shipped 源码测试。
- 未尝试改宿主 Composer 内部 DOM。

### A2 工程标题与 UI-only `project.rename`

- worker `project.json` 新增**可选** `title`：读取时要求规范 trim 后 1..120 字符（旧工程无此键 → `null`）；revision 仍只由 entry + 声明资产内容哈希计算，标题不进 revision/history。
- `project.rename {projectId,title}`（worker + Host）：
  - worker 校验参数、要求工程已 open（`E_PROJECT_NOT_OPEN` / `E_PROJECT_CLOSING`），按工程写队列原子重写 `project.json`（保留 `entry`/`assets`，`index.html` 不触碰），标题相同返回 `changed:false` 不写盘；结果 `{projectId,revision,title,changed}`，revision 与重命名前一致。
  - `asset.import` 重写 manifest 时保留已有 `title`（避免上传动作撤销重命名）。
  - `inspect`/`open` 返回可空 `title`；`project.create.title`（若提供）同时作为初始显示标题。
  - Host 新增 allowlist/params 校验：trim 后 1..120、拒绝 NUL/空/超长；**Tool source 返回 `E_METHOD`**；worker 结果经 shape/revision 校验（`E_WORKER_RESPONSE`）；`project.list` 每项新增可空 `title`（有界读取 `project.json`，损坏/超大/非规范值 → `null`，不影响列表与 updatedAt 回退）。
- 客户端顶栏左对齐为 **返回 → 可点击作品名 → 工程下拉箭头**：
  - 点作品名进入内联重命名输入（自动聚焦/全选；Enter 保存、Esc 取消、空白标题本地拒绝且不发请求；失败就地 `role="alert"` 提示并保留草稿；保存成功后作品名、选择器与面板记忆同步更新）。
  - 箭头单独打开工程选择菜单（`menuitemradio` 当前项 + 新建工程 `menuitem`），打开时焦点进入当前项，Escape/Tab 关闭并回焦箭头；点击名字不会误切换工程。
  - 旧工程无 `title` 时保留 `studioProjectTitle` 的内容推导回退（Scene 标题 / 首个文本元素 / 未命名作品）。
- 改名只发 `project.rename`：不触发 `inspect` 采样替换、不触发 `project.compose`/`edit`、不改变预览 revision。

### A3 移除插件显示设置

- 删除顶栏 gear 菜单、“简化界面效果”开关、`video.display.*` 文案、`simplifiedEffects` 状态、`dsh-video.ui.v1` pref/localStorage 读写与全部 `data-simplified` 依赖（含 loader 动画门控与玻璃降级门控）。
- 保留系统自适配：`@media (prefers-reduced-motion: reduce)` 关闭面板/loader 动画，`@media (prefers-reduced-transparency: reduce)` 关闭预览控制条模糊；`@supports (backdrop-filter: blur(16px))` 玻璃效果仍在。
- 顶栏右侧留空（可供 B 的导出按钮使用，本任务不实现导出）。

### A4 测试与文档

- `scripts/check-host.mjs`：新增 P3-016 rename 契约（UI-only、trim 归一、参数/allowlist 前置拒绝且不启动 worker、结果 shape 校验），并更新 `project.list` 形状/旧工程 null/损坏 manifest 容忍断言；UI-only 方法拒绝列表加入 rename。
- `scripts/smoke-client.mjs`：新增分隔条拖拽/持久化/双击/键盘/上限、纯 helper、偏好恢复与损坏回退、存储异常、工程菜单焦点/关闭、顶栏重命名成功/失败/空白/无写入路径；移除旧显示菜单与旧偏好用例；工程切换改用新菜单。
- worker：`test/project-rename.test.mjs`（真实 worker 进程）覆盖 trim/原子写/entry+assets 保留/无 revision/history 变化/幂等/非法标题/未 open 错误码/重启持久/asset.import 保留标题；`schema.test.mjs` 覆盖新方法双向 schema 与真实调用；`scene-template.test.mjs` 方法计数 24→25。
- `scripts/check.mjs`：把已删除显示设置的 P0-005/R1 断言替换为 P3-016 静态门禁（移除项、分隔条、重命名、Host UI-only/title、系统 reduced-motion/transparency 保留）；版本断言不变（未 bump）。
- `scripts/test-ui-polish.mjs`（真 Chrome 组件证据脚本）：顶栏新结构、拖动/持久化/720px 上限/双击/键盘、内联重命名、移除显示菜单；`scripts/lib/react-dom-lite.mjs` 增加标准 React 行为一致的 CSS 自定义属性支持（`setProperty/removeProperty`），否则标题栏/分隔条变量在该 harness 中无法生效。
- 文档：worker README 新增 `project.rename`/`inspect.title` 说明（schema 测试要求 README 提到每个方法）、根 README 更新 Host 方法表、`project.list` 形状与 P3-016 UI 说明；本任务文件与 handoff 入口。

## 改动文件（实现提交 `7a739f6`）

`client.js`、`host/bridge.js`、`packages/video-engine-worker/src/{projects,worker,registry}.mjs`、`packages/video-engine-worker/protocol.schema.json`、`packages/video-engine-worker/README.md`、`packages/video-engine-worker/test/{project-rename.test.mjs(新增),schema.test.mjs,scene-template.test.mjs}`、`scripts/{check-host,smoke-client,check,test-ui-polish}.mjs`、`scripts/lib/react-dom-lite.mjs`、`README.md`。

## 验证

### 仓库门禁（本 worktree，`7a739f6`）

| 门禁 | base `ec9ad47` | 当前 |
|---|---|---|
| `node scripts/check.mjs` | 52/52 | **54/54** |
| `node scripts/smoke-client.mjs` | 78/78 | **77/77**（删 9 个旧显示/偏好用例，新增 8 个 P3-016 用例） |
| `node scripts/check-host.mjs` | 65/65 | **66/66** |
| worker `npm test`（`node --test --test-concurrency=1 test/*.test.mjs`） | 54/54 | **56/56** |
| worker `node --test test/frame-times.test.mjs` | 8/8 | **8/8** |
| `node scripts/test-stage-version.mjs` | 7/10 | **7/10**（见下，继承失败） |

- worker 套件需按锁文件安装 `packages/video-engine-worker` 依赖（`npm ci --ignore-scripts --no-audit --no-fund`，122 包，未启用 postinstall、不改锁文件）；`node_modules/` 与 `artifacts/` 均被忽略，未入库。
- `scripts/test-stage-version.mjs` 的 3 个失败是 **base `ec9ad47` 已有问题**：脚本仍断言 `REVIEWED_BUNDLE_VERSION = 0.3.0-alpha.7`，而 main 的 `package.json` 已是 `0.3.0-alpha.8`；本分支未改这两处，也未 bump 版本，故原样继承。属 Lead 合并/候选版本统一处理项。
- **真 Chrome 组件 harness**：`node scripts/test-ui-polish.mjs` → **23/23**（真实 client 组件 + CSS + fixed runtime 在 headless Chrome；新增顶栏顺序/左侧对齐、无显示设置入口、分隔条拖动/持久化/720px 上限/双击恢复/方向键/Home、内联重命名 Enter 保存等检查；`prefers-reduced-motion` 关闭 loader 动画仍通过）。截图证据在忽略目录 `artifacts/ui-polish/`（未入库）。该 harness 使用固定路径的本机 Chrome，headless 运行，不使用用户 profile/前台窗口。

### 未运行 / 不声称

- 未做真实 DSH 真机（插件安装/启用/原生 Composer/真实模型请求）：本任务只到“仓库门禁 + 真实组件浏览器”，且用户安装/重启/模型调用需当次授权；候选 staging 也未构建（需 Lead 统一 bump/打包）。
- 未跑 `scripts/test-host-engine.mjs` / `test-conversation-chain.mjs` 等真引擎 staging 链：worktree 内没有固定 staging（`INTEGRITY.json`），本任务不构建/不安装 staging。
- 未验证宿主真机字体缩放/极窄窗口下 320–720px 的实际手感与 Composer 模型名完整显示；真 Chrome 组件页只验证结构与边界，未替身 DSH 原生 Composer。
- 未验证重命名与并发 AI 发布交错（worker 单工程队列保证 manifest 串行；Host worker 结果只做 shape 校验），极端竞态未做真实并发压力。

## 风险与待 Lead 决策

1. **版本/发布**：本分支未 bump `package.json`，`scripts/test-stage-version.mjs` 的 alpha.7 断言在 main 已过期（base 即失败）。合并后是否需要 P3-016 候选（如 alpha.9）并同步该回归脚本，由 Lead 决定。
2. **A1 数值与设计文档**：`docs/design/FRONTEND-DESIGN.md` 仍写“宽屏 AI 默认 360–400px”，与任务要求的 42%/720px 已不一致；本次按任务卡实现，未改设计文档，建议 Lead 合并时统一更新或确认。
3. **`check.mjs` / `test-ui-polish.mjs` / `react-dom-lite.mjs` 改动**：A3 删除显示设置后旧静态门禁必然失败，因此一并更新；`react-dom-lite` 的自定义属性支持是该 harness 渲染新布局变量的必要修复（与 React DOM 行为一致）。这些文件不在任务原 write scope 列表内，特此标注。
4. **worker 依赖安装**：为跑真实 worker 测试在 worktree 的 `packages/video-engine-worker/` 按锁文件安装了依赖（仅忽略目录）；若 Lead 的验证环境不允许安装，可只跑 `frame-times` 与 `check-host`（Host 用 fake worker）。

## 下一步

1. Lead 评审 A1–A4 实现与测试证据，决定候选版本与是否需要构建 staging；
2. 与本任务 B（左侧预览/图片点击/导出按钮）合并时检查顶栏右侧留位、右栏宽度与新 rename 不冲突；
3. 合并后按授权做真实 DSH 真机验收（拖拽手感、模型名完整显示、改名持久/失败提示、AI 发布不覆盖标题），再统一 bump 版本与更新 `STATUS.md`。
