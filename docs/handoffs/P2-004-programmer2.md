> 历史交接：当前接手请读协调分支 [工作区索引](README.md)。本文件保留当时路径、称呼和任务状态，不作为当前开工指令。

# 交接：程序员 2 → P2-004

日期：2026-10-17。总调度继任后的首项任务。用户把下方提示粘贴给程序员 2 即可。

## 给程序员 2 的提示

> 你的工作目录不变：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`，开工 HEAD 应为 `e595d4e`（工作树干净，领先 origin 4 个提交）。总调度已由原 Codex 主会话交接给 DSH 继任会话，消息仍由用户转发；两条开发线、分支、草稿 PR 与规则不变。
>
> 先读：AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md、docs/reviews/P2-002B-review-01.md、docs/adr/0002-host-bridge-runtime-and-boundaries.md。然后执行 **P2-004**（任务指南可从协调分支取：先 `git fetch origin`，再 `git show origin/codex/project-foundation:docs/tasks/P2-004-host-bridge-fixes.md > docs/tasks/P2-004-host-bridge-fixes.md`，不要切换分支），并把该指南存档进本分支、填写开发记录。
>
> 只修 review-01 的 R1–R4 并补针对性回归：R1 标题与 timing 绑定同一个 stableId（不能用两个 first-capability 查找，真实 fixture 眉题在前）；R2 Tool execute/渲染同一 UTF-8 字节限额，超限报 `E_RESULT_LIMIT` 不截断；R3 真实链实际执行固定 staging 的 Host 并校验 INTEGRITY 摘要；R4 版本门禁拒绝 0.1.0/无效版本、接受 0.1.1。不要扩范围，不改 `packages/video-engine-*`、`spikes/**`、全局规则/STATUS/决策和其它 worktree；不改 profile；不安装/启停/重启；不 merge。
>
> 完成后：`npm run check` 全通过（含新增回归）→ 新固定包放 `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.0.tgz`（不覆盖旧包，记录大小/文件数/SHA-256）→ 用修复提交 + 引擎 `54f4671` 跑 stage-dev 与真实引擎链，交付 doctor→open→inspect→edit→frame→render/cancel 证据（至少一条成功 H.264）→ 提交并 push 更新 PR #3（连同 4 个未推送提交），不新开 PR。
>
> 交回我：起始/结果 commit、`npm run check` 分项与新增用例、tarball digest、staging 路径与清单、真实链结果与实际执行路径标注、未测项、0.1.3 保持/回滚说明。此轮仍不安装，通过复审后由用户单独授权。
