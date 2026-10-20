# 当前交接入口

更新：2026-10-20。用户先实机测试，再按具体问题建立修复分支。

- 最新代码、规则、项目记忆统一读origin/main；先读STATUS、DEVELOPMENT、PRODUCT。
- 当前没有已下发的新功能任务；不继续旧p0/p1/video-studio/ui-polish/project-foundation分支。
- P3-013保留为真实对话验收的行为清单，P3-014记录已整合UI候选。当前已安装并启用 **0.3.0-alpha.7**（root `bf38fd6` / engine `0deef8f`，staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6`，INTEGRITY `775f4a3a…6d44`）；更换候选先核对实际包/版本/摘要。
- **P3-015 提速**：分支 `codex/faster-video-turn`（base `1672a42`，PR #9）已完成代码/测试/固定 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（alpha.8、root=`engine`=`cf7e593`），并通过 2 次真实模型真机验收（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）。alpha.8 已安装启用；PR #9 已按授权合并。回滚 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`。范围与证据见 [P3-015](../tasks/P3-015-faster-video-turn.md)、[提速记录](../research/2026-10-20-faster-video-turn.md)。
- **P3-016（A）面板/工程标题**：分支 `codex/p3-016-panel-title`（base `ec9ad47`，实现提交 `7a739f6`，worktree `dsh-video-editor-worktrees/p3-016-panel-title`）完成 A1 右栏可拖拽（默认 42%、上限 720px、左侧保底、双击/方向键/Home、版本化比例持久化、窄容器仍堆叠）、A2 `project.json` 可选 `title` + UI-only `project.rename` + inspect/project.list 返回 title + 顶栏左对齐内联重命名、A3 移除插件显示设置（保留系统 reduced-motion/transparency）、A4 门禁与测试。仓库门禁 check 54/54、smoke 77/77、check-host 66/66、worker 56/56、frame-times 8/8，真 Chrome 组件 harness 23/23；**未开 PR、未合并、未安装、未跑真实 DSH/模型；未 bump 版本**（候选版本/`test-stage-version` 的 alpha.7 断言由 Lead 合并时统一处理）。范围/证据见 [P3-016](../tasks/P3-016-panel-title.md)。
- 具体问题修复从main创建codex/<问题名>分支，按需隔离worktree；用户指定Agent负责实现并交PR。路径/权限/复用规则只维护在DEVELOPMENT。

本目录旧按工作区/人员命名的handoff全部为历史证据，不作为新的开工指令。保留旧工作树和固定产物供追溯，不自动安装或清理用户作品。
