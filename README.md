# DSH Video

运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。目标是让 AI 创建可编辑的视频工程，用户直接修改后，AI 能继续编辑同一份工程并导出 MP4。

用户已确定入口：DSH 左侧导航「上下文洞察」之后、「工作区」之前的单入口 **Vedio Editor**（细线条视频图标）；视频模式进入插件工作区，普通模式保留 DSH 原有体验。这里的工作区视图切换，不是修改 Agent preset。早期顶部「普通｜视频」方案已被 D011 替代，仅保留历史证据。

当前阶段：P0 侧栏入口与极简空状态已在真机验收；P1 引擎、P2 通信包与启动打包已受控验收；P2-004 复审通过并已在本机 **安装 `dsh-video 0.2.0`**（link clean staging，root `fa7b0e2` + engine `54f4671`），真机验收进行中（入口/真实工程/画面与 Tool doctor/open/frame 已通过，编辑/导出/生命周期待验）。协调分支只含文档，实现位于 `dsh/p0-mode-shell`、`codex/p1-engine-spike-b4bf` 分支及草稿 PR #2/#3。开发基线为本机 DSH Desktop **0.2.1-rc.1**。

- [当前状态与下一步](docs/STATUS.md)
- [开发与协作规则](docs/DEVELOPMENT.md)
- [产品范围](docs/product/PRODUCT.md)
- [前端设计规划](docs/design/FRONTEND-DESIGN.md)
- [决策记录](docs/DECISIONS.md)
- [阶段路线](docs/ROADMAP.md)
- [当前任务 P2-004：P2-002-B 复审修复](docs/tasks/P2-004-host-bridge-fixes.md)
- [首任务交接（历史）](docs/handoffs/DSH-START.md)
- [原始调研](docs/research/2026-10-17-video-workflows-and-dsh-plugins.md)

仓库中的原始方案、开发包及截图用于追溯，采纳范围以产品文档、决策和当前任务为准。
