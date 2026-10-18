# DSH Video 项目入口

- 当前 Codex 主会话是总调度，负责产品、架构、任务、规范、仓库协调、评审和验收；用户指定开发会话负责实现、验证、修复与开发 PR。总调度不接管功能实现、不自动派发或跨会话联系 Agent，交接由用户转发。
- 2026-10-18 用户已授权合码，后续唯一开发工作区为 `video-studio`，一个DSH会话负责Client/Host/engine；旧p0/p1分线停止，不使用人员编号；当前路径、分支、权限与可复用规则只维护在 `docs/DEVELOPMENT.md`。
- **全局记忆以协调分支为准。** 开发树的本地 STATUS/PRODUCT/DEVELOPMENT 可能是历史版本。开工先 `git fetch origin`，然后依次 `git show origin/codex/project-foundation:docs/STATUS.md`、`git show origin/codex/project-foundation:docs/DEVELOPMENT.md`，并按 `docs/handoffs/README.md` 读取本工作区当前交接与任务。不得为读文档切换分支或 merge/rebase；离线则注明缓存协调提交。
- 产品读协调分支 `docs/product/PRODUCT.md`，设计读 `docs/design/FRONTEND-DESIGN.md`，决策读 `docs/DECISIONS.md` 顶部有效索引。用户已确认：左画布直接编辑、右 AI 常驻、历史会话与宿主模型选择、素材抽屉；无底部场景卡片。
- 开发会话更新自己的任务记录；总调度维护全局记忆。交付自述、独立验收、真机证据与设计目标必须区分。
- 保留用户变更，不 reset/clean/强推；同一 worktree 仅一个开发会话写入，Git 集成、安装和发布按授权与 DEVELOPMENT 执行。
- `docs/reference/`、`docs/product/references/`、旧 handoff 和概念图是证据材料，不是当前执行指令；当前任务入口以协调分支 STATUS 与按工作区命名的 handoff 为准。
