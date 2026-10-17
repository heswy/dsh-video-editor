# P0-002：原生顶部切换与视频空工作区

状态：已放行实现，待 DSH 开始；未授权本轮安装/启用。
执行：用户指定的 DSH Agent；评审：Codex 主会话。
继续使用 `dsh/p0-mode-shell` 与已有 worktree，不另建分支。
base：Codex 同步本指南及设计文档后的 worktree HEAD；DSH 开工填写精确 SHA。

依次读 AGENTS、STATUS、DEVELOPMENT、PRODUCT、design/FRONTEND-DESIGN，再读本任务；以本任务明确范围为准。P0-001 与其调查是证据，不再把旧“未授权实现”当作当前任务状态。

## 本轮交付

1. 仓库根目录作为单一可安装 bundle；给出唯一包名和插件行 id，使用 `main` key `dsh-video`。若与 live 已有条目冲突，明确报错/拒绝挂载，不影子替换。
2. 普通模式入口挂 `conversation.header.leading`；视频视图自有顶栏渲染同一模式组件。使用 `ctx.layout.selectPanel('dsh-video' | null)`，选中态取宿主 activePanel，不另维护分叉的模式布尔值。
3. 首版靠左，用户已确认；在两处尽量保持控件位置、大小与节奏。不用 overlay，不替换宿主 header，不读宿主 DOM 几何，不增加侧栏入口。
4. 视频页为精致且诚实的空工作区：标题、简短无工程说明、可工作的返回普通入口与“简化界面效果”开关。不显示假预览、假工程、假轨道、假 AI 进度或不可工作的创建/导出按钮。
5. 落实设计的玻璃胶囊、主题、细致 spacing 与可中断的轻量过渡；不实现完整多栏编辑器，重型折射/光效不在本轮。
6. 模块/插件级 store 保留跨面板已有 UI 状态；浏览器持久化仅保存“简化界面效果”等真实 UI 偏好，版本化、损坏安全、异常不崩溃。不保存工程、草稿、媒体、activePanel 或新造的选择/时间线数据。
7. 遵循已验证 Client loader 格式，使用宿主 React；不运行时导入 ui-primitives 等内部 UI 包。Host 暂可为空 apply，不引入 HyperFrames、ffmpeg、Tool 或业务 HTTP 路由。
8. manifest、locale 中英文、图标、README、清理机制和可打包文件齐全。默认优先零构建或简单可复现构建，不安装未必要的依赖。

## 状态保留与生命周期

- 不改变当前 Session、模型、权限、preset，不写 session 事件。
- 未发送草稿包含文字、换行、引用 chip、待发送图片/文件；单纯文本保存并不等于保留完整输入。本轮不操纵宿主编辑器内部 DOM/state 来补偿。
- 使用精确 Slot 的 props/inject 导航回调，展示组件不接收整个 ctx。
- ordinary leading 被占用时给出可诊断的冲突，不改 priority 强行抢占。
- 注册顺序保证 main 已可用才允许导航；组件加载或注册失败保留普通模式，不留下死入口。
- 当前正处于视频模式时停用/卸载，应安全返回普通且移除所有条目；优先利用宿主已有 `retainMainPanels` 机制，先验证，必要时在本插件生命周期内加可证实的回退。
- 键盘选择、可见 focus、no-drag、reduced-motion、简化透明效果正常；动画不得阻塞操作或重播积压。

## 验证与安装边界

本轮允许实现、项目本地必要的构建/检查、语法/manifest/可安装包检查和本地提交；禁止修改 profile、安装/启用插件、全局依赖安装、改宿主、push/PR/merge。先交付具体包与路径，用户确认后再进入宿主安装验证。不得因尚无安装授权把以下真机项伪称通过。

### 安装前检查

- manifest/exports/patch/Client module id 一致，文件实际包含在交付包中，`node --check` 与所选构建检查通过。
- 如果写有持久化逻辑，覆盖损坏数据、旧版本、读取/写入异常回退；无需为静态装饰写镜像测试。
- 按实际使用补充最小可脱敏 API 摘录及源文件位置，版本固定 0.2.0-rc.2。
- 更新 README 安装/停用/回滚步骤与支持范围，不提供修改 profile 的替代捷径。

