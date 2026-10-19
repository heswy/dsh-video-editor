# 当前交接入口

更新：2026-10-19。用户先实机测试，再按具体问题建立修复分支。

- 最新代码、规则、项目记忆统一读origin/main；先读STATUS、DEVELOPMENT、PRODUCT。
- 当前没有已下发的新功能任务；不继续旧p0/p1/video-studio/ui-polish/project-foundation分支。
- P3-013保留为真实对话验收的行为清单，P3-014记录已整合UI候选。当前已安装并启用 **0.3.0-alpha.7**（root `bf38fd6` / engine `0deef8f`，staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6`，INTEGRITY `775f4a3a…6d44`）；更换候选先核对实际包/版本/摘要。
- 具体问题修复从main创建codex/<问题名>分支，按需隔离worktree；用户指定Agent负责实现并交PR。路径/权限/复用规则只维护在DEVELOPMENT。

本目录旧按工作区/人员命名的handoff全部为历史证据，不作为新的开工指令。保留旧工作树和固定产物供追溯，不自动安装或清理用户作品。
