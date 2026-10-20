# 当前交接入口

更新：2026-10-20。用户先实机测试，再按具体问题建立修复分支。

- 最新代码、规则、项目记忆统一读origin/main；先读STATUS、DEVELOPMENT、PRODUCT。
- 当前没有已下发的新功能任务；不继续旧p0/p1/video-studio/ui-polish/project-foundation分支。
- P3-013保留为真实对话验收的行为清单，P3-014记录已整合UI候选。**当前安装为 0.3.0-alpha.9**（root=`engine`=`573352e`，client/worker `0.4.0`，staging `artifacts/p2-b/staging-alpha9-573352e`，INTEGRITY sha256 `28f319b91583ae008c577f1caef9f6d89c2a7679bd710aca0a958141cfe53b9e`）；已通过真实 Plugins 页安装/启用（插件页 v0.3.0-alpha.9 / 1 of 1 运行中），重启 DSH 后加载新 client bundle。回滚保留 alpha.8 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（INTEGRITY `988302e9…6857`）与用户原作品；更换候选先核对实际包/版本/摘要。
- **P3-015 提速**：分支 `codex/faster-video-turn`（base `1672a42`，PR #9）已完成代码/测试/固定 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（alpha.8、root=`engine`=`cf7e593`），并通过 2 次真实模型真机验收（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）。alpha.8 已安装启用；PR #9 已按授权合并。回滚 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`。范围与证据见 [P3-015](../tasks/P3-015-faster-video-turn.md)、[提速记录](../research/2026-10-20-faster-video-turn.md)。
- **P3-016（A）面板/工程标题已合并 main 并随 alpha.9 安装**：PR #10 合并提交 `61c566e`。完成 A1 右栏可拖拽（默认 42%、上限 720px、左侧保底、双击/方向键/Home、比例持久化、窄容器仍堆叠）、A2 `project.json` 可选 `title` + UI-only `project.rename` + inspect/project.list 返回 title + 顶栏左对齐内联重命名、A3 移除插件显示设置（保留系统 reduced-motion/transparency）、A4 门禁与测试。真机 UI 已确认：splitter 42%→50% 且 reload 持久、作品名内联重命名生效且 revision 不变、无显示设置/简化效果。范围/证据见 [P3-016](../tasks/P3-016-panel-title.md)。
- **P3-017（B）预览稳定性/图片预览/产品导出（已合并 main + alpha.9 安装）**：PR #11 合并提交 `573352e`（候选阶段：B merge `55fbed7`、版本 bump `795acaa`；冲突按“A 左侧作品名/箭头/内联 rename + B 右侧导出；显示设置保持删除”解决）。B1 预览状态机（snapshot/ready 独立 30s 预算、1s revision 去抖、失败自动重试 1 次、旧画面保留、有界诊断、旧快照 release）；B2 内嵌对话图片/文件点击本地 overlay（data/blob/remote 直接显示、相对路径走 Host preview、绝不回落 sidebarRight）；B3 产品顶栏右侧“导出 MP4”（真实 stage/百分比/已用时间/取消/下载、绑定点击时 revision、防重复点击、Host/worker render 900000ms、frame 仍 120000ms）。合并后门禁：check **54/54**、smoke-client **80/80**、check-host **68/68**（×3 稳定）、worker **56/56**、test-stage-version **10/10**、real Chrome `test-conversation-preview` **164/164**（含 A+B 顶栏/分隔条集成断言）。alpha.9 固定 staging 回归：host-engine **ok**（5s render 150 帧/取消）、conversation-chain **261/261**、conversation-preview **164/164**。**真机已确认**右侧导出按钮真实 5s 导出约 10s 并出现下载链接；**剩余待用户确认**：已安装 DSH 内嵌原生对话中的图片/文件点击、真实模型连续修改、20s/120s 长片导出与取消/失败路径。范围/证据见 [P3-017](../tasks/P3-017-preview-export.md)。
- 具体问题修复从main创建codex/<问题名>分支，按需隔离worktree；用户指定Agent负责实现并交PR。路径/权限/复用规则只维护在DEVELOPMENT。

本目录旧按工作区/人员命名的handoff全部为历史证据，不作为新的开工指令。保留旧工作树和固定产物供追溯，不自动安装或清理用户作品。