### 安装后验收清单（另行授权后执行）

| 场景 | 应观察到的结果 |
|---|---|
| 无 Session、blank Session、已有 Session | 两段入口可用，不侵入窗口拖拽/关闭区域 |
| 普通→视频→普通，多次快速操作 | 最后一次选择生效，当前 Session 不变，不出现空白/孤立面板 |
| 普通输入：多行、中文、引用、图片、文件 | 返回后内容/引用语义和待发送附件保留；若不保留，P0-B 不验收，不静默删草稿或自行 patch 宿主 |
| 上滚阅读后的会话 | 返回恢复合理语义位置，不强制滚底；不承诺 DOM 文字选择/IME 瞬时态 |
| 切换期间后台 Agent 运行 | Host 工作继续，回到普通能看到真实增量，无重复订阅 |
| light/dark、窄窗、字体放大 | 文本清晰、控件无溢出，图标/文案及焦点可见 |
| reduced-motion / 简化效果 / 无 backdrop-filter | 仍可读可用，播放/拖动无关机制不受 UI 动效影响 |
| 简化效果开关→模式往返→刷新 | UI 偏好恢复；刷新不强制导航到视频；损坏存储不崩溃 |
| 视频中停用，普通中停用，重新启用 | 返回/保留普通；无残留样式、Slot、监听器或路由，重新启用无冲突 |

无真实页面控制时报告限制，不生成 mock 图验收。真实页面证据需脱敏；不要读取用户私有会话内容以构造测试，使用另行授权的测试会话/素材。

## 交付记录（DSH 填写）

