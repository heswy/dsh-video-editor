# P3-003 多 Scene 工程、修订合并与历史（引擎实现）

日期：2026-10-17。执行：程序员 1；工作树 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`；开工 HEAD `cf24842`（P3-001 已验收），实现提交 **`9df968c`**（`feat(engine): implement P3 multi-scene projects, merge and history`），本文与任务记录另以 docs 提交提交并 push 更新 [PR #2](https://github.com/heswy/dsh-video-editor/pull/2)。只改 `packages/video-engine-worker/**`、`packages/video-engine-client/**` 及其测试/README、任务/研究记录；未改根插件、`spikes/**`、全局规则/STATUS/决策；未改 profile、未安装/启停/重启 DSH、未 merge main；HyperFrames 固定 0.8.167，未升级依赖、未运行 postinstall；AI 候选由模板生成器模拟，未调模型 API。Phase A（工程/Scene/inspect/素材/历史/render）与 Phase B（revise 合并）合并在同一实现提交中交付，因为两者共享 Scene 模型/历史/写入路径，分开提交会产生不可独立验证的中间态；两者均已按契约独立测试。

## 结论（contract 落地摘要）

- worker 与 client 升 **0.2.0**；生成器、managed projectsRoot/registry、`project.create`、`asset.import`、`inspect.scenes[]`、`scene.create/update/remove/reorder`、`project.revise`（stableId 三方合并 + 冲突码）、`history/undo/redo`（单调 historyCursor）、真实 15 秒 H.264 渲染全部落地并本机验证。
- 生成器：`product-launch-v1` 单 HTML + Scene section + master timeline；Scene 局部时间生成时换算全局 `data-start`；所有 section 内联 `opacity:0` 并由 timeline 在 0s reveal 第一个 Scene，CLI lint **errorCount 0** 且不再出现 `StaticGuard` 初始 opacity 警告（仍保留 4 条 `nested_structure_needs_subcomposition` warning，属 B 结构已知观察，详见“限制”）。
- 写入：所有 Scene 结构操作与 revise 先由 SDK 重开校验（尺寸/时长/Scene 集合/ID 唯一/时间边界），再临时文件 + rename 原子写，失败不发布；`expectedRevision`/`operationId` 单写者队列与幂等缓存沿用 P2 机制。
- 合并：base/current 相同则直接模板写入；不同则从 `.dsh-video/history/snapshots/<revision>.html` 取 base，stableId 三方合并，冲突返回 `written:false + conflicts[{sceneId,stableId,reason,human,ai}]` 且不写盘；目标 Scene 之外逐字节不变；base 快照缺失返回 `E_BASE_MISSING`。
- 历史：`.dsh-video/history/`（entries/ops/snapshots/state），revision 仍为内容哈希；historyCursor 单调递增，undo/redo 恢复旧内容并新增 action，重启持久；历史不进 manifest/revision。
- 真实 15s 链：worker `create → scene ×3 → asset.import → inspect(scenes) → revise → 冲突 → history/undo/redo → frame → render → cancel` 全部通过；MP4 H.264 1280×720/30fps/450 帧/15.000s，ffprobe 与包字节见下。

## 契约落地与差异

| 契约（P3-003 指南） | 落地 | 差异/说明 |
|---|---|---|
| 2.1 单 HTML + section + timeline；Scene 1–12、0.5–60s、总 ≤3600s；模板 `product-launch-v1` | `src/scenes.mjs`：生成/解析/校验；固定模板；`inspect` 与所有写路径都从 HTML 派生 Scene 模型 | `project.create` 的初始工程包含 **1 个默认 5s Scene**（指南未指定初始 Scene 数；后续 `scene.*` 增删）；fps 仅支持 30（渲染管线固定 30） |
| 生成时消除 StaticGuard | section 内联 opacity:0，timeline 在 0 reveal scene-1；CLI lint 无 StaticGuard 警告 | 仍保留 `nested_structure_needs_subcomposition` warning（section 内含一层元素是 B 结构本身）；errorCount 0 |
| 2.2 worker 管理 projectsRoot + 持久 registry；启动 reload；`project.create` | 新配置模式 `{projectsRoot, registryPath, outputRoot, assetInboxRoot?, browserPath?}`；registry `{projects:{id:dir}}` 原子写、启动 reload、realpath 包含校验；旧 `{root,projects,outputRoot}` 静态模式保留（P2 不回归） | registry 由 worker 独占写；Host 直接替换文件不会被运行中 worker 读取 |
| `project.create` 生成 projectId、模板、素材、原子 registry | 生成 `proj-<base36 time>-<8 hex>`；复制 gsap.min.js 与 inbox 素材；失败清理目录；返回 projectId/revision/scenes | 输入 `assets` 项字段 `{inboxName,name?,mediaType?}`；初始 manifest 含 `assets/gsap.min.js` |
| `asset.import` 只读 inbox、PNG/JPEG、≤8MiB、≤16 资产/≤64MiB | `src/registry.mjs`；拒绝路径穿越/符号链接逃逸/非图片签名/超限；先写资产再原子更新 manifest，失败回滚 | 资产按图片数 ≤16，声明资产总字节 ≤64MiB；asset.import 在历史中只记 op（不进入可 undo 内容链，v1 限制） |
| 2.3 inspect 追加 scenes[]，旧字段不变 | `inspect` 增加 `scenes`，元素增加 `sceneId`；非模板旧工程（P2 fixture）保持无 scenes 的旧形状 | scenes[].elements 只含 Scene 内元素（不含 section/root）；顶层 `elements[]` 仍含全部 SDK 元素 |
| 2.4 scene.create/update/remove/reorder | `Projects.sceneOperation`：读取→派生 Scene 模型→重生成文档→SDK 校验→原子写→revision 重算→history；operationId 幂等 | `scene.update` 的 template 不允许带 sceneId；`scene.create` 可带 sceneId 或由 worker 生成 `scene-N`；`afterSceneId` 定位插入；`scene.reorder.order` 必须恰好包含全部 sceneId |
| 2.5 project.revise | 见“合并算法”；冲突码齐全；`base===expected` 直接写入；否则历史快照三方合并 | 冲突按成功 result `{written:false,conflicts}` 返回（不抛 E_CONFLICT，便于返回完整清单）；`E_BASE_MISSING` 为错误；Scene duration/order 变化返回 `SCENE_META_CHANGED` 并要求显式 scene 操作 |
| 2.6 history/undo/redo | `src/history.mjs`：entries/ops/snapshots/state；historyCursor 单调；revision 仍内容哈希；重启持久；上限 64 条/8MiB | undo 恢复旧内容→revision 回到旧哈希（D021）；历史只记录内容写操作 + asset op；`history` 返回 limit（默认 20，最大 64） |
| 现有 P2 方法不回归 | open/inspect（旧字段）/edit/frame/render/status/cancel/close 语义与测试保持；`edit` 成功写入现在同时记历史 | 历史上限与操作缓存仍在内存；operationId 缓存 2048 条随进程重启丢失（与 P2 一致） |

## API 表（0.2.0 JSONL v1）

| 方法 | 参数 | 结果/语义 |
|---|---|---|
| `project.create` | `{templateId,title?,width?,height?,fps?,assets?}` | `{projectId,templateId,revision,width,height,fps,scenes}`；worker 生成 id、原子 registry |
| `asset.import` | `{projectId,expectedRevision,operationId,sourceName,name?,mediaType?}` | `{projectId,revision,asset:{path,name,bytes,sha256,mediaType},assets,historyCursor}` |
| `scene.create` | `{projectId,expectedRevision,operationId,sceneId?,afterSceneId?,template}` | `{projectId,revision,scenes,changeSummary,historyCursor}` |
| `scene.update` | `{projectId,expectedRevision,operationId,sceneId,template}` | 同上 |
| `scene.remove` | `{projectId,expectedRevision,operationId,sceneId}` | 同上（至少保留 1 个 Scene） |
| `scene.reorder` | `{projectId,expectedRevision,operationId,order:[sceneId...]}` | 同上，重新计算 start |
| `project.revise` | `{projectId,baseRevision,expectedRevision,operationId,sceneId,template}` | 成功 `{written:true,revision,changeSummary,scenes,historyCursor}`；冲突 `{written:false,revision(unchanged),conflicts:[{sceneId,stableId,reason,human,ai}],unsupported?}` |
| `history` | `{projectId,limit?}` | `{revision,historyCursor,cursor,canUndo,canRedo,entries,ops,snapshotBytes,maxEntries,maxSnapshotBytes}` |
| `undo`/`redo` | `{projectId,expectedRevision,operationId}` | `{projectId,revision,historyCursor,restored:{historyCursor,revision,actor,kind,sceneId,summary}}` |
| `inspect`（扩展） | 不变 | 旧字段 + `scenes:[{sceneId,order,start,duration,elements:[{stableId,sceneId,text,timing,capabilities}]}]` |
| `doctor` | 不变 | 旧字段 + `templates:["product-launch-v1"]` |

错误码新增/沿用：`E_TEMPLATE`、`E_SCENE_NOT_FOUND`、`E_BASE_MISSING`、`E_CONFIGURATION`、`E_REVISION_CONFLICT`、`E_OPERATION_REUSED`、`E_PARAMS`、`E_PATH`、`E_LIMIT`、`E_PROJECT_NOT_FOUND`、`E_ASSET_MISSING`、`E_PERSIST`、`E_JOB_NOT_FOUND` 等；冲突 reason：`BOTH_MODIFIED`、`AI_DELETE_HUMAN_MODIFY`、`HUMAN_DELETE_AI_MODIFY`、`ADD_ADD`、`SCENE_META_CHANGED`、`STRUCTURAL_TAG`、`STRUCTURAL_PARENT`、`STRUCTURAL_NESTING`、`STRUCTURAL_OTHER_SCENE`、`STRUCTURAL_ORDER`。

## 合并算法（实现）

1. `expectedRevision !== 当前` → `E_REVISION_CONFLICT`；`baseRevision === 当前` → 从当前 Scene 模型替换目标 Scene 后生成、校验、写入（无人工改动路径，冲突为空）。
2. 否则从 `.dsh-video/history/snapshots/<baseRevision>.html` 载入 base（缺失 → `E_BASE_MISSING`）；校验 base 中存在目标 Scene 且 duration 未变（变化 → `SCENE_META_CHANGED` 冲突，不写盘）。
3. 由 base 的 Scene 模型替换目标 Scene 生成 AI 候选文档；比较 base/AI/current 的目标 Scene meta 与整体 Scene 顺序；AI 修改目标 Scene 之外任何 Scene → `STRUCTURAL_OTHER_SCENE`；Scene 顺序变化 → `STRUCTURAL_ORDER`。
4. 元素级三方合并（stableId）：no change→保留；仅人工改→人工；仅 AI 改→AI；双方改且相同→该值；双方改不同→`BOTH_MODIFIED`；AI 删除且人工已改→`AI_DELETE_HUMAN_MODIFY`；人工删除且 AI 已改→`HUMAN_DELETE_AI_MODIFY`；新增冲突→`ADD_ADD`；tag/parent/depth 结构变化→`STRUCTURAL_*`；纯删除造成的兄弟顺序位移不算冲突。
5. 合并结果只序列化目标 Scene section 并替换到 current 文档中；其它 Scene 逐字节断言不变；整文档 SDK 校验；原子写；记录 history（actor `ai`）。冲突时不写盘并返回完整冲突清单。

## 生成器与 StaticGuard

- Scene section 内联 `opacity:0`，master timeline：`tl.set("#scene-1",{opacity:1},0)`、后续 Scene 在 start reveal、前一 Scene 在 end hide、标题/底线动画从全局 start 开始；`tl.seek(0)` 确保初始帧确定。
- `hyperframes lint`（0.8.167，CLI）实测 **errorCount 0**，无 `StaticGuard`/`starts visible before its first GSAP opacity tween`；仍报告 4 条 `nested_structure_needs_subcomposition` warning（section 内一层对象，是 D020 结构本身；不阻塞渲染，已在测试中断言无 StaticGuard 且无 error）。
- 字体使用 `sans-serif` 系统栈，不向 Git/工程打包字体；Chrome 在本机渲染中文字形（真实帧可见文字）。

## 验证数字

| 项 | 命令 | 结果 |
|---|---|---|
| worker 单元/协议 | `npm test --prefix packages/video-engine-worker` | **17/17 通过**（7 项原 P2 + 10 项新生成器/合并），约 4s |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **9/9 通过**，约 85.7s（原 3 项 real + 5 项 p3.integration + 1 项 15s 多 Scene 渲染/取消） |
| client | `npm test --prefix packages/video-engine-client` | **17 项：16 pass + 1 个 opt-in skip**，约 16.8s（含新 p3 client 方法测试与打包测试） |
| 真实 15s 渲染 | worker `render`（证据见下） | `succeeded` 18172ms，H.264 1280×720 30fps **450 帧 / 15.000000s**；frame 6s 3995ms；取消 ack `cancelling` → `cancelled`，artifact `null` |
| 真实历史 | 上述证据 | historyCursor 8、entries 6、snapshotBytes 27158；undo → 旧 revision、redo → 新 revision；重启后 undo 通过（p3.integration 覆盖） |
| 真实冲突 | 上述证据 | `BOTH_MODIFIED` on `scene-2-title`，返回双方摘要，`written:false`，revision 未变 |

## 固定包（`artifacts/engine/9df968c/`，ignored artifacts）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.2.0.tgz | 3 | 6835 | `6b3d559c65f4a0dd2cb4fcfc48ff23c3ed67f7c990e8dda9ca7b15cc9f32614e` |
| dsh-video-engine-worker-0.2.0.tgz | 12 | 35011 | `59e3ee6810ee22c7724f73602f0ce85a33a2819a68d0fc30c016dc95b695c3b7` |

按 `package-verify.json` 用 `git show 9df968c:<path>` 逐文件核对：两包内每个文件（含 README/package.json/src/*.mjs/protocol.schema.json）与提交字节 **全部一致**；client exports/根入口、worker `./worker` 与 `./package.json` 保持 P2-003 契约。包由 `npm pack --pack-destination artifacts/engine/9df968c` 生成，未安装、未发布。

## 真实链证据（本机 artifacts，gitignored）

目录 `artifacts/engine/9df968c/evidence/`：

- `p3-003-evidence.json`：完整 JSON 证据（项目/Scene/revision、revise/冲突、history/undo/redo、frame/render/cancel、包摘要与逐文件匹配）。
- `ai-project-15s.mp4`：264,650 B，SHA-256 `87a3d4184b09d6de891369906a21fdd57eb9fcaa209f5de19b34fb0574be10ef`（H.264 1280×720/30fps/450 帧/15.000s）。
- `ffprobe.json`、`frame-6s.png`（20,384 B，SHA-256 `4728e8471b978238e5dabb51aa0fc876c830c1ecddabd2bf1665a7c4df065f42`）。
- `project/`：生成工程 `index.html` + `project.json` + `assets/` 快照（gsap+导入素材）。

环境：Node v24.14.0、hyperframes/sdk 0.8.167、GSAP 3.15.0、Chrome 155.0.8059.79、ffmpeg/ffprobe 8.0.1、macOS arm64。

## 限制与未验证

- 未接入真实 DSH Host、未安装/启停/重启/改 profile；没有真实模型调用、没有 UI/AI 端到端样例（P3-004/P3-005 范围）。
- 模板生成器只支持 `product-launch-v1` 固定元素集合（一层、无嵌套）；任意 Agent HTML/JS 仍视为不可信，未增加沙箱/网络/文件边界；通用 DOM 合并不在本轮。
- 合并只覆盖模板一层元素与已知属性；结构变化（tag/parent/嵌套/场景时长顺序）按契约显式冲突，需显式 scene 操作或人工协调。
- `asset.import` 不进入 undo 内容链（只记 history op）；撤销跨资产变化的 revision 语义未验证（v1 限制）。
- 单 worker 单写者、内存 operationId 缓存；跨进程/多写者并发、跨重启幂等恢复未验证；registry 依赖 worker 独占写，Host 直接改文件不会被运行中 worker 加载。
- 历史 64 条/8MiB 裁剪只按内容 revision 快照估算；大规模素材变化、长时间编辑的历史容量未压力测试。
- 15s 渲染 18.2s、frame 约 4.0s 属本机单次观测，不是性能承诺；取消清理时间随渲染进度变化。
- 未测 Windows/其它平台（worker 启动仍要求 POSIX）、其它 Chrome/FFmpeg 版本、连续 Studio 播放 UI、真实 DSH 路由/Tool；`nested_structure_needs_subcomposition` 仍是已知 lint warning。
- 本轮未修改根插件，也未把 `video_engine` Hot 端接入新方法；程序员 2/P3-004 需按本契约接线。
