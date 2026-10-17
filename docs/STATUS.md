# 当前项目状态

更新：2026-10-17。此文件由总调度维护（2026-10-17 由 DSH 继任会话接手；原 Codex 主会话）。

## 当前事实

- **核心目标（2026-10-17 用户重申）：AI 生成视频。** 判断进度以「用户用一句话让 AI 在 DSH 里建出可编辑的视频工程」为准；宿主接入、预览、播放都只是支撑能力，不得挤占 P3 主线。当前 AI 创作闭环仍是 0 起点，P3-001（引擎多 Scene/修订 spike）走在最前。

- 仓库：`heswy/dsh-video-editor`。协调分支维护文档与证据；DSH 分支已有未验收的 P0 bundle 和本地检查，不能把协调分支的无代码状态当成全项目无实现。
- 2026-10-17 总调度继任：原 Codex 主会话将产品/架构/协调/评审职责交给当前 DSH 会话；用户确认两个程序员会话仍在、交接由用户粘贴转发。既有分支、worktree、草稿 PR、任务与评审记录延续，不重置、不重开。
- `main` 起点：`9c826bd`；协调分支 `codex/project-foundation` 已推送并建草稿 PR #1，main 未合并。
- 用户最新确认改为左侧「上下文洞察」下、「工作区」上单入口 **Vedio Editor** + 细线条图标，替代顶部胶囊；UI 简洁克制。产品见 `product/PRODUCT.md`。
- 已归档计划、截图与 DSH 开发包。上一轮已确认 kit 的 16 个 skill 文件与本机 app.asar 相同；README/AGENT-BRIEF 是整理材料。
- 当前实际 Host 为 Desktop 0.2.1-rc.1（用户侧升级）；P0-006 已重新核对侧栏，P2-002-A 核实 Host API。0.2.0-rc.2 证据保留为历史，首轮 master 建议不直接沿用。
- **2026-10-17 已安装 `dsh-video 0.2.1`**：用户卸载 0.2.0 后以 Plugin Manager link 指向 `staging-54f4671-bdcfd72/bundle`（root `bdcfd72` + engine `54f4671`）。深色主按钮修复与「画面时间（秒）」预览已真机可见；插件内播放按钮仍不存在，待用户定优先级。0.1.3 回滚目录与固定包保留。见 [真机验收记录](research/P2-004-live-acceptance.md)。

## 远端与草稿 PR

2026-10-17 已首次推送三个已提交分支并建立草稿 PR（均以 main 为目标）：

