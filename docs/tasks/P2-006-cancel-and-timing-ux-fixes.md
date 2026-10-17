> 当前状态：p0-mode-shell 已交付 `97c0609` / `16d60aa`，等待总调度独立复审；下文原始指南与开发者记录保留，不重新开工。

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

- 起始：分支 `dsh/p0-mode-shell`，开工 HEAD `123353c`（工作树干净，未切换分支）。指南从 `origin/codex/project-foundation` 存档。
- 修复提交：`97c0609 fix(ui): neutralize cancelled jobs and validate timing locally`；版本 `0.2.2`。仅改 `client.js`、`scripts/smoke-client.mjs`、`scripts/check.mjs`、`README.md`、本任务记录；未改 host/**、packages、spikes、profile。
- R2：`waitForJob` 终止态区分 `cancelled`（`setError(null)`，保留“已取消”状态）/`succeeded`/`timed_out` 与 failed（后两者使用 zh/en 本地化错误，不再透出 worker 英文）。frame 取消为明确空画面；render 取消保留导出设置并可再次导出；取消请求本身失败仍报错。
- R3：`saveEdit` 发送前校验 `nextStart + nextDuration <= project.duration + 1/240`；越界不发 edit，显示「开始时间与时长超出工程时长（最长 {duration} 秒）。」；`0/5`、`2/3` 允许，`4/5` 拒绝；worker 仍收到时把 `E_PARAMS` + `Timing extends beyond composition` 映射为同一本地化提示。
- 检查：`npm run check` 全通过——静态 **37/37**、Client smoke **46/46**、Host 契约 **20/20**，合计 **103/103**。新增 smoke：render 取消无错误/可重试、failed/timed_out 本地化、frame 取消无错误空状态、R3 三组边界与 worker 拒绝映射；静态新增 R2/R3 断言。
- 新固定包：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/97c0609/dsh-video-0.2.2.tgz`，40,220 B / 17 files，SHA-256 `0dd8bcf2a6415ea4c592eea44e7b2a5bff740156540443b553cc0709768ccf89`；runtime 文件与提交逐字节一致。
- 新 staging：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-54f4671-97c0609`；root `97c0609b4c15a4e3b216c0b2fb90f511b60580e5`，engine `54f467147ae2f61e118099c4947f55e8da877500`；INTEGRITY SHA `4e43f20390cbd91cfbfa1cc8805d65cd4a0f5e6623d237a75d23577dd9b23179`；staged bridge `07442c86…`、config `353c72c2…`、patch `c0e5f66a…`；bundle/client/worker `0.2.2/0.1.1/0.1.1`；bundle 16/client 12/worker 15 源文件；`npm ci --ignore-scripts`、`esbuildAvailable:true`。
- 真实链证据：`artifacts/p2-b/evidence/engine-run-2026-10-17T13-15-34-546Z.json`；staging 内 Host 执行、INTEGRITY 校验通过；hf-title revision `135a529…`→`f714e71…`；PNG 279,463 B/hash `875b48c6…`；成功 H.264 MP4 135,855 B/hash `fae2687e…`（1280×720、30/1、150 帧、5s）；二次 render cancel `cancelling`→`cancelled`、cleaned；close/dispose 完成。跑完恢复干净 demo，标题 `让创意成为影像`。
- staging 工具限制：`scripts/stage-dev.mjs`（不在本任务白名单）仍硬编码期望根版本 `0.2.1`，本次用其临时副本把期望版本改为 `0.2.2` 生成 staging；脚本本身未提交修改。后续应把版本门禁参数化（或发版任务同步），否则下个版本不能直接用仓库脚本重建。
- 未安装/未启停/重启、未改 profile、未 merge；已安装 0.2.1 与 `staging-54f4671-bdcfd72` 未动；0.2.2 待复审后用户重装。未测：真实 DSH 中 R2/R3 重装后交互、浅色/深色视觉、其它错误消息本地化。

## 总调度同步记录

2026-10-17 从 `16d60aa` 只导入任务交付文档，未合并功能代码。103/103 与真实链是开发者报告，不升级为本轮独立验收；staging 版本门禁硬编码问题留待复审。
