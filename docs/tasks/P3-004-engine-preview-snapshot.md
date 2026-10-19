# P3-004：协议 schema 补齐（R1）+ 引擎预览快照（engine preview snapshot）

> 2026-10-17 总调度下发，依据 [P3-003 复审](../reviews/P3-003-review-01.md) R1 与编辑器画布前置需求（D023/D024）。小任务，引擎侧。用户已授权正常 feature push/草稿 PR（D016）；安装/启停/重启/merge 不授权。

执行：**p1-engine**；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`，功能基线 `aae05e9`。工作树整理的 AGENTS 文档提交可使 HEAD 前移，报告实际 HEAD 与功能差异；不 reset。

> 产品同步：用户已确认 v0.3 左画布直接编辑、右 AI 常驻，移除底部场景卡片。本引擎任务范围不变；本文件是当前有效任务，旧人员编号交接仅作历史。

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

## 开发记录（p1-engine）

填写：2026-10-17。本轮按本指南执行；指南与全局规则均通过 `git show origin/codex/project-foundation:<路径>` 读取，使用的协调记忆提交为 **12f9952**（开工 fetch 后的 `codex/project-foundation`）。未切换分支、未 merge、未 reset。

### 起点与提交

- 工作树：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`（PR #2）。
- 功能基线 `aae05e9`；开工 HEAD **`929ff37`**（相对功能基线只多一个 AGENTS 入口文档提交，未 reset）。
- 实现提交：**`5cc3ad8b400862be58b0e95b0a9c30c1533fd170`**（`feat(engine): complete protocol schema and add preview snapshots`），独立复核后补强 **`df4b74f7b2410c37898f33d8c2d8c90f3505411e`**（`fix(engine): harden preview privacy and schema path rules`）。固定包/证据按 `df4b74f`；本记录与研究记录另行提交。
- 改动范围：只改 `packages/video-engine-worker/**`、`packages/video-engine-client/**` 及测试/README/`protocol.schema.json`、本任务与研究记录；未改根插件、`spikes/**`、全局规则/STATUS/决策；未改 profile、未安装/启停/重启、未 merge；HyperFrames 固定 0.8.167，依赖/锁文件未变。

### R1：协议 schema 补齐

- `protocol.schema.json` 由 P2 的 10 方法扩为 **22 方法 / 85 个 `$defs`**：doctor、open、inspect、edit、frame、render、status、cancel、close、shutdown、project.create、asset.import、scene.create/update/remove/reorder、project.revise、history、undo、redo、preview.snapshot/release。
- 每个方法有严格 params（`additionalProperties:false`、required、类型/长度/范围/pattern、scene template 模型、`order` 唯一、revision 64-hex、snapshotId 32-hex）与独立 result 定义；draft 2020-12、`$id` 保持 `urn:dsh-video-engine-worker:v1`。响应帧不带 method，顶层 `x-methods` 提供 method → request/result 指针，供测试与消费方定位。
- 新增 `test/schema.test.mjs` + 最小 draft 2020-12 子集校验器：强制 schema 方法集 == `src/worker.mjs` switch 方法集、README 方法表同步、全部 `$ref` 可解析；对 22 个方法各做“缺必填字段/多传未知字段”双向探针，并校验真实成功/失败响应（含 merge 冲突 `written:false` 与 job 失败态结果）。
- 对齐校验时消除三处隐藏漂移：`project.create.templateId` 必填且仅受控模板（`E_TEMPLATE`）；`width`/`height` 必须整数；`scene.update`/`project.revise` 嵌套 template 不再静默接受 `sceneId`（返回 `E_PARAMS`）。README 已同步。

### 预览快照 API

