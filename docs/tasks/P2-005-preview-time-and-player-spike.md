# P2-005：画面时间点预览（B 小改）+ 插件内播放隔离可行性 spike（A）

> 2026-10-17 总调度下发。用户确认优先级：**先做 B 小改（时间点抽帧预览），同时排 A spike（隔离预览面真播放）**。来源：真机验收发现「插件内无法播放」，见 [P2-004 真机验收记录](../research/P2-004-live-acceptance.md)。用户已授权正常 feature push/草稿 PR（D016）；安装/启停/重启/merge 仍不授权。

执行：**程序员 2**；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`。开工 HEAD 应为 `afd2a29`（已安装 0.2.0 的来源）；若已变化先报告实际 HEAD，不 reset、不覆盖。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、[P2-004 复审](../reviews/P2-004-review-01.md)、[真机验收记录](../research/P2-004-live-acceptance.md)。
2. 确认工作树干净、分支正确、HEAD 与基线一致；把本指南存档为本分支 `docs/tasks/P2-005-preview-time-and-player-spike.md` 并填开发记录。
3. 指导文件从协调分支取（`git fetch origin` 后 `git show origin/codex/project-foundation:docs/tasks/P2-005-preview-time-and-player-spike.md`），不切换分支。

## 1. 边界

- 允许修改：根 `client.js`、`locale/*.json`、`package.json`（版本/自身脚本）、`README.md`、`scripts/**`、相关检查、本任务记录、`docs/research/P2-005-preview-spike.md`、dev-only 原型目录 `experiments/preview/**`。
- 不要修改：`packages/video-engine-*`、`spikes/**`、`host/**` 的协议语义（B 不需要新 Host 方法；若 A 需要新 Host 能力，只写提案）、全局规则/STATUS/决策、其它 worktree；不改 profile；不安装/启停/重启；不 merge。
- 已安装的 0.2.0 链接的是 `staging-54f4671-fa7b0e2-clean`，**不要动它**；新改动走新 staging。
- 根版本升到 **0.2.1**（区别于已安装的 0.2.0）。

## 2. Phase 1（B 小改，生产代码）：画面时间点预览

目标：用户可以在插件里预览工程**任意时刻**的真实帧，不再只有固定 2.5s；不做假播放。

要求：

- 主画面工具区增加克制的「画面时间」输入（秒，范围 `0 … duration`，步进 1/30 或 0.1，label 走 locale，中英文）。
- 「更新画面」按当前画面时间调用现有 `frame`（`{projectId, revision, time}`）；成功后显示该 revision 的真实 PNG；失败/取消保留可读错误，不覆盖旧帧冒充新 revision。
- 时间越界必须拒绝或明确夹到范围内并在 UI 说明；不允许静默改成别的时刻。
- 打开工程默认时间沿用 2.5s（或上次选择），面板切换/重挂载恢复时间点与画面（现有 view memory 扩展）。
- 不新增 Host 方法、不改 worker、不加时间线/轨道/假播放按钮/自动轮播；不把 PNG 当视频。
- 回归：smoke-client 新增「frame 请求带所选 time」「越界拒绝/夹取」「重挂载恢复时间点」；check.mjs 静态断言无假播放/时间线；既有 92 项全部保持通过。
- 交付：`npm run check` 全通过（报告分项）；新固定包 `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.1.tgz`（新目录、记录大小/文件数/SHA-256）；新 staging `../artifacts/p2-b/staging-54f4671-<新提交短SHA>`（引擎仍固定 `54f4671`）；真实链证据；commit + push 更新 PR #3。

## 3. Phase 2（A spike，不落生产）：插件内播放隔离可行性

目标：回答「能否在插件内嵌入一个隔离预览面，支持播放/暂停/seek」，给后续实现任务提供可执行方案。**只出证据与提案，不改生产代码。**

必须回答：

1. **候选方案对比**：A1 sandbox iframe + 工程快照/静态预览文档；A2 复用 HyperFrames Player/Studio 的只读预览；A3 抽帧序列升级（非真播放）。比较播放/seek 能力、加载延迟、与导出画面一致性、实现复杂度。
2. **工程内容如何到预览面**：Host 只读提供工程快照（受控 `projectId`+`revision`）需要什么新能力？是否可以避免给预览面任意路径/URL；engine 是否需要新方法（如 snapshot/preview）——只写提案。
3. **隔离与安全**：iframe `sandbox` 属性、CSP、禁止网络、禁止宿主 API、不可信工程 HTML/JS 的边界；预览面不得继承插件/宿主权限；明确哪些是实测、哪些仍未知。
4. **资源**：本地字体/GSAP/Player runtime 来源（不得依赖 CDN）、离线可运行、大小与首帧延迟。
5. **一致性**：播放画面与 `frame`/`render` 是否同一内容（revision 固定、时间基准一致）。
6. **结论**：推荐方案、风险、工作量级、建议拆成哪些实现任务；未验证项如实列出。

证据要求：可用 dev-only 原型（`experiments/preview/**`，可安装固定版本 hyperframes 0.8.167 到该目录，`--ignore-scripts`，锁文件入库、node_modules 不入库），在真实 Chrome 本地打开、断网运行，截取 0.5s/2.5s/4.5s 画面或日志；证明 seek/播放与无网络。若 A1/A2 不可行，也必须有失败证据并给 A3 或替代建议。

## 4. 交付与验收

1. B 先完成：commit、`npm run check` 结果、0.2.1 固定包摘要、新 staging、真实链证据；交回后总调度复审，用户再重装验收。
2. A 再完成：`docs/research/P2-005-preview-spike.md`（结论先行、已验证/提案分开）、原型证据路径、推荐拆分。
3. 交回：两个 commit（B 生产改动、A 文档/原型）、检查结果、包/staging 路径与摘要、A 结论与风险、未测项。
4. 本轮不安装、不改 profile、不 merge、不发布；安装由用户重新授权操作。

## 开发记录（程序员 2）

（待填写：起始 HEAD、B 提交与检查结果、0.2.1 包摘要、新 staging、真实链、A 结论与证据、未测项）
