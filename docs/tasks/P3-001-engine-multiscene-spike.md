# P3-001：多 Scene 工程与人工/AI 修订合并引擎可行性 spike

> 2026-10-17 总调度继任后下发的 P3 预研首任务。**只出证据与提案，不冻结契约、不改已验收生产包。** 用户已授权正常 feature 分支 commit/push 与草稿 PR（D016）；安装/启停/重启/merge 仍不授权。背景与目标见 [P3 创作闭环草案](../research/P3-ai-creation-loop-plan.md)。

执行：**程序员 1**；工作树 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`，开工 HEAD 应为 `54f4671`。若已变化，先报告实际 HEAD 与差异，不 reset、不覆盖。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、[P3 草案](../research/P3-ai-creation-loop-plan.md)、P1-001/P1-002 研究记录（在 b4bf 分支 `docs/research/P1-001-engine-spike.md`、`docs/research/P1-002-engine-worker.md`）。
2. 确认工作树干净、分支正确、HEAD 与基线一致；把本指南存档为本分支 `docs/tasks/P3-001-engine-multiscene-spike.md` 并填写开发记录。
3. 指南可从协调分支取（`git fetch origin` 后 `git show origin/codex/project-foundation:docs/tasks/P3-001-engine-multiscene-spike.md > docs/tasks/P3-001-engine-multiscene-spike.md`），不要切换分支。

## 1. 边界

- 只新增 `spikes/p3-multiscene/**`（代码、fixture、证据）与本文/研究文档/任务记录；**不改** `packages/video-engine-*` 已验收代码、根插件、全局规则/STATUS/决策、其它 worktree。
- HyperFrames 固定 **0.8.167**（hyperframes、@hyperframes/sdk、GSAP 3.15.0），不升级、不追新；`npm install` 必须 `--ignore-scripts --no-audit --no-fund`、锁文件入 spike、cache 落 spike 内；不运行 postinstall、不全局安装。
- **不调模型 API、不联网生成**；AI 重写 Scene 用受控脚本模拟（基于模板生成候选 HTML）。
- 不安装/启用/重启 DSH、不改 profile、不 merge main；完成后 push 本分支更新 PR #2（不新开 PR）。
- 若发现必须修改已验收生产包才能验证的能力：只记录提案，不动生产代码，交回总调度另开任务。

## 2. 必须回答的问题

本 spike 的产出是**决策依据**，不是实现。每个问题都要给出「验证方式 + 实测结果 + 失败选项证据」。

### Q1 多 Scene 权威表示

在 1280×720、30fps、总时长约 15 秒、3–4 个 Scene 的前提下，比较三种候选：

- A：单 HTML 文档中的嵌套 composition / 多时间线；
- B：单 HTML 文档的 Scene 区段（`data-start`/`data-duration` + GSAP timeline）；
- C：多入口文件 + manifest 聚合。

判定标准：SDK `openComposition`/serialize 可稳定往返；`buildDocument` 的尺寸与总时长正确；Player/Studio 按时间 seek 正确；官方 CLI 渲染正确；单 Scene 可单独重写而不破坏其它 Scene；`data-hf-id` 无跨 Scene 冲突。给出推荐结构与不推荐选项的实测失败证据。

### Q2 稳定对象 ID 与 inspect 扩展

- Scene 内 ID 唯一策略（如 `sceneId__elementId`），跨 Scene 重写后 ID 保留/迁移规则。
- 扩展 inspect 的候选输出：`sceneId`、每 Scene 的 `start/duration/order`、对象 stableId/capabilities；验证重建 Scene 索引不依赖另一份内容真相。
- 需说明现有 `capabilities()`（text/timing）在嵌套/多 Scene 下的行为。

### Q3 Scene 操作可行边界

- 创建/替换/删除/重排 Scene 时，SDK 公开 API（create/insert/remove/序列化/persist）能做什么，哪些必须走「受控整文件写入 + 重开校验」。
- 写入后 flush、`persist:error`、磁盘读回、revision 重算是否仍成立；操作失败是否可回滚到旧 revision。
- 建议的引擎写入模型（单 Scene 原子替换 vs 整文件原子替换），含并发/单写者队列约束。

### Q4 素材

- Logo（PNG）+ 2–3 张截图放入工程 assets，在 Scene 中引用并进入成片；验证 manifest 资产清单、revision 覆盖、尺寸/大小限制建议。
- 不提交真实用户素材；自造测试图。
- 字体/Chrome/FFmpeg 沿用 P1 已有本机约定，不写死为分发契约。

### Q5 人工/AI 修订合并（最重要）

构造 3 Scene 工程并验证：

1. 人工用现有 typed edit 修改 Scene2 标题（text/timing）；
2. 受控脚本基于 baseRevision 重写 Scene2 的候选 HTML（模拟 AI，含新增/删除/改元素）；
3. 按 `stableId` 三方合并：AI 改+人工未改→采用 AI；人工改+AI 未改→保留人工；双方改同一对象→显式冲突；人工新增→保留；AI 删除人工改过的对象→冲突；
4. 冲突结果返回结构化清单（sceneId/stableId/双方摘要），不允许静默覆盖；
5. 记录哪些结构变化无法自动合并、只能交人工协调。

产出：合并伪代码/最小实现、覆盖上述分支的测试或可复现脚本、失败案例证据。

### Q6 撤销/重做与重开

- 操作日志/快照方案：日志放在不进 revision 的保留目录；进程重启后 reopen 能恢复历史并 undo/redo。
- 验证 undo 产生新 revision、不篡改历史；AI 与人工操作都可撤销。
- 日志格式与体积上限建议。

### Q7 工程创建与注册

- 现有 registry 是 worker 启动时静态读取的。验证最小可行方案：worker 持有受控 `projectsRoot`，在其内复制模板创建工程并持久化注册（重启后仍可 open），或必须由 Host 重启 worker。
- 记录两种方案的代价与风险，给推荐。

### Q8 渲染与检查

- 15 秒成片 H.264，ffprobe 校验尺寸/帧率/总时长；每个 Scene 边界+中间帧 PNG；乱序 seek 一致性；reopen 后帧一致。
- 记录真实耗时、取消/清理行为是否符合现有语义（不要求新实现）。

## 3. 交付

1. 提交 + push 本分支更新 PR #2；不新开 PR、不 merge。
2. 新增 `docs/research/P3-001-engine-multiscene-spike.md`：结论先行、逐问题证据、失败选项、限制、API/合并/日志**提案**（明确「已验证/提案」）。
3. 证据：可提交的 JSON/日志/哈希放 spike 的 evidence 目录；大产物（MP4/PNG/字体/node_modules）gitignore，路径在文档中给出。
4. 任务记录填写：起始/结果 commit、命令、结构选择、合并算法、未验证项。
5. 交回总调度：commit、结论摘要、推荐结构与 API 提案、风险清单、下一步建议。

## 4. 验收（总调度）

- 独立复跑关键脚本与渲染；核对证据非伪造（真实 PNG/MP4/hash/ffprobe）。
- 重点核 Q1 结构判定、Q5 合并分支与冲突、Q7 动态注册；提案是否可支撑 P3-002 契约冻结。
- 通过后冻结 P3-002 契约，再拆 P3-003/P3-004 实现任务；本轮不安装、不 merge、不发布。

## 开发记录（程序员 1）

（待填写：起始 HEAD、结果 commit、Q1–Q8 结论摘要、证据路径、未测项）
