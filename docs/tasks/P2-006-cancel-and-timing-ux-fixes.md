# P2-006：取消导出的错误提示 + 时序越界本地校验（客户端修复）

> 2026-10-17 总调度下发，来自 0.2.1 真机验收（见 [P2-004 真机验收记录](../research/P2-004-live-acceptance.md) V2/V3）。小任务，客户端修复；用户已授权正常 feature push/草稿 PR（D016），安装/启停/重启/merge 不授权。

执行：**程序员 2**；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`，开工 HEAD `123353c`（已安装 0.2.1 的提交）。若已变化先报告实际 HEAD，不 reset、不覆盖。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、[P2-005 复审](../reviews/P2-005-review-01.md)、[P2-004 真机验收记录](../research/P2-004-live-acceptance.md)。
2. 确认工作树干净、HEAD；把本指南存档为本分支 `docs/tasks/P2-006-cancel-and-timing-ux-fixes.md`，填写开发记录。

## 1. 边界

- 允许修改：`client.js`、`locale/*.json`、`scripts/smoke-client.mjs`、`scripts/check.mjs`、`README.md`、本任务记录。
- 不要修改：`host/**`、`packages/video-engine-*`、`spikes/**`、已安装 0.2.1 链接的 `staging-54f4671-bdcfd72`、全局规则/STATUS/决策、其它 worktree；不改 profile、不安装/启停/重启、不 merge。
- 版本升 **0.2.2**；不新增依赖；无 Host/worker 协议变化。

## 2. R2：用户取消任务不应显示为错误

现状（真机）：导出进行中点「取消」→ job 终止态 `cancelled`，界面同时出现红色「操作失败。」和「已取消」。

根因：`client.js` 的 `waitForJob` 终止态处理对 frame/render 都用 `state !== 'succeeded'` 设置错误（`E_RENDER_FAILED`/`E_FRAME_FAILED` + `video.error.generic` 兜底），用户主动取消被误判为失败。

要求：

- `cancelled` 终止态：**不设置红色错误**；清空/保持 error 为 null；job 状态正常显示「已取消」。frame 取消保留上一张有效帧（或明确空状态）且不报错；render 取消保留导出设置，可再次导出。
- `failed`/`timed_out`：仍需明确错误（本地化，不显示原始英文/路径）。
- 取消操作本身（`cancel` 请求失败）才显示错误。
- 回归：smoke-client 新增「render 进行中 -> cancel -> 终止 cancelled -> 无错误提示、状态已取消、可再次导出」「frame 取消 -> 无错误提示」；现有 42 项保持通过。

## 3. R3：开始/时长超出工程长度必须本地校验并本地化

现状（真机）：开始 `4`、时长 `5`（工程 5s）→ 发请求后被 worker 拒绝，UI 原样显示英文 `Timing extends beyond composition`。

要求：

- 客户端在 `saveEdit` 发送前校验 `nextStart + nextDuration <= project.duration`（容差 ≤ 1/240 s），超出时**不发请求**，显示本地化、就近的错误。
- 新增 i18n（zh/en），例如 zh：`开始时间与时长超出工程时长（最长 {duration} 秒）。`；英文对应。
- worker 的拒绝保留为防线；若仍收到 `E_PARAMS` 且消息为 `Timing extends beyond composition`，映射为同一条本地化提示，不显示英文原文。
- 边界：`0 / 5`（等于工程时长）允许；`2 / 3` 允许；`4 / 5` 拒绝；小数/浮点精度不产生假拒绝。
- 回归：smoke 新增「4/5 本地拒绝且无 edit 请求」「0/5 通过」「2/3 通过」；现有测试保持。

## 4. 交付与验收

1. `npm run check` 全通过（现有 97 + 新增），报告分项。
2. 新固定包 `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.2.tgz`（新目录、记录大小/文件数/SHA-256）；新 staging `../artifacts/p2-b/staging-54f4671-<新提交短SHA>`（引擎仍 `54f4671`）；真实链证据（staging 内 Host，demo 干净）。
3. commit + push 更新 PR #3（不新开 PR）；不安装、不改 profile、不动已安装 0.2.1 的 staging。
4. 交回：commit、检查分项、包摘要、staging、真实链、未测项。总调度复审后由用户重装 0.2.2 复核 R2/R3。

## 开发记录（程序员 2）

（待填写：起始 HEAD、提交、检查结果、包摘要、staging、真实链、未测项）
