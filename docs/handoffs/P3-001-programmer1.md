# 交接：程序员 1 → P3-001

日期：2026-10-17。总调度继任后下发的 P3 预研任务。用户把下方提示粘贴给程序员 1 即可。

## 给程序员 1 的提示

> 你的工作目录不变：`/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`，开工 HEAD 应为 `54f4671`（工作树干净、与 origin 同步）。总调度已由原 Codex 主会话交接给 DSH 继任会话，消息仍由用户转发；两条开发线、分支、草稿 PR 与规则不变。
>
> 先读：AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md、docs/reviews/P2-003-review-01.md（你的引擎包已验收），然后执行 **P3-001**。任务指南与 P3 创作闭环草案从协调分支取（先 `git fetch origin`，再执行，不要切换分支）：
> ```
> git show origin/codex/project-foundation:docs/tasks/P3-001-engine-multiscene-spike.md > docs/tasks/P3-001-engine-multiscene-spike.md
> git show origin/codex/project-foundation:docs/research/P3-ai-creation-loop-plan.md > docs/research/P3-ai-creation-loop-plan.md
> ```
> 把指南存档进本分支并填写开发记录。
>
> 这是 **P3 预研 spike**：只新增 `spikes/p3-multiscene/**` 与文档，**不改已验收的 `packages/video-engine-*`**、不碰根插件；HyperFrames 固定 0.8.167，不升级依赖、不跑 postinstall；不调模型 API，AI 重写用受控脚本模拟；不安装/重启 DSH、不改 profile、不 merge main。完成后 commit + push 更新 PR #2。
>
> 必须回答：Q1 多 Scene 权威表示（嵌套 composition / 单文档多时间线 / 多入口+manifest 三选一，给失败选项证据）；Q2 稳定 ID 与 inspect 扩展；Q3 Scene 创建/替换/删除/重排的可行边界；Q4 Logo+截图素材进入工程并成片；Q5 人工 typed edit + AI 受控重写 Scene 的 stableId 三方合并与显式冲突（最重要）；Q6 操作日志/撤销重做/进程重启后 reopen；Q7 工程创建与 worker 注册的动态方案；Q8 15 秒成片渲染/抽帧/ffprobe/乱序 seek。
>
> 交回：结果 commit、`docs/research/P3-001-engine-multiscene-spike.md`（结论先行、已验证/提案分开）、证据路径与哈希、推荐结构、合并算法、未测项与风险。**不宣称 P3 已实现**；此轮不安装、不 merge、不发布，通过复审后由总调度冻结 P3 契约。
