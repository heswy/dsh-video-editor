# P3-003：多 Scene 工程、AI 候选合并与历史（引擎实现）

> 2026-10-17 总调度下发。依据 [P3-001 复审](../reviews/P3-001-review-01.md) 与 D020/D021/D022。用户已授权正常 feature push/草稿 PR（D016）；安装/启停/重启/merge 仍不授权。**这是 P3 核心（AI 生成视频）的引擎第一步**：让引擎能创建多 Scene 工程、按模板写入 AI 内容、与人工修改合并、支持撤销/重开并真实渲染。

执行：**程序员 1**；工作树 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`，开工 HEAD `cf24842`。若已变化先报告实际 HEAD，不 reset、不覆盖。允许分批提交，**Phase A 完成后可先 push 并报告，便于总调度提前评审**（不必等 Phase B）。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、[P3-001 复审](../reviews/P3-001-review-01.md)、[P3-001 spike 研究记录](../research/P3-001-engine-multiscene-spike.md)、[P3 草案](../research/P3-ai-creation-loop-plan.md)、P2-003 复审。
2. 确认工作树干净、分支正确；把本指南存档为本分支 `docs/tasks/P3-003-engine-multiscene-implementation.md`，填写开发记录。
3. 指南从协调分支取（`git fetch origin` 后 `git show origin/codex/project-foundation:docs/tasks/P3-003-engine-multiscene-implementation.md`），不切换分支。

## 1. 边界

- 允许修改：`packages/video-engine-worker/**`、`packages/video-engine-client/**`、两包测试、`docs/research/P3-003-*.md`、本任务记录。
- 不要修改：根插件（`index.js`/`client.js`/`host/**`）、`spikes/**`、全局规则/STATUS/决策、其它 worktree；不改 profile；不安装/启停/重启 DSH；不 merge main；不升级依赖；不运行 postinstall。
- HyperFrames 固定 0.8.167；不调模型 API；AI 候选由模板生成器模拟。
- 现有 P2 已验收行为必须保持：`doctor/open/inspect/edit/frame/render/status/cancel/close` 语义与测试不回归；`inspect` 只允许**附加**字段（客户端忽略未知字段）。
- 版本：`dsh-video-engine-client`、`dsh-video-engine-worker` 升 **0.2.0**；固定包仍放 `artifacts/engine/<commit>/`（新目录，不覆盖 `54f4671`）。
- 内容权威：工程 `index.html` 是唯一内容真相；Scene 模型由当前 HTML 派生，**不得成为第二份真相**；历史/撤销日志放 `.dsh-video/history/`，不进 revision。

## 2. 必须实现的契约（已冻结）

### 2.1 工程模型与模板

- 单 `index.html` 权威：`#main[data-composition-id][data-duration]`，每个 Scene 一个 `<section data-scene-id data-scene-order data-start data-duration>`，元素 `data-hf-id="<sceneId>-<elementId>"`；一个生成的 master GSAP timeline。
- 场景模板（v1，固定集合）：`product-launch-v1`；每 Scene 支持 title/subtitle/badge/rule/logo/shot 等元素（一层、无嵌套），颜色/素材可参数化；Scene 局部时间在生成时换算为全局 `data-start`。
- 生成器必须消除 P3-001 记录的 `StaticGuard` 初始 opacity 警告（或在校验中显式记录并证明不产生错误帧）。
- 约束：Scene 数 1–12；总时长 ≤ 3600s；单 Scene 0.5–60s；ID 稳定、全局唯一；非法 spec 拒绝且不写盘。

### 2.2 工程创建与注册（D022）

- worker 管理 `projectsRoot`（部署配置）+ 持久 registry 文件；启动时 reload。
- `project.create`：输入 `{templateId, title?, width?, height?, fps?, assets?: [{inboxName, name?, mediaType?}]}`；worker 生成 projectId 并返回；复制模板、写入工程、原子更新 registry；`projectId` 由 worker 生成，不接受 Host 传路径。
- 路径包含（realpath 在 `projectsRoot` 内）、registry 原子写、单写者；Host 永不直接改 worker 文件。
- 素材导入：registry 配置只读 `assetInboxRoot`；`asset.import {projectId, expectedRevision, operationId, sourceName, name, mediaType}` 校验文件类型/大小/签名后原子复制进工程 assets 并更新 manifest/revision；拒绝任意路径/URL。
- 资产限额：仅 PNG/JPEG；单文件 ≤8 MiB；每工程 ≤16 资产、≤64 MiB；字体不入 Git。

### 2.3 inspect 扩展

- 现有字段保持不变；**新增** `scenes: [{sceneId, order, start, duration, elements:[{stableId, text, timing, capabilities}]}]`，`elements[]` 元素增加 `sceneId`。
- capabilities 沿用现有 `text`/`timing`；从 HTML 重建，外部手改文件后下一次 inspect/revision 同步变化。

### 2.4 Scene 结构操作

- `scene.create {projectId, expectedRevision, operationId, sceneId?, afterSceneId?, template: SceneSpec}`
- `scene.update {projectId, expectedRevision, operationId, sceneId, template: SceneSpec}`
- `scene.remove {projectId, expectedRevision, operationId, sceneId}`
- `scene.reorder {projectId, expectedRevision, operationId, order: sceneId[]}`
- 实现路径：Scene 模型 → 重新生成完整 HTML + master timeline → SDK 重开校验（尺寸/总时长/Scene 集合/ID 唯一/时间边界）→ 原子写 → revision 重算；校验/写盘失败**不发布**，旧 revision 保持可读。
- 返回 `{projectId, revision, scenes, changeSummary}`；`expectedRevision` 不匹配 → `E_REVISION_CONFLICT`；单写者队列串行。

### 2.5 AI 候选合并（Phase B，最重要）

- `project.revise {projectId, baseRevision, expectedRevision, operationId, sceneId, template: SceneSpec}`
  - `baseRevision` = AI 看到内容时的 revision；`expectedRevision` = 写入时要求的最新 revision。
  - 若 `expectedRevision !== 当前 revision` → `E_REVISION_CONFLICT`。
  - `base === expected`：直接生成候选并校验写入（无人工改动）。
  - `base !== expected`：从历史/快照取 base 内容，生成 AI 候选文档，按 P3-001 算法做 **stableId 三方合并**；只允许改目标 Scene，其它 Scene 必须逐字节不变。
  - 冲突码至少：`BOTH_MODIFIED`、`AI_DELETE_HUMAN_MODIFY`、`HUMAN_DELETE_AI_MODIFY`、`ADD_ADD`、`SCENE_META_CHANGED`、`STRUCTURAL_TAG`、`STRUCTURAL_OTHER_SCENE`、`STRUCTURAL_ORDER`；冲突返回 `{sceneId, stableId, reason, human, ai}` 且**不写盘**。
  - 合并成功返回新 revision + `changeSummary`（adopted/kept/added/removed）与可选 `conflicts: []`。
- base 快照不可得（历史被裁剪等）→ 明确 `E_BASE_MISSING`，不猜。
- v1 仅模板约束的 Scene/元素；任意 HTML/JS 合并与隔离不在本任务。

### 2.6 历史与撤销（D021）

- `.dsh-video/history/`：`entries.jsonl`（内容 revision 链，actor human/ai、kind、sceneId、summary、at）、`ops.jsonl`、`snapshots/<revision>.html`、`state.json`（单调 `historyCursor` + cursor 位置）。
- `history {projectId, limit?}`、`undo {projectId, expectedRevision, operationId}`、`redo`：恢复对应内容并原子写；返回 `{projectId, revision, historyCursor, restored:{...}}`。revision 保持内容哈希（撤销可回到旧哈希值），历史动作另记；重启后历史仍可 undo/redo。
- 上限：保留最近 64 条/快照总量 ≤8 MiB，超出裁剪最旧；历史不进 revision、不影响渲染。

## 3. 落地分期与交付

- **Phase A（可先交审）**：2.1–2.4 + 2.6 + 素材导入 + inspect 扩展 + 现有 P2 方法兼容；真实 worker 链：create → inspect → scene 操作 → 素材 → 15s render/取消 → 历史/重启。
- **Phase B**：2.5 合并 + 冲突码 + 无人工/有人工/冲突/删除/新增/其它 Scene 保护等分支；复用 P3-001 单元用例思路补测试。
- 每阶段 commit + push（更新 PR #2，不新开 PR）；最终交付：
  1. 两包版本 0.2.0 的固定 tarball：`artifacts/engine/<commit>/{dsh-video-engine-client-0.2.0.tgz,dsh-video-engine-worker-0.2.0.tgz}`（记录大小/文件数/SHA-256，字节与提交一致）。
  2. `docs/research/P3-003-engine-multiscene-implementation.md`：契约落地、API 表、错误码、测试证据、真实渲染、限制、未验证。
  3. `npm test`（worker）、client 测试、`test:real` 真实链全通过；报告分项数字。
  4. 真实 15s 成片 H.264 + ffprobe（1280×720/30fps/450 帧/15s）；create/merge/render/cancel 证据 JSON。
- 交回：commit、测试、包摘要、evidence 路径、契约与文档差异、未测项、风险。

## 4. 验收（总调度）

- 独立复跑两包测试与真实链；核对包字节、版本、导出。
- 重点验收：创建工程与 registry 持久；scene 结构操作原子性与校验拒绝；inspect scenes 派生；素材限额与路径拒绝；合并 S1/S2/S3/S4/S5/S7 分支与冲突结构；其它 Scene 不变；history 重启后 undo/redo；现有 P2 方法无回归。
- 通过后再安排根插件接入（P3-004）与端到端 AI 样例（P3-005）；本轮不安装、不 merge、不发布。

## 开发记录（程序员 1）

（待填写：起始 HEAD、Phase A/B 提交、API 落地、测试数字、包摘要、真实链证据、未测项）
