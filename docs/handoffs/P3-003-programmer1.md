# 交接：程序员 1 → P3-003

日期：2026-10-17。P3-001 复审通过后的引擎实现任务。用户把下方提示粘贴给程序员 1 即可。

## 给程序员 1 的提示

> P3-001 复审通过：独立复跑 12/12、MP4 哈希/ffprobe/合并/历史/注册/渲染证据全部对上，结论已冻结为 D020（单 HTML + Scene 区段 + master timeline；受控整文件重写）、D021（revision 保持内容哈希 + 单调 historyCursor）、D022（worker 管理 projectsRoot + 持久 registry + project.create）。现在进入 **P3-003 引擎实现**，这是 AI 生成视频的核心引擎一步。
>
> 工作目录不变：`/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`，开工 HEAD `cf24842`。先读 AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md、docs/reviews/P3-001-review-01.md、docs/research/P3-001-engine-multiscene-spike.md，然后执行 P3-003。任务指南从协调分支取（先 `git fetch origin`，不切换分支）：
> ```
> git show origin/codex/project-foundation:docs/tasks/P3-003-engine-multiscene-implementation.md > docs/tasks/P3-003-engine-multiscene-implementation.md
> ```
> 把指南存档进本分支并填开发记录。
>
> 范围：只改 `packages/video-engine-worker/**`、`packages/video-engine-client/**` 与两包测试/研究文档；不动根插件、`spikes/**`、全局规则；不改 profile、不安装/启停/重启、不 merge；HyperFrames 固定 0.8.167、不升级依赖、不跑 postinstall、不调模型 API。
>
> 必做契约：单 HTML + Scene 区段 + master timeline 生成器（Scene 局部时间换算全局；消除 StaticGuard 初始 opacity 警告）；worker 管理 projectsRoot + 持久 registry + `project.create`（worker 生成 projectId、原子 registry、路径包含）；`asset.import`（PNG/JPEG、≤8MiB/文件、≤16 资产/≤64MiB，来自只读 assetInboxRoot）；inspect 扩展 `scenes[]`（旧字段不变、元素带 sceneId）；`scene.create/update/remove/reorder`（expectedRevision + operationId，整文件重写 → SDK 校验 → 原子写 → revision 重算，失败不发布）；`project.revise`（baseRevision + expectedRevision，stableId 三方合并，冲突码 BOTH_MODIFIED/AI_DELETE_HUMAN_MODIFY/HUMAN_DELETE_AI_MODIFY/ADD_ADD/SCENE_META_CHANGED/STRUCTURAL_TAG/STRUCTURAL_OTHER_SCENE/STRUCTURAL_ORDER，冲突不写盘，目标 Scene 外逐字节不变）；`history/undo/redo`（`.dsh-video/history/` 不进 revision，单调 historyCursor，重启持久）；两包版本升 0.2.0，现有 P2 方法与测试不回归。
>
> 允许分批：Phase A（工程/Scene/inspect/素材/历史/render）完成后先 commit+push 并报告，便于提前评审；Phase B（revise 合并）继续。完成后出新固定包 `artifacts/engine/<commit>/{client,worker}-0.2.0.tgz`、真实 15s H.264/ffprobe 证据、`docs/research/P3-003-engine-multiscene-implementation.md`，commit + push 更新 PR #2（不新开 PR）。
>
> 交回：commit（Phase A/B）、两包测试与真实链数字、包摘要、证据路径、契约落地差异、未测项与风险。本轮不安装、不 merge、不发布；总调度复审后再接入根插件。
