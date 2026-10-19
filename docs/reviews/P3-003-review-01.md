# P3-003 复审：多 Scene 引擎、创建、合并与历史

日期：2026-10-17。总调度独立复审。结论：**通过（本机受控范围）**，引擎能力可作为 P3-005 编辑器画布与 P3-006 插件创作的契约基础；**附 R1（协议 schema 未更新新方法，必须在下一次引擎交付补齐）**。P3 尚未接入 DSH、未安装，不宣称 AI 创作已可用。

评审对象：`9df968c`（实现）+ `aae05e9`（记录），分支 `codex/p1-engine-spike-b4bf`，PR #2 head `aae05e9…`。

## 独立核对

- **范围**：22 个文件，全部为 `packages/video-engine-{worker,client}/**`、两包测试/README、`docs/**` 与本仓库 `.gitignore`（新增 `artifacts/`）；未改根插件、`spikes/hyperframes`、全局 STATUS/DECISIONS/DEVELOPMENT；工作树干净，远程一致。
- **版本/导出**：worker 与 client 均 `0.2.0`；worker `./worker`/`./package.json`、client 根入口保持 P2-003 契约；根包依赖未新增。
- **测试（独立复跑）**：worker `npm test` **17/17**（11.1s）；worker `npm run test:real` **9/9**（155.0s，含原 3 real + P3 集成 + 15s 渲染/取消）；client `npm test` **16 pass + 1 opt-in skip / 17**（exit 0）。复跑耗时高于开发者记录（85.7s），属本机负载差异，不作为性能结论。
- **固定包**（`artifacts/engine/9df968c/`，ignored）：
  - client `0.2.0`：6,835 B / 3 files，SHA-256 `6b3d559c65f4a0dd2cb4fcfc48ff23c3ed67f7c990e8dda9ca7b15cc9f32614e`；
  - worker `0.2.0`：35,011 B / 12 files，SHA-256 `59e3ee6810ee22c7724f73602f0ce85a33a2819a68d0fc30c016dc95b695c3b7`；
  - 解包后**逐文件与 `9df968c` 字节一致**（client 3/3、worker 12/12），`package-verify.json` 记录一致。
- **真实证据**：`ai-project-15s.mp4` 264,650 B、SHA-256 `87a3d4184b09d6de891369906a21fdd57eb9fcaa209f5de19b34fb0574be10ef`；独立 ffprobe **H.264 / 1280×720 / 30fps / 450 帧 / 15.000000s**；`frame-6s.png` 20,384 B、SHA-256 `4728e847…`；工程快照 4 个 Scene（5+4+4+2=15s）、`hf-main` + `scene-N-section`；证据覆盖 create/scenes/asset/revise/冲突/history/undo/redo/render/cancel，与研究报告一致。
- **契约落地**：单 HTML + Scene 区段 + master timeline、`project.create`、`asset.import`、inspect `scenes[]`、scene 四操作、`project.revise` stableId 三方合并、history/undo/redo 均按 P3-003 指南实现；`StaticGuard` 初始 opacity 警告已消除（CLI lint errorCount 0）。

## 契约差异（接受并冻结，供 P3-005/006 使用）

1. `project.create` 初始 1 个默认 5s Scene（指南未定初始数量），fps 仅 30（渲染管线）。P3 样例为 15s/30fps，可接受；fps 扩展另立任务。
2. `project.revise` 冲突以**成功 result** `{written:false, conflicts[]}` 返回（非 `E_CONFLICT`），便于返回完整清单。**Host/Client/Tool 必须按 `written === false` 处理冲突，不得当作普通失败重试**。
3. `asset.import` 只记 history op，不进可 undo 内容链（v1 限制）；`undo` 跨资产变化时 revision 可能不等于历史 entry 中记录的内容哈希——**调用方必须使用接口返回的 revision，不得用历史 entry.revision 做相等判断**。
4. `inspect.scenes[].elements` 不含 section/root；顶层 `elements[]` 保持全量。
5. `.gitignore` 新增 `artifacts/` 超出任务文件白名单，但为固定包/证据 ignored 所必需，接受。

## R1（必须在 P3-005 接线前补齐）

`packages/video-engine-worker/protocol.schema.json` 仍是 P2 方法集（doctor/open/inspect/edit/frame/render/status/cancel/close/shutdown），**未包含 P3 新增的 project.create/asset.import/scene.*/project.revise/history/undo/redo**；而该文件随 0.2.0 包发布。README 已更新，但 schema 与实际协议不一致，属契约产物缺口。要求：补 schema（新方法 params/result 结构或明确声明 scope）+ 验证与 worker 校验一致，重新打 0.2.1 包。

## 非阻塞观察

1. **registry 失败恢复**：`project.create` 在 `addProjectToRegistry` 成功后若 `open`/`ensureHistory` 失败，catch 会删除工程目录但**不删除 registry 条目**；下次启动 `loadManagedRegistry` 对缺失目录报 `E_CONFIGURATION`，worker 无法启动。概率低但建议在 P3-004 顺手修（失败时移除 registry 条目或调整注册顺序）并补测试。
2. **redo 分支快照不清理**：新编辑截断 redo 分支后，旧快照文件保留在磁盘（不计入限额统计），长期编辑有存储增长；v1 可接受，建议后续清理。
3. **原子写无 fsync/readback**：`atomicWrite` 为临时文件 + rename；崩溃持久性未验证（rename 原子性足够防止半写文件）。
4. **history 写失败语义**：内容写成功后 history 写失败会向调用方报错但内容已变更，未标记 `uncertain`；v1 记录为已知限制。
5. `nested_structure_needs_subcomposition` lint warning 仍保留（B 结构本身，errorCount 0）。
6. 未验证：真实 DSH Host/安装、UI/AI 端到端、跨进程多写者、崩溃恢复、Windows/其它 Chrome/FFmpeg、连续 Studio 播放；15s 渲染 18.2s、frame 4.0s 为本机单次观测。

## 下一步

1. 下发 **P3-004：协议 schema 补齐（R1）+ engine preview snapshot**（程序员 1，小任务，两包升 0.2.1）——snapshot 是编辑器画布（A1）的后端前提：按 `projectId + revision` 生成只读私有快照（entry+资产 manifest/hash/TTL/清理），Host 只按 snapshotId 提供精确资产路由。
2. 通过后下发 **P3-005 编辑器画布 v1**（程序员 2）：sandbox iframe + 播放/seek + 画布点选 + 选中描边 + 目标联动。
3. 再下发 P3-006 插件创作流程/AI 上下文/冲突 UI，P3-007 端到端 15 秒 AI 样例；P2-006 仍等待程序员 2 回交。
