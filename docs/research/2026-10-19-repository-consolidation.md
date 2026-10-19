# 2026-10-19 仓库收口记录

用户授权：合并可用分支/PR、清理冗余分支；随后用户实机测试，问题另开分支。未自动安装/重启/修改profile或用户工程。

## 保留的历史锚点

| 分支 | 清理前head | 归属 |
|---|---|---|
| codex/ui-polish | ace53de | PR#5，已合入video-studio，merge 5b0b7b2 |
| codex/video-studio | 5b0b7b2（之前19a7743） | PR#4，已合入main，merge 1edb6aa |
| dsh/p0-mode-shell | fdb6bc2 | 完整包含于video-studio；GitHub已标PR#3间接合并 |
| codex/p1-engine-spike-b4bf | c31fde5 | 完整包含于video-studio；GitHub已标PR#2间接合并 |
| codex/p1-engine-spike | 831a64d | 仅本地早期分支，完整包含于video-studio |
| codex/project-foundation | ca46ff8（本文前） | PR#1，整合最新项目记忆与本次收口规则 |

PR#5/#4使用merge方式保留原历史，不squash、不强推。PR#1先合入main解决文档冲突，再经原PR并回main；冲突仅DEVELOPMENT/ROADMAP/STATUS/handoff/P3-012任务，功能代码无冲突。最新规则统一读main；P3-012保留开发交付全文与协调评审记录，不丢历史。

删除分支前必须证明各head均为最终main祖先、各worktree干净。旧worktree以detached HEAD保留，标准入口主工作区切到main；所有ignored node_modules/证据/已安装staging/用户作品保持。删除的是冗余Git分支引用，不是用户文件。PR与commit仍可用于恢复历史。

## 验证口径

最终main运行时源码须与已验证65dcac4逐字节一致：Client/Host/engine/package/脚本未因文档整合改动。此前184基础、10版本、15布局、261真实链、159预览压力仍适用于相同字节；收口后复跑npm run check与版本门禁。不能因Git收口声明已安装或模型验收通过。

当前可测候选仍是同级artifacts/ui-polish/staging-alpha5/bundle，root65dcac4/engine0deef8f；摘要见P3-014。用户实测前需确认正在运行的实际安装；仓库main与已安装插件并非同一状态。