- 协调文档：codex/project-foundation → [PR #1](https://github.com/heswy/dsh-video-editor/pull/1)。
- 程序员 1：codex/p1-engine-spike-b4bf → [PR #2](https://github.com/heswy/dsh-video-editor/pull/2)，引擎交付至 54f4671。
- 程序员 2：dsh/p0-mode-shell → [PR #3](https://github.com/heswy/dsh-video-editor/pull/3)，PR 跟随其持续提交；后续 Host 接入提交由程序员 2 更新并另交评审，本轮不据远端前移推断其已通过。

后续继续推送原分支，更新原 PR，不重复开同一开发线 PR。尚未合并 main 或发布；因此仓库默认 main 页面暂仍是初始内容，完整进展在分支与 PR 中。并行分支包含共享基础文档，未来集成由主会话统一处理文档差异，不在开发者有未提交工作时擅自 rebase/覆盖。

程序员 2 读取 P2-003-review-01 可固定引用 54f4671 的引擎包；复打包的新摘要与不可变目录见该评审。旧任务“不 push”限制被本轮用户明确授权覆盖，其它安装/重启边界不变。

## 当前人员称呼

- 程序员 1：`dsh-video-editor` 工作区，新 DeepSeek 接手 b4bf 引擎/通信代码；旧 Codex 会话不再同时写入。
- 程序员 2：`p0-mode-shell` 工作区，原 DeepSeek 负责插件 UI/Host。
- 总调度/主会话：架构、计划、协调、评审与验收；2026-10-17 由 DSH 继任会话接手，维护协调分支与 PR #1；目录/分支与管理规则见 DEVELOPMENT。

## 活动任务

| 任务 | 执行者 | 分支/worktree | 状态 |
|---|---|---|---|
| 项目准备与长期记忆 | Codex | codex/project-foundation；主工作区 | 已完成，本地提交交接；归档完整性及链接检查通过 |
| [P0-001](tasks/P0-001-mode-shell.md) | DSH 调查 / Codex 评审 | dsh/p0-mode-shell；同级 dsh-video-editor-worktrees/p0-mode-shell | a85308a / dcc0ae4 已审阅，调查验收通过；未做插件 live 验证 |
| [P0-002](tasks/P0-002-mode-shell-implementation.md) | DSH 实现 / Codex 评审 | 继续 dsh/p0-mode-shell 与原 worktree | 8ebf922 / a31ee51 主要修复复审通过；本地检查 44/44，固定包已产生；未安装 |
| [P0-003](tasks/P0-003-install-validation.md) | 原 DSH 会话 | 原 P0 worktree | 0104e0e 真页面核心证据已审阅；已安装启用；P0 部分通过，引用/滚动等未完 |
| [P0-004](tasks/P0-004-lifecycle-and-acceptance.md) | 原 DSH 会话 | 原 P0 worktree | ab4bc68 / 6f11ced 已复审；本地 50/50 与 0.1.1 包核对通过；新包未安装，补验使用 0.1.0 |
| [P0-005](tasks/P0-005-sidebar-entry-and-restraint.md) | 原 DSH 会话 | 原 P0 worktree | 51c82a9/f5eed41 复审通过；独立 57/57 与包核对通过；0.1.3 已安装启用 |
| [前端设计规划](design/FRONTEND-DESIGN.md) | Codex | codex/project-foundation；主工作区 | v0.2 核心 live 证据通过：侧栏入口、单句空状态；编辑界面待接入 |
| [P1-001 引擎验证](tasks/P1-001-engine-spike.md) | Codex 引擎开发 / 主会话验收 | codex/p1-engine-spike-b4bf；~/.codex/worktrees/b4bf/dsh-video-editor | c779b94 / e88615f 单场景可行性通过，主会话独立复测 3+2 测试、哈希与 ffprobe |
| [P1-002 worker](tasks/P1-002-engine-worker.md) | 原 Codex 引擎会话 | 自行管理原 worktree/分支 | 3b5f6de R1 复审通过；本轮独立 7+1 测试通过，受控 worker 验收完成 |
| [P2-001 通信包](tasks/P2-001-engine-client.md) | 程序员 1 | 自行管理 b4bf worktree/原分支 | 5b9032b 最终收口通过；独立 Node22/24 均10/10 |
| [P0-006 真机验证](tasks/P0-006-sidebar-live-validation.md) | 原 DSH 会话 | 原 P0 worktree | 98e2571 记录/截图已审；0.2.1 上安装与核心入口/空页/启停通过，面板内交互等未测 |
| [P2-002-A Host 契约](tasks/P2-002-host-bridge.md) | 程序员 2 | 原 P0 worktree | afcf57d 调查验收通过；ADR-0002 决策收敛 |
| [P2-003 启动/包入口](tasks/P2-003-engine-launch-packaging.md) | 程序员 1 | 原 b4bf worktree/分支 | 54f4671 已复审通过；Node22/24 各15通过+1跳过，Desktop24.21真实链通过；固定包见评审新摘要 |
| [P2-002-B Host 接入](tasks/P2-002B-host-integration.md) | 程序员 2 | 原 P0 worktree | e595d4e 首审：83/83 与根包匹配；R1对象绑定/R2Tool截断/R3快照验证/R4版本门禁待修 |
| [P2-004 R1–R4 修复](tasks/P2-004-host-bridge-fixes.md) | 程序员 2 | 原 P0 worktree/分支 | 已复审通过并安装 0.2.0（link clean staging）；真机验收中：UI 真实工程/画面、Tool doctor/open/frame/status 通过；编辑/导出/生命周期待验 |
| [P2-005 预览时间点+播放 spike](tasks/P2-005-preview-time-and-player-spike.md) | 程序员 2 | 原 P0 worktree/分支 | R1 补丁复审通过；**0.2.1 已真机安装**：深色主按钮可读、画面时间输入可见；播放实现按已定优先级后置 |
| [P2-006 取消/时序 UX 修复](tasks/P2-006-cancel-and-timing-ux-fixes.md) | 程序员 2 | 原 P0 worktree/分支 | 已下发：R2 取消不再误报「操作失败。」；R3 开始+时长越界本地校验与中文化；升 0.2.2，交付复审后重装 |
| [P3-001 多 Scene/修订 spike](tasks/P3-001-engine-multiscene-spike.md) | 程序员 1 | 原 b4bf worktree/分支 | 已复审通过：独立复跑 12/12、MP4/ffprobe/证据核对一致；契约冻结 D020–D022；见 [复审](reviews/P3-001-review-01.md) |
| [P3-003 多 Scene 引擎实现](tasks/P3-003-engine-multiscene-implementation.md) | 程序员 1 | 原 b4bf worktree/分支 | 复审通过（本机受控）：17/17、9/9、16+1 skip；两包 0.2.0 与 `9df968c` 字节一致；15s MP4/证据核对通过；附 R1 schema 待补 |
| [P3-004 协议 schema+预览快照](tasks/P3-004-engine-preview-snapshot.md) | 程序员 1 | 原 b4bf worktree/分支 | 已下发：补 P3 方法 schema（R1）+ `preview.snapshot/release`（画布后端）+ 两包 0.2.1；小任务 |

## 下一动作

并行线：程序员 1 做 P3-004（协议 schema + 预览快照）；程序员 2 的 P2-006 尚未开工/推送（分支仍 123353c）；总调度准备 P3-005 编辑器画布任务。播放/点选需求合并到实时预览画布。

1. 程序员 1 按 [P3-004](tasks/P3-004-engine-preview-snapshot.md) 补 schema、`preview.snapshot/release`、修 registry 失败清理，出 0.2.1 包与真实证据；Phase 完成后 push 更新 PR #2。
2. 程序员 2 仍待 P2-006 回交（0.2.2：取消不报错、时序中文提示）；之后按 P3-005 画布任务施工（依赖 P3-004 snapshot 契约）。
3. 总调度复审 P3-004 后下发 [P3-005 编辑器画布](tasks/P3-005-editor-canvas.md)（Host 精确资产路由 + sandbox iframe + 播放/seek + 画布点选/描边/目标联动）。
4. 画布通过后下发 P3-006（根插件创作流程/AI 上下文/冲突 UI），再接 P3-007 端到端 15 秒 AI 样例；P3-003 已完成。
5. 真机验收剩余项（浅色/hover/focus、编辑保存、生命周期）随 0.2.2 重装补验。
6. 总调度维护协调分支文档与 PR #1；保持 main 未合并；不自动 merge/发布。

## 阻塞与未验证

0.1.3 核心侧栏/主面板和启停证据通过。main 内容缺少定向 AX 通道，返回按钮、菜单焦点、主题/字号/窄窗、草稿/引用/附件、静态阅读位置、冷启动等仍未测，采用人工清单，不重复不安全自动化。0.2.0 已真机安装，入口/真实工程/画面与 Tool doctor/open/frame/status 通过；**UI 编辑保存、导出/取消、冲突错误、生命周期与主题窄窗仍未验证**；尚无多 Scene、AI 创作、用户素材、不可信代码隔离。P2 client 的显式 Node22/24 测试仅代表本机小版本和受控 fixture。

## 最近交接

2026-10-17 P3-003 复审通过：独立复跑 worker 17/17（11s）、real 9/9（155s，含 15s 渲染/取消）、client 16 pass + 1 opt-in skip（exit 0）；两包 0.2.0 与 `9df968c` 逐字节一致（client 3/3、worker 12/12）；`ai-project-15s.mp4` 264,650 B `87a3d418…`、ffprobe 450 帧/15.000s/1280×720/30fps、帧 `4728e847…`、4 Scene 工程快照与证据一致。契约差异（初始 1 Scene、fps=30、revise 冲突 written:false、asset 不进 undo）已冻结；**R1：protocol.schema.json 未含 P3 新方法**，必须在 P3-005 接线前补。已下发 [P3-004 引擎快照任务](tasks/P3-004-engine-preview-snapshot.md)（R1 + preview snapshot + registry 失败清理，两包升 0.2.1）；D024 记录画布 A1 架构与任务重编号。见 [P3-003 复审](reviews/P3-003-review-01.md)。

2026-10-17 P2-005 R1 补丁复审通过：`bdcfd72`/`123353c` 仅改主按钮 token 与静态断言；独立复跑 97/97；0.2.1 tarball 39,702 B、17/17 与提交字节一致；新 staging `staging-54f4671-bdcfd72`（INTEGRITY `b410ec2f…`、staged Host `07442c86…`）真实链通过、demo 干净。已核对宿主 app.asar 中 `button-primary-fill/hover/dimmed` 与 `label-primary-foreground` 真实存在、配对方向正确（深色 fill 实为 `#f9fafb`，报告笔误）。**0.2.1 可作安装候选**，待用户重装后做真实明暗/焦点/disabled 视觉复核。见 [R1 复审](reviews/P2-005-review-02.md)。

2026-10-17 0.2.1 真机安装：用户卸载 0.2.0，link 安装 `staging-54f4671-bdcfd72/bundle`（profile 已指向该目录、版本 0.2.1）。深色模式主按钮「更新画面」可读（截图确认），右侧「画面时间（秒）」输入出现（默认 2.50）。播放按钮仍不存在：0.2.1 只做单帧 + 导出；A1 完整预览需 engine snapshot + Host 路由 + Client iframe，成品 MP4 内嵌播放只需 Client 小改。**按用户确认维持 P3 优先，播放后置**。待补验：浅色/hover/focus/disabled、编辑保存/导出取消/生命周期。

2026-10-17 P2-005 R1 补丁复审通过：`bdcfd72`/`123353c` 仅改主按钮 token 与静态断言；独立复跑 97/97；0.2.1 tarball 39,702 B、17/17 与提交字节一致；新 staging `staging-54f4671-bdcfd72`（INTEGRITY `b410ec2f…`、staged Host `07442c86…`）真实链通过、demo 干净。已核对宿主 app.asar 中 `button-primary-fill/hover/dimmed` 与 `label-primary-foreground` 真实存在、配对方向正确（深色 fill 实为 `#f9fafb`，报告笔误）。**0.2.1 可作安装候选**，待用户重装后做真实明暗/焦点/disabled 视觉复核。见 [R1 复审](reviews/P2-005-review-02.md)。

2026-10-17 P3-001 复审通过：独立复跑单元测试 12/12；B/A 15s MP4 哈希逐文件核对（B 与 worker 渲染字节完全一致）、ffprobe 450 帧/15.000s/1280×720；q1/q5/q6/q7/q8 证据一致。冻结 D020–D022：单 HTML + Scene 区段 + master timeline、受控整文件重写、stableId 三方合并；revision 保持内容哈希 + 单调 historyCursor；worker 管理 projectsRoot + project.create。已下发 [P3-003 引擎实现](tasks/P3-003-engine-multiscene-implementation.md) 给程序员 1（Phase A 可先交审）。

2026-10-17 P2-005 复审：B（画面时间点预览）通过独立复核（96/96、0.2.1 包 17/17 与 `da8a22b` 字节一致、staging 真实链通过）；A spike 验收——A1（sandbox iframe + 快照 + 固定 runtime）断网播放/seek 实测可行，但需 engine snapshot/Host 路由/Client iframe 三段生产化，A2 不推荐、A3 仅 fallback；实现暂缓，P3 优先。**R1 深色按钮对比修复未包含在本轮**（`client.js` 仍用不存在的 `--dsw-alias-label-on-brand`），已退回补丁，补后重出 0.2.1 包/staging 再重装。见 [P2-005 复审](reviews/P2-005-review-01.md)。

2026-10-17 真机缺陷 V1：深色模式下主按钮「更新画面」白底白字看不清（功能正常）。已核源码根因——`.dv-button-primary` 引用宿主不存在的 `--dsw-alias-label-on-brand`（fallback #fff），深色主题 `--dsw-alias-brand-primary` 为近白色。已作为必修 R1 排入 [P2-005](tasks/P2-005-preview-time-and-player-spike.md)，随 0.2.1 交付、重装后复核浅色/深色与 hover/focus/disabled；其余真机验收项继续。

2026-10-17 播放需求排期：用户真机反馈「导出下载后可播放，但插件内没有播放器」。0.2.0 按范围只有固定 2.5s 单帧 + 导出；用户确认先做 B（画面时间点抽帧预览）并同时排 A（隔离预览面真播放 spike）。已发布 [P2-005](tasks/P2-005-preview-time-and-player-spike.md) 与交接，程序员 2 执行；已安装 0.2.0 与其 staging 不动，交付复审后再由用户重装 0.2.1。

2026-10-17 真机安装与首轮验收：用户授权后卸载 0.1.3，以 Plugins link 安装 `dsh-video 0.2.0`（clean staging，root `fa7b0e2` + engine `54f4671`，INTEGRITY `cc4490da…`，staged Host `07442c86…`）。真实 Host 内：侧栏 Vedio Editor 选中、真实工程/画面/元信息/target 显示；`video_engine` Tool 注入本会话，doctor/open/frame(2.5s)/status 全部通过，PNG `efca9296…`/275,744 B/1280×720/`survivors:[]`（与 P1 受控帧一致）。待验：UI 编辑保存/导出取消/冲突/生命周期/明暗窄窗/artifact 字节。见 [真机验收记录](research/P2-004-live-acceptance.md)。

2026-10-17 用户授权安装 0.2.0：先由程序员 2 重建干净 staging（复审真实链复跑把 demo 标题追加了测试后缀）并出新鲜证据；随后用户在 Plugins 页面安装启用，总调度做真机验收。0.1.3 回滚包保留，main 不合并。

2026-10-17 P2-004 复审通过：独立复跑 `npm run check` 92/92；tarball 17/17 文件与 `fa7b0e2` 字节一致、旧包未覆盖；staging INTEGRITY 与 staged Host 摘要核对一致；独立重跑真实链，执行 staging 内 Host，edit `hf-title`、revision 变化、PNG/MP4 独立 ffprobe 通过、cancel/close/dispose 正常。已装 0.1.3 未变。非阻塞观察 5 项已记录在 [review](reviews/P2-004-review-01.md)；下一步由用户授权安装并重建干净 staging，再做真机验收。

2026-10-17 P3 预研启动：按用户确认，P2-004 期间由程序员 1 在现有 b4bf 树做多 Scene/修订合并引擎 spike（P3-001），不新开树、不锁契约；总调度发布 [P3 创作闭环草案](research/P3-ai-creation-loop-plan.md)（引擎方法/Host 契约/合并语义草案）并下发交接。仍不安装、不 merge。

2026-10-17 总调度继任：原 Codex 主会话交接给当前 DSH 继任会话。已核对两个开发树（b4bf `54f4671`、p0-mode-shell `e595d4e`，均干净；p0 领先 origin 4 个提交）、三个草稿 PR、宿主 0.2.1-rc.1 与已装 0.1.3。本轮只改协调分支文档：记录继任、同步 README/PRODUCT 过期宿主版本、发布 P2-004 修复指南；不碰两个开发树、不安装。

2026-10-17 P2-002-B 首审：e595d4e 的83项检查独立通过，0.2.0根包16文件与commit匹配。额外复核发现标题/时间写不同对象、Tool渲染静默截断、真实链借工作树Host冒用staging归属、旧0.1.0错误通过env门禁，记录R1–R4交程序员2修复。54f4671引擎早已通过，不再作为待评审阻塞；修复后允许受控staging/引擎链，不安装。

2026-10-17 Git 工作流与 P2-003 验收：用户明确授权正常 feature push/草稿 PR，替代旧本地-only 限制。54f4671 已独立复测/验收；复打包源码匹配但摘要与原消息不同，独立固定到 artifacts/engine/54f4671，以 P2-003-review-01 为准。程序员2正在进行的根代码未提交，本轮不修改或纳入推送。三个已提交分支已远端保存，草稿 PR #1/#2/#3 已建立，均未合并。

2026-10-17 Host 契约验收与并行实施：afcf57d 调查通过；主会话独立核对 0.2.1 版本、asar 摘要与 bundled Node24.21。ADR-0002 选真实 Node 配置、显式净化环境、共用 Host dispatcher、fixture allowlist+job归属、真实字节产物与结构化 Tool；不加 Host 幂等缓存或附件。新增 P2-003 给程序员1、P2-002-B 给程序员2；两人本地实现，保持已安装 0.1.3。

2026-10-17 称呼与引擎收口：用户固定 dsh-video-editor 为程序员 1、p0-mode-shell 为程序员 2；程序员 1 已由 DeepSeek 接手 b4bf，职责/工作树边界写入 DEVELOPMENT。5b9032b 复审通过，Node22/24 独立完整包均10/10，R4-b 已关闭，P2-001 按受控范围验收。程序员 2 继续 P2-002-A。

2026-10-17 中断后继续联合验收：98e2571 的报告及真实去标识截图已核对，0.1.3 核心安装/侧栏/空页面/启停通过，实际 Host 0.2.1-rc.1；未测项保持。6c4b2e9 的 R4 生产错误处理有效，显式 Node24 全套10/10，Node22 的断管回归因未准入请求被强制断言 E_TRANSPORT 而失败，新增 R4-b 测试收敛要求。新增 P2-002-A 允许 DSH 并行只读调查 Host 接入。

2026-10-17 双线修复复审：DSH 51c82a9/f5eed41，57 项本地检查和 0.1.3 包独立核对通过，新增 P0-006 等待安装授权。客户端 51f562a 的 R1–R3 已关闭，9 项测试独立通过；补验输入管道关闭而 worker 存活时 write EPIPE 让隔离父进程异常退出，新增 R4 需修后接入。

2026-10-17 双线首审：P0-005 51/51 及 0.1.2 包源码核对通过，补菜单焦点 R1 后再交包。P2-001 6/6 通过，但独立复现中文跨字节块损坏、退出后 edit uncertain=false、dispose 完成后 timer 驻留三个缺陷；分别交原会话修复。两条工作树跟踪文件未被主会话改动。

2026-10-17 P1-002 R1 复审：3b5f6de 关闭门禁与排空修复通过，独立 7 项协议/内容及 1 项新增真实回归通过；原两组真实作业先前已独立通过，本轮未重复。受控 worker 验收完成，新增 P2-001 父进程通信包指南，继续和 DSH UI 并行。

2026-10-17 P1-002 首审：b59dbbb 的现有 7+2 测试独立通过，真实 MP4 摘要及元数据一致；额外复现 close 返回后并发新 render 仍 running 并 succeeded 发布。已记录 R1，要求原引擎会话修复工程关闭准入和排空边界，详见 reviews/P1-002-review-01.md；DSH P0-005 继续。

2026-10-17 P0-004 复审及用户设计变更：本地 50 项检查与 0.1.1 固定包独立核对通过；详见 reviews/P0-004-review-01.md。新增 P0-005 与设计 v0.2，替代两处顶部胶囊；0.1.1 归档，未替换当前 0.1.0。DEVELOPMENT 增加误投递事故后的定向测试规则。

2026-10-17 联合评审：已审 P0 0104e0e 真实材料及 P1 c779b94/e88615f；主会话独立运行 SDK/合成进程 3 测试、真实渲染 cancel/timeout 2 测试通过，ffprobe 和 8 组 PNG/hash 核对一致。P1 单 Scene 通过；P0 部分通过。新增 ADR-0001、P0-004、P1-002，继续两线并行，见 reviews/P0-P1-2026-10-17-joint-review.md。

2026-10-17 工作树管理范围：用户要求删除预建 p1-engine-spike tree，仅保留自动 b4bf 作为引擎开发工作树。移除前确认预建 tree 干净、无独有提交、无忽略文件。今后这里只管理 DSH tree，不操作其他 Codex 会话的 tree。

2026-10-17 工作区更正：用户新会话自动创建 b4bf worktree，核对与预建 tree 同为 831a64d、两者均干净。采用自动 tree，分支 codex/p1-engine-spike-b4bf；原预建 tree 随后已按用户要求移除，旧分支保留未用；主会话今后只管理 DSH worktree，其他 Codex 会话自行管理其工作树。不影响 DSH P0 tree。

2026-10-17 P0-B 修复复审：实读 8ebf922/a31ee51，复跑 44 项检查通过，已产出并校验固定 tarball（来源与 SHA 见 review-02）；可进入受控安装验证，用户尚未授权执行安装。P0 与 P1 文件边界无冲突，P1 继续独立推进。晚到 leading 注册失败场景仍列为边界补验项。

2026-10-17 并行分工：用户确认项目紧急，应并行。主会话准备 P1-001 worktree 和边界，建议用户新开 Codex 开发会话；DSH 修 P0，新会话验证 HyperFrames，主会话继续交叉评审与集成。P0 worktree 最新 HEAD 已变化，尚未在本轮复审，不以分支前移推断修复通过。

2026-10-17 P0-B 首轮评审：重跑 17 项静态检查、15 项 VM smoke 及 9 文件 pack dry-run，全部通过；合约隔离复现发现 main 等待声明时出现死入口；另发现两处独立挂载使胶囊滑动无起终态、导航字号固定。详见 reviews/P0-002-review-01.md。要求 DSH 修复，不接管实现，不安装。

2026-10-17 P0-A 评审：已整合调查提交，用户选择先用顶部靠左原生入口。D-A–D-D 已收敛并记录 D008–D010；已发出 P0-002 实现指南。只放行实现与本地检查，未放行安装/push。共享顶部 Slot 是 single，引用/附件状态与当前视频页停用回退纳入验收。

2026-10-17 设计补充：用户明确要求优美、精致、优雅，考虑液态玻璃与丰富动效。已写设计规格，包含材质、工作区布局、明暗主题与动效谱；DSH 工作期间未改其 worktree，P0-A 完成评审后统一同步。

2026-10-17：用户要求开始整理长期项目、建立分支，并与 DSH 协作；Codex 负责建立分支、DSH tree 与目录；用户仅打开工作区并发送提示。初始资料进入 Git，开发规则集中于 DEVELOPMENT，首任务分为调查和实现两个阶段。
