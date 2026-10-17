> 历史交接：当前接手请读协调分支 [工作区索引](README.md)。本文件保留当时路径、称呼和任务状态，不作为当前开工指令。

# 交接：程序员 2 → P2-006

日期：2026-10-17。0.2.1 真机验收发现的客户端 UX 问题修复。用户把下方提示粘贴给程序员 2 即可。

## 给程序员 2 的提示

> 0.2.1 已真机安装。验收发现两个客户端问题，总调度已定位根因并排进 P2-006（小任务，客户端修复，升 0.2.2）：
>
> 你的工作目录不变：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`，开工 HEAD `123353c`。先读 AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md、docs/research/P2-004-live-acceptance.md，然后执行 P2-006。任务指南从协调分支取（先 `git fetch origin`，不切换分支）：
> ```
> git show origin/codex/project-foundation:docs/tasks/P2-006-cancel-and-timing-ux-fixes.md > docs/tasks/P2-006-cancel-and-timing-ux-fixes.md
> ```
> 把指南存档进本分支并填开发记录。
>
> **R2 取消任务不显示为错误**：真机导出中点「取消」后出现红色「操作失败。」+「已取消」。根因在 client.js 的 waitForJob：终止态用 `state !== 'succeeded'` 设置错误，`cancelled` 被当成失败。要求 cancelled 终止态不设红色错误、状态正常显示「已取消」，frame 取消保留上一帧或明确空状态，render 取消保留设置可重试；failed/timed_out 仍给本地化错误。补 smoke 回归（render 取消、frame 取消）。
>
> **R3 开始/时长越界本地校验**：开始 4 + 时长 5（工程 5s）被 worker 拒绝后，UI 原样显示英文 `Timing extends beyond composition`。要求在 saveEdit 发送前校验 `start + duration <= project.duration`（容差 ≤1/240s），超出时不发请求并显示本地化提示（新增 zh/en i18n，如「开始时间与时长超出工程时长（最长 5.00 秒）。」）；worker 拒绝保留为防线，若仍收到 E_PARAMS 该消息映射为同一提示，不显示英文。补 smoke 回归（4/5 拒绝且无 edit 请求、0/5 通过、2/3 通过）。
>
> 范围：只改 client.js、locale、scripts/smoke-client.mjs、scripts/check.mjs、README、本任务记录；不动 host/**、packages/video-engine-*、spikes/**、已安装 0.2.1 链接的 staging；不改 profile、不安装/启停/重启、不 merge；版本升 0.2.2。
>
> 完成后：npm run check 全通过（现有 97 + 新增）→ 新固定包 `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.2.tgz`（新目录、记录大小/文件数/SHA-256）→ 新 staging `../artifacts/p2-b/staging-54f4671-<新提交短SHA>`（引擎仍 54f4671）→ 真实链证据（staging 内 Host、demo 干净）→ commit + push 更新 PR #3（不新开 PR）。不安装。
>
> 交回：commit、检查分项、包摘要、staging 路径、真实链、未测项。总调度复审后由用户重装 0.2.2。
