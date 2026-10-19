> 历史交接：当前接手请读协调分支 [工作区索引](README.md)。本文件保留当时路径、称呼和任务状态，不作为当前开工指令。

# 交接：程序员 1 → P3-004

日期：2026-10-17。P3-003 复审通过后的引擎小任务。用户把下方提示粘贴给程序员 1 即可。

## 工作树恢复说明（2026-10-17）

原自动工作树随对话归档移除；归档 snapshot 与 `aae05e9` 一致，已按用户授权在下述新目录恢复原分支。worker/client 已分别按锁文件 `npm ci --ignore-scripts`；恢复基线测试 worker 17/17，client 16 pass + 1 opt-in skip，无失败。旧忽略产物未宣称恢复；两包测试已生成新的本地产物。新树内全局文档仍是开发分支历史版本，当前调度/路径规则请通过 `git show origin/codex/project-foundation:AGENTS.md`、`docs/STATUS.md`、`docs/DEVELOPMENT.md` 读取，不 merge 协调分支、不自行改全局规则。

## 给程序员 1 的提示

> P3-003 复审通过：独立复跑 worker 17/17、real 9/9、client 16+1 skip；两包 0.2.0 与提交 `9df968c` 逐字节一致；15 秒 MP4/帧/证据核对通过。有两个收尾项已合成 **P3-004**（小任务，两包升 0.2.1）：
>
> 恢复后的工作目录：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`，开工 HEAD `aae05e9`。先读 AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md、docs/reviews/P3-003-review-01.md，然后执行 P3-004。任务指南从协调分支取（先 `git fetch origin`，不切换分支）：
> ```
> git show origin/codex/project-foundation:docs/tasks/P3-004-engine-preview-snapshot.md > docs/tasks/P3-004-engine-preview-snapshot.md
> ```
> 把指南存档进本分支并填开发记录。
>
> **R1 协议 schema 补齐（必须）**：`protocol.schema.json` 仍是 P2 方法集，缺 `project.create/asset.import/scene.*/project.revise/history/undo/redo`；补齐 params/result 结构并与 worker 校验一致，README 对齐，加一致性测试防漂移。
>
> **预览快照 API（编辑器画布后端前提）**：`preview.snapshot {projectId, revision, ttlMs?}` —— 仅已 open 工程、revision 必须等于当前（过期 `E_REVISION_CONFLICT`）；worker 把 entry + 声明资产复制到私有 `outputRoot/previews/<snapshotId>/`，重算字节/哈希并与 read() 清单核对，返回 `{snapshotId,projectId,revision,entry,files:[{path,bytes,sha256}],expiresAt,maxBytes}`（只给相对路径）；总字节 ≤128MiB；TTL 默认 10 分钟/上限 30 分钟，close/shutdown/退出清理；`preview.release {snapshotId}` 幂等；`E_SNAPSHOT_NOT_FOUND`。快照只读、不进 revision、不可 edit/revise；Host 只读。
>
> **顺手修**：`project.create` 在 registry 写入成功后若 open/ensureHistory 失败，删除目录时同步移除 registry 条目（避免下次启动 `E_CONFIGURATION`），补故障注入测试。
>
> 范围：只改 `packages/video-engine-worker/**`、`packages/video-engine-client/**` 及测试/README/schema、本任务/研究记录；不动根插件、spikes/**、全局规则；不改 profile、不安装/启停/重启、不 merge；HyperFrames 固定 0.8.167；不调模型 API。
>
> 交付：client 新增 `previewSnapshot`/`previewRelease` 方法；两包 0.2.1；现有 17 / 9 / 16+1 测试不回归；新增 schema 一致性、快照 manifest/hash/相对路径、过期/TTL/release/close/重启清理、revision 过期拒绝、路径越界/限额测试；真实链 create→snapshot→校验磁盘字节/hash→修改工程后旧快照仍可读→release 清理；固定 tarball `artifacts/engine/<commit>/`（记录大小/文件数/SHA-256）；研究记录 `docs/research/P3-004-engine-preview-snapshot.md`；commit + push 更新 PR #2（不新开 PR）。
>
> 交回：commit、测试数字、schema 变更、快照契约与证据、包摘要、未测项与风险。本轮不安装、不 merge；复审通过后下发 P3-005 编辑器画布。
