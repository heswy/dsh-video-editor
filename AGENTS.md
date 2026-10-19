# DSH Video 项目入口

- 主会话负责产品、架构、任务、规范、仓库协调、评审与验收；用户指定开发会话负责实现、验证、修复和PR。主会话仅在用户明确指定时直接实现，不自动派发或跨会话联系Agent。
- **当前唯一长期主分支为main，代码和项目记忆均以origin/main为准。** 用户2026-10-19授权整合代码、清理旧PR/分支；旧p0/p1/video-studio/ui-polish/project-foundation分支与handoff为历史，不继续执行旧任务。
- 开工先git fetch origin，依次读取origin/main的docs/STATUS.md、docs/DEVELOPMENT.md及docs/handoffs/README.md。不得为读文档随意merge/rebase；离线注明缓存main提交。
- 当前阶段为用户实机测试。发现具体问题后，从最新main建立独立codex/<问题名>分支、修复验证、提交PR回main；不要在main直接做功能开发。同一worktree仅一个写入会话。
- 产品读docs/product/PRODUCT.md，设计读docs/design/FRONTEND-DESIGN.md，决策读docs/DECISIONS.md有效索引。当前目标：右侧对话生成/续改、左侧自动播放预览；用户手动编辑延期，无底部场景卡片。
- 路径、权限、可复用规则仅维护在docs/DEVELOPMENT.md。保留用户修改，不reset/clean/强推；安装/重启/发布按当次授权。
- 开发自述、组件/契约检查、真实DSH/模型证据与设计目标分开报告。旧任务、docs/reference与概念图是历史证据，当前入口以main的STATUS和handoff索引为准。
