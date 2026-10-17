# P3-004：协议 schema 补齐（R1）+ 引擎预览快照（engine preview snapshot）

> 2026-10-17 总调度下发，依据 [P3-003 复审](../reviews/P3-003-review-01.md) R1 与编辑器画布前置需求（D023/D024）。小任务，引擎侧。用户已授权正常 feature push/草稿 PR（D016）；安装/启停/重启/merge 不授权。

执行：**程序员 1**；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`，开工 HEAD `aae05e9`。若已变化先报告实际 HEAD。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、[P3-003 复审](../reviews/P3-003-review-01.md)、P3-001 spike 研究记录（sandbox/快照结论）。
2. 确认工作树干净；把本指南存档为本分支 `docs/tasks/P3-004-engine-preview-snapshot.md` 并填开发记录。
3. 指南从协调分支取（`git fetch origin` 后 `git show origin/codex/project-foundation:docs/tasks/P3-004-engine-preview-snapshot.md`），不切换分支。

## 1. 边界

- 允许修改：`packages/video-engine-worker/**`、`packages/video-engine-client/**` 及其测试/README/protocol.schema.json、`docs/research/P3-004-*.md`、本任务记录。
- 不要修改：根插件、`spikes/**`、全局规则/STATUS/决策、其它 worktree；不改 profile、不安装/启停/重启、不 merge；HyperFrames 固定 0.8.167；不调模型 API。
- 两包升 **0.2.1**；现有 0.2.0 方法与测试不回归（P2/P3-003 语义保持）。

## 2. R1：补齐协议 schema（必须）

- `protocol.schema.json` 补上 P3-003 新增方法：`project.create`、`asset.import`、`scene.create`、`scene.update`、`scene.remove`、`scene.reorder`、`project.revise`、`history`、`undo`、`redo`，以及本任务新增的预览快照方法；params/result 结构与 worker 实际校验一致（严格 keys、类型、范围）。
- 若 schema 体量/复杂度需要，可拆 `$defs` 复用；保持 draft 2020-12、`$id` 稳定。
- README 中方法表与 schema 对齐；新增一致性测试（可静态/结构测试），防止再次漂移。

## 3. 预览快照 API（编辑器画布后端前提）

设计目标：让插件能拿到"某个 revision 的只读工程快照（entry + 声明资产）"，在 sandbox iframe 中本地渲染、播放/seek；**预览面不接受任意 path/URL，Host 只按 snapshotId 提供精确资产**。

新增方法（名称可微调但语义固定）：

- `preview.snapshot {projectId, revision, ttlMs?}`：
  - 仅对已 open 的工程；`revision` 必须等于当前 revision（过期返回 `E_REVISION_CONFLICT`，不猜最新）。
  - worker 将 entry + `project.json` 声明的全部资产（含 gsap）复制到 **worker 私有 preview 根**（`outputRoot/previews/<snapshotId>/`，`snapshotId` 由 worker 生成、不可预测），复制后重算字节/哈希并与 `read()` 清单核对。
  - 返回 `{snapshotId, projectId, revision, entry, files:[{path,bytes,sha256}], expiresAt, maxBytes}`；**只给相对路径，不含绝对路径/URL**。
  - 限额：快照总字节 ≤128MiB、文件数沿用 manifest 上限；超限 `E_LIMIT`。
  - 同一 revision 可复用已有未过期快照（可选优化，但必须返回一致 manifest）。
- `preview.release {snapshotId}`：幂等删除快照目录；未知/已过期返回明确错误码（`E_SNAPSHOT_NOT_FOUND`）。
- 生命周期：TTL（默认 10 分钟、上限 30 分钟）到期清理；`close` 工程/`shutdown`/worker 退出时清理全部快照；清理失败不发布半成品、记录诊断。
- 快照只读、不在工程 revision 内、不可用于 edit/revise；worker 是唯一复制者；Host 只读。

错误码：`E_SNAPSHOT_NOT_FOUND`（未知/过期）、`E_REVISION_CONFLICT`、`E_LIMIT`、`E_PROJECT_NOT_FOUND`、`E_PERSIST` 等；结构化同现有。

## 4. 顺手修复（P3-003 复审观察 1）

`project.create` 在 registry 写入成功后若后续 `open`/`ensureHistory` 失败：删除工程目录时同步移除 registry 条目（或调整顺序使 registry 最后写），避免下次启动因缺失目录 `E_CONFIGURATION`；补故障注入测试。

## 5. 测试与交付

1. 单元/契约：schema 与 worker 方法一致；快照 manifest/hash/相对路径；过期/TTL/release/shutdown 清理；revision 过期拒绝；路径/符号链接越界拒绝；限额。
2. 真实链（worker）：create → inspect → `preview.snapshot` → 校验 `files[]` 与磁盘字节/hash → 修改工程后旧快照仍可读且 revision 不变 → `preview.release` 清理 → 关闭/重启后清理；现有 17 + 9 测试不回归。
3. client：新增 `previewSnapshot`/`previewRelease` 方法测试；16+1 不回归。
4. 交付：commit + push 更新 PR #2；两包 **0.2.1** 固定 tarball `artifacts/engine/<commit>/`（记录大小/文件数/SHA-256）；`docs/research/P3-004-engine-preview-snapshot.md`；真实链证据（快照 manifest、字节 hash、TTL/release/清理）；不安装、不 merge。
5. 交回：commit、测试数字、schema 差异、快照 API 契约与证据、包摘要、未测项、风险。

## 6. 验收（总调度）

- 独立复跑两包测试；核对 0.2.1 包字节与 commit；schema 与 worker 校验一致。
- 重点核：快照不可变、路径包含、TTL/release/shutdown 清理、revision 语义、与既有 P2/P3 方法无回归。
- 通过后下发 P3-005 编辑器画布（Host 精确资产路由 + sandbox iframe + 播放/seek + 画布点选/描边）。

## 开发记录（程序员 1）

（待填写：起始 HEAD、提交、schema 变更、快照 API、测试数字、包摘要、证据、未测项）
