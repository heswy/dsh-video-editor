# 当前交接入口

更新：2026-10-20。用户先实机测试，再按具体问题建立修复分支。

- 最新代码、规则、项目记忆统一读origin/main；先读STATUS、DEVELOPMENT、PRODUCT。
- 当前没有已下发的新功能任务；不继续旧p0/p1/video-studio/ui-polish/project-foundation分支。
- P3-013保留为真实对话验收的行为清单，P3-014记录已整合UI候选。当前安装仍为 **0.3.0-alpha.8**（root=`engine`=`cf7e593`，staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`，INTEGRITY `988302e9…6857`）；alpha.9 候选尚在 PR #11/独立验收中，未构建、未安装；更换候选先核对实际包/版本/摘要。
- **P3-015 提速**：分支 `codex/faster-video-turn`（base `1672a42`，PR #9）已完成代码/测试/固定 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（alpha.8、root=`engine`=`cf7e593`），并通过 2 次真实模型真机验收（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）。alpha.8 已安装启用；PR #9 已按授权合并。回滚 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`。范围与证据见 [P3-015](../tasks/P3-015-faster-video-turn.md)、[提速记录](../research/2026-10-20-faster-video-turn.md)。
- **P3-016（A）面板/工程标题已合并 main**：PR #10 合并提交 `61c566e`。完成 A1 右栏可拖拽（默认 42%、上限 720px、左侧保底、双击/方向键/Home、比例持久化、窄容器仍堆叠）、A2 `project.json` 可选 `title` + UI-only `project.rename` + inspect/project.list 返回 title + 顶栏左对齐内联重命名、A3 移除插件显示设置（保留系统 reduced-motion/transparency）、A4 门禁与测试。范围/证据见 [P3-016](../tasks/P3-016-panel-title.md)。
- **P3-017（B）预览稳定性/图片预览/产品导出（alpha.9 候选，PR #11）**：分支 `codex/p3-017-preview-export`（base `ec9ad47`，已合并 main `61c566e` 解决顶栏冲突）。B1 预览状态机（snapshot/ready 独立 30s 预算、1s revision 去抖、失败自动重试 1 次、旧画面保留、有界诊断、旧快照 release）；B2 内嵌对话图片/文件点击本地 overlay（data/blob/remote 直接显示、相对路径走 Host preview、绝不回落 sidebarRight）；B3 产品顶栏右侧“导出 MP4”（真实 stage/百分比/已用时间/取消/下载、绑定点击时 revision、防重复点击、Host/worker render 900000ms、frame 仍 120000ms）。分支门禁见 [P3-017](../tasks/P3-017-preview-export.md)；真实 Chrome 合并后验收与独立 verifier 复验完成前不合并/不安装。范围/证据见 [P3-017](../tasks/P3-017-preview-export.md)。- 具体问题修复从main创建codex/<问题名>分支，按需隔离worktree；用户指定Agent负责实现并交PR。路径/权限/复用规则只维护在DEVELOPMENT。

本目录旧按工作区/人员命名的handoff全部为历史证据，不作为新的开工指令。保留旧工作树和固定产物供追溯，不自动安装或清理用户作品。