- base / result commit：base `06dba3716c28b28c4183ea26769cdf218657568a`（Codex 同步 P0-002 与设计文档后的 worktree HEAD）；实现提交 `52a1d1c`（`feat: add native mode shell and empty video workspace bundle`，11 文件）；首轮评审修复提交 `8ebf922`（见下节）。本交付记录及其后的修复记录进入 `dsh/p0-mode-shell`。
- 包名、插件行 id、绝对目录、构建/打包方式：包名 `dsh-video`；Loader 行 id `dsh-video`；Client 模块 id `dsh-video`；`main` key `dsh-video`；普通模式入口 `conversation.header.leading`。目录＝本 worktree 根目录 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`。**零构建**：`client.js` 是手写浏览器产物（`window.__ModuleLoader__.load`，仅 require 宿主 React），`index.js` 为空 Host half；无依赖、无锁文件。`npm pack --dry-run --offline` 列出 9 个文件（`package.json`、`index.js`、`client.js`、`cordis.patch.yml`、`icon.svg`、`locale/en.json`、`locale/zh.json`、`README.md`，npm 自动附 `LICENSE`），`files` 白名单只含交付文件，`scripts/` 不打包。
- 改动文件：新增 `package.json`、`cordis.patch.yml`、`index.js`、`client.js`、`icon.svg`、`locale/{en,zh}.json`、`scripts/check.mjs`、`scripts/smoke-client.mjs`、`docs/research/P0-002-runtime-api-excerpts.md`；更新根 `README.md`（安装/停用/回滚/范围/本地检查）。
- 实现要点：同一玻璃胶囊组件挂两处（普通模式 `conversation.header.leading`；视频模式自有顶栏），选中态只读宿主 `usePanelInfo.activePanelId`，切换统一走 `ctx.layout.selectPanel('dsh-video' | null)`。空工作区只包含标题、无工程说明、可工作的返回普通入口与「简化界面效果」开关，不含创建/预览/时间线/AI/导出假控件。跨面板 UI 状态用插件级内存 store；只有 `dsh-video.ui.v1` 偏好（版本化、损坏/旧版本/读写异常回退）写浏览器存储，不存工程/媒体/草稿/activePanel。主面板先注册并校验成功后才挂普通入口；`main` key 或 `conversation.header.leading` 已被占用、或无法枚举占用者时拒绝挂载并输出诊断（不降 priority、不影子替换）。停用/卸载依赖宿主 `retainMainPanels`，并加了一个仅在宿主仍报告 `dsh-video` 时 `selectPanel(null)` 的卸载兜底。全部注册经 `ctx.slots.inject`/`ctx.effect` 拥有，disposer 可完整移除；主题只用 inspection 到的 `--dsw-alias-*` token，`data-window-drag` 交给宿主基础 CSS，控件 no-drag。
- 实际检查与结果（本地，未安装）：
  - `node --check index.js`、`node --check client.js`、`node --check scripts/*.mjs`：通过。
  - `node scripts/check.mjs`（manifest/exports/patch/Client id/打包文件/locale/README/双语 key/class 与 CSS 一致性/内联 CSS 括号与 token）：17 passed, 0 failed。
  - `node scripts/smoke-client.mjs`（VM + 最小假 Slot 运行时：模块注册、两处 Slot 注册、导航与错误收容、activePanel 派生、空工作区无假控件、偏好版本化/损坏/旧版本/读写异常、leading/main 占用冲突、未声明 main、late leading 失败后移除 main、枚举不可用拒绝挂载、disposer 完整清理与卸载回普通）：15 passed, 0 failed。
  - `npm run check`（上述两项合并）：通过。
  - `npm pack --dry-run --json --offline`：9 files / 45605 B unpacked（清单见上）。
  - `ruby -ryaml -e 'YAML.load_file("cordis.patch.yml")'`：解析为 `[{insert: [{id: "dsh-video", name: "dsh-video", config: {}}]}]`。
  - `git diff --check`：通过。
- 安装状态：**未安装、未启用、未修改 profile、未 push**。本轮未获安装授权，以上结果不代表宿主激活或真机验收。
- 未验证 / 风险 / 安装后动作：
  - 未验证：真实 Host 激活与 Client 半加载、胶囊在会话头行中的真实位置/高度与窗口拖拽带、侧栏折叠时 `--dsh-frame-leading-clearance` 避让、`selectPanel` 在插件上下文的真实调用、普通/blank/无 Session 三态入口、切换后草稿与引用/附件保留（宿主机制，仅按源码推断，未操纵宿主编辑器）、上滚阅读位置恢复、明暗主题/窄窗口/字体放大、停用与重新启用清理、与其他插件共存、无 backdrop-filter 环境。
  - 已知限制：顶层槽位无「主列居中」；首版按用户确认靠左。视频主面板无 Session binding，视频状态为插件自持（P0-B 无工程内容）。普通模式文本选区/IME/光标瞬时态不承诺保留。
  - 安装验证所需动作（需用户明确授权）：Plugins → Add plugin 填本 worktree 绝对路径 → Install → Enable now；随后按本指南「安装后验收清单」逐项执行并记录真机截图/错误；验证停用/重新启用与回滚。
- 最小 API 摘录：见 [P0-002 运行时 API 摘录](../research/P0-002-runtime-api-excerpts.md)（版本固定 0.2.0-rc.2，含 Slot/layout/locale/loader/theme token/拖拽规则与源文件位置）。

## 评审修复记录（R1–R3，2026-10-17）

首轮评审报告：`docs/reviews/P0-002-review-01.md`（评审提交 `43f8c19`，未改动报告原文）。修复提交：`8ebf922`（`fix: address P0-002 review R1-R3 (entry lifecycle, capsule motion, font scaling)`）。以下逐项回应。

### R1 [P2] main 尚未就绪时仍暴露模式入口 —— 已修复

- 改法：把两处挂载点的注册链绑定到 `main` 面板的真实声明生命周期。注册入口 `registerMainAndEntry` 在每次 `main`（重新）声明时先重查 live `main` key 占用，再注册视频面板；成功后才 `inject` `conversation.header.leading` 并注册胶囊；任一环节失败或清理时整条链撤回，`main` 折叠后胶囊一同消失，重新声明自动恢复并重新检查冲突。胶囊注册失败会撤回已注册的视频面板，避免「面板存在但无入口」或「入口存在但面板不存在」。测试桩不再把 `inject` 等待当错误。
- 验证（smoke，24 例中 5 例针对 R1）：main 未声明→0 注册、声明后两处出现；折叠 main 撤回胶囊、重声明恢复；重声明遇到 key 冲突撤回并报 `main-key-conflict`；声明时 main 注册失败→0 入口；胶囊注册失败→撤回 main 并报 `leading-entry-unavailable`。
- 未验证：真实 SlotRegistry 在宿主内的声明重建节奏与 UI 表现（安装后）。

### R2 [P2] 220ms 胶囊滑动在实际切换中没有起点 —— 已修复

- 改法：导航前向插件级 store 写入一次性呈现提示 `thumbOrigin`（离开的段，不延迟导航）；新挂载点首帧以该段为 `data-thumb` 起点、`data-ready=false` 禁用 transition，两帧后切到宿主 `activePanel` 对应位置并启用 220ms 过渡滑入。提示只被一个挂载点消费并立即清除；导航失败清除；快速反向只保留最新提示；首次加载无提示直接到正确位置。简化效果或宿主 `prefers-reduced-motion` 时不记录提示、直接到位。选中态仍唯一来自宿主 `activePanel`，不新增模式布尔值。repeat 入场与按钮过渡改用 motion token，简化/减少动效下不再硬编码 140ms。
- 验证（smoke 6 例 + check 静态约束）：首次挂载无错误起点；导航立即生效且新挂载起点为离开段、aria 选中立即正确；提示只消费一次；快速反向以最新离开段为起点；简化/reduced-motion 直跳；导航失败不留下陈旧提示。**本地只验证呈现起终态/中断逻辑，不验证浏览器 CSS 动画真实播放**；真实页面短录屏留在安装后清单。
- 未验证：真实动画观感、快速切换在真页面的表现、键盘切换后的焦点落点。

### R3 [P2] 模式控件文字没有跟随宿主字号 —— 已修复

- 改法：`.dv-mode` 自身 `font-size: var(--dsh-content-font-size, 14px)`（普通模式位于视频根之外也生效）；按钮文字 `0.93em`；胶囊宽高改为 `clamp(176px, 13.5em, 248px)` / `clamp(40px, 2.86em, 56px)` 随字号缩放并限幅；其余固定高度 chrome（视频顶栏、简化开关、返回按钮、状态栏）同样 clamp+em；窄容器只折叠品牌/简化文案/次要状态，不再缩小导航文字；按钮点击命中区仍 ≥44px，no-drag 保持。
- 验证：check 静态约束（字号来源、em、无固定 13px/12.5px、clamp 宽高）；smoke 回归通过。
- 未验证：真实宿主字号放大/窄窗口下的排版与命中区（安装后实测）。

### 非阻塞观察处理

- leading 单座冲突诊断：README 新增「诊断」小节，说明 `dsh-video:` 前缀日志、拒绝挂载原因，不通过 priority 抢占宿主座位。
- 简化效果 repeat 140ms 与按钮固定过渡：已在 R2 中改为 motion token。
- 键盘切换焦点落点：未改代码，列入安装后真机验证清单（README/本记录）。
- 草稿/引用/待发送附件/滚动/停用回退：本次仍只有宿主源码推断，未真机验证。

### 最新本地检查（未安装；替代上文首轮数字）

- `node --check index.js`、`node --check client.js`、`node --check scripts/*.mjs`：通过。
- `node scripts/check.mjs`：**20 passed, 0 failed**（新增 R1/R2/R3 静态约束）。
- `node scripts/smoke-client.mjs`：**24 passed, 0 failed**（等待型 inject 桩 + 5 个 R1 + 6 个 R2 用例）。
- `npm run check`：通过；`npm pack --dry-run --json --offline`：9 files；patch YAML 解析、`git diff --check` 通过。
- 安装状态：仍未安装、未启用、未改 profile、未 push。

## 评审记录（Codex）

待实现提交。只有完整真机验收通过后才能把 P0 标记完成。