- 新增 `src/previews.mjs` 与 worker/client 方法：`preview.snapshot {projectId, revision, ttlMs?}` → `{snapshotId, projectId, revision, entry, files:[{path,bytes,sha256}], expiresAt, maxBytes}`；`preview.release {snapshotId}` → `{snapshotId, projectId, revision, released:true}`。
- 仅 open 工程；revision 必须等于当前（过期/竞争 `E_REVISION_CONFLICT`）；worker 复制到私有 `outputRoot/previews/<snapshotId>/`（32-hex 随机 id），复制后重读磁盘核对字节/`sha256`/原始字节与 `read()` 清单，一致才发布；只返回相对路径。
- 限额：文件数沿用 manifest 上限（65）、总字节 ≤128 MiB，超限 `E_LIMIT`；TTL 默认 600000 ms、上限 1800000 ms、最小 100 ms；`close`/`shutdown`/EOF/SIGINT/SIGTERM/未捕获异常与启动 sweep 清理；未知/过期/重复 release 返回 `E_SNAPSHOT_NOT_FOUND`；`previews/` 目录懒创建（从未请求快照的 worker 不会新建它），但启动 sweep 会删除上一进程可能遗留的该目录。快照只读、不进 revision/history、不可 edit/revise；同 revision 复用为未实现的可选项。
- client 新增 `previewSnapshot`/`previewRelease`（`src/index.mjs`），只做请求转发，不读工程、不缓存 revision。
- 独立复核后补强：私有预览目录/快照目录以 `0700` 创建（纵深防御）；schema 纳入路径/名称形态（inbox 文件名、ASCII 图片资产名、相对路径）并加对应负向探针；修正文档中旧 schema 方法数与“无语义变化”的过度声明。

### 顺手修复（复审观察 1）

`project.create` 改为 registry 最后写：先建目录/素材、临时内存映射、`open`+`ensureHistory`，最后写 registry；任何一步失败删除目录、内存映射与 handle，registry 保持原样。`test/create-recovery.test.mjs` 3 项故障注入（`open` 失败、registry 写入失败、协议层失败后重启）均通过，重启不再出现 `E_CONFIGURATION`。

### 测试数字

| 项 | 命令 | 结果 |
|---|---|---|
| worker 单元/契约 | `npm test --prefix packages/video-engine-worker` | **29/29**（原 17 + schema 2 + 预览 7 + 创建恢复 3），约 10.8s |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **10/10**（原 9 + 预览真实链 1），约 102.7s |
| client | `npm test --prefix packages/video-engine-client` | **19 项：18 pass + 1 opt-in skip**（原 17 + 预览 2），约 49.2s（早前 28.3s，负载差异） |
| 预览真实链证据 | `artifacts/engine/df4b74f/evidence/preview-chain.txt` | manifest 相对路径、磁盘字节/hash 全匹配、旧快照不可变、过期/释放/close/重启 sweep 全通过 |

现有 P2/P3-003 方法与测试无回归；新增测试覆盖 schema 一致性、快照 manifest/hash/相对路径、过期/TTL/release/close/shutdown/重启清理、revision 过期拒绝、路径/符号链接越界、限额与清理失败重试。

### 固定包（`artifacts/engine/df4b74f/`，ignored）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.2.1.tgz | 3 | 7297 | `59e31cf9ba503a515d89712758b713054487ad2a131412db8908409ab6545fee` |
| dsh-video-engine-worker-0.2.1.tgz | 13 | 43930 | `ea7374d4555e70264c9c40d710ef9a331ff4e0311e840d1359615356b081c775` |

`package-verify.json`：两包逐文件与 `df4b74f` 字节一致、重复 pack 字节一致；未安装、未发布。

### 未测项与风险（交回复审用）

- 未接入 Host、未安装、未做真实页面/画布；快照在 sandbox iframe 的播放/seek、Host 精确资产路由属 P3-005。
- 快照只验证到 engine 文档解析器可消费；未做浏览器渲染/连续播放、未做 >128 MiB 真实工程压力测试（现由 `read()` 与直接构造 manifest 的 guard 测试覆盖）。
- SIGKILL/断电/未 fsync：遗留私有目录只能靠下次启动 sweep 清理；清理失败仅固定阶段诊断，release 可重试。
- 同 revision 快照复用未实现；快照路径校验不是安全沙箱，Host 仍需自行约束 iframe 与资产访问。
- README 与 schema 的方法/结果描述以 0.2.1 为准；如需进一步收紧配额或增加 Host 读取方法，应在 P3-005 另立契约。
