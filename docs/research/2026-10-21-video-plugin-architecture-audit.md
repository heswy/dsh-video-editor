# DSH Video 插件下一大版本预研：只读架构审计（2026-10-21）

> 范围：`next-major-research` worktree，detached HEAD `9b0928e`（origin/main，PR #14 合并提交）。
> 方法：只读代码/磁盘审计 + 只读命令（`git log`、`shasum`、`ls`、`find`、`grep`）；未安装依赖、未渲染、未改任何代码或用户工程。
> 证据约定：`file:line` 为仓库相对路径；「实际磁盘」指本机已安装 staging 的真实文件；无法确认处标「未验证」。
> 相关既有文档：`docs/STATUS.md`（alpha.10 安装与验收事实）、`docs/research/2026-10-17-conversation-embedding-v03.md`、`docs/research/P3-005A-native-conversation-contract.md`。

## TL;DR（≤20 行）

1. **版本事实**：root bundle `0.3.0-alpha.10`（`package.json:3`），engine client/worker 均 `0.4.0`（`packages/video-engine-client/package.json:3`、`packages/video-engine-worker/package.json:3`）。安装态 = `artifacts/p2-b/staging-alpha10-1cceb96/bundle`（`~/.dsh/profiles/desktop/package.json` 的 `link:` 实际指向，已核对）。
2. **需求 5 判断（关键）**：**同一次安装、同样 staging 目录下，DSH 重启后用户工程一定还在**——工程内容在 `projectsRoot`（磁盘），registry 在 `managed/projects.json`，工程↔会话映射在 `session-state.json`，三者都是普通文件且原子写。
3. **但「跨版本」不保证**：`projectsRoot`/`registryPath`/`assetInboxRoot`/`sessionStatePath`/`sessionCwd` 全部位于**按版本新建的 staging 目录内**（`scripts/stage-dev.mjs:294-334`，实际值见 `staging-alpha10-1cceb96/config.json`）。下一版本 staging 换新目录后，新配置指向空 projectsRoot，**用户旧工程不会出现在 UI**，旧工程只留在旧 staging 目录（当前真实用户工程 `proj-mvhecao6-54fd712a`「DS 宣传片」就在其中，最后修改 2026-10-21 13:18）。删除/清理旧 staging 或 `artifacts/` 即真正丢数据。
4. **次要丢失场景**：registry 或某个工程目录不可读会让 bridge 对所有请求返回 `E_CONFIGURATION`（`host/bridge.js:737-762,1341-1347`）；`session-state.json` 损坏会持续报 `E_SESSION_STATE_CORRUPT` 且不自动恢复（`host/session-state.js:140-178`）。二者都是「看不见」而非静默删除。
5. **易失、重启即丢（设计上可接受）**：worker preview 快照（重启即清空）、Host 预览路由表（内存）、Host job 表（内存，重启后旧导出 MP4 文件仍在磁盘但 artifact 下载 404）。**不是**工程内容。
6. **素材现状**：只支持 PNG/JPEG（≤8 MiB/张、≤16 张、≤64 MiB/工程），inbox 是临时目录 + 内存 receipt（TTL 10 分钟）；导入后复制进工程 `assets/` 才是持久的。**视频/音频素材今天在 5 个环节全部被拒**。
7. **音频渲染可行性**：底层 HyperFrames `0.8.167` **已支持** audio 元素/混音/音频诊断，甚至有本地 `tts`（Kokoro-82M）命令（`node_modules/hyperframes/dist/help-7MQDFXVN.js:99`）；卡点全在我们自己的协议层：composition 校验器**明确禁止 `<audio>/<video>/<source>`**（`packages/video-engine-worker/src/composition.mjs:35-46`）、资产导入只收 PNG/JPEG、ffprobe 只验 `v:0`（`jobs.mjs:342-388`）。改 3 处即可打通「音频进片」，但「AI 生成音频」需要新增生成服务/工具（本地模型下载、网络/磁盘/授权均未验证）。
8. **最大改动点**：需求 2（视频/音频轨+剪辑）需要新的时间线数据模型（project schema v2 或 composition 数据属性约定）+ 新的 worker/Host/Tool 动作族 + 左侧时间线 UI；现有 Scene 模型只是 `product-launch-v1` 固定模板（`scenes.mjs:4-13,125-255`），**没有** clip/track 抽象。
9. **UI 插入点**：左侧 `dv-left` 只放 `stageContent()`（`client.js:6002`），顶栏 `dv-topbar`（`:5970`），右侧 `aiPanel()`（`:6004-6021`）；时间线/素材库最自然是左列纵向追加（stage 下方 tab），不宜加第三列——AI 栏宽度公式已把左侧保底锁在 360px（`client.js:554`）。**右侧输入框是宿主原生 Composer**，插件只嵌入 occurrence（`client.js:2505-2510`），@ 引用需宿主能力或新通路上报（见 §7）。
10. **测试门禁**：`npm run check` = 3 个自研脚本（55 个 check/298 assert + 81 tests/752 assert + 523 assert），**不含** worker 单测与真实引擎链；版本门禁 `test-stage-version` 10/10（`docs/STATUS.md:15`）。新能力需要补 schema/时间线/音频/持久化重启类门禁（见 §8）。

## 1. 版本与发布机制

### 1.1 版本关系（代码事实）

| 位置 | 值 | 证据 |
|---|---|---|
| root bundle | `0.3.0-alpha.10` | `package.json:3` |
| engine client | `0.4.0` | `packages/video-engine-client/package.json:3` |
| engine worker | `0.4.0` | `packages/video-engine-worker/package.json:3` |
| HyperFrames / SDK / GSAP | `0.8.167 / 0.8.167 / 3.15.0` | `packages/video-engine-worker/package.json:22-27` |
| 安装 staging（磁盘事实） | `artifacts/p2-b/staging-alpha10-1cceb96` | `ls ../artifacts/p2-b/`；`~/.dsh/profiles/desktop/node_modules/dsh-video -> …/staging-alpha10-1cceb96/bundle` |
| INTEGRITY sha256（实测） | `6061004fd7b14b71fe0069f8ca5acf6fde045370672392e9e70cdd9079d3e4f9` | `shasum -a 256 …/INTEGRITY.json`（与 `docs/STATUS.md:9` 一致） |

三者关系：root 是**可安装 Host+client bundle**；engine 两个包是 `file:` 本地依赖，由 `stage-dev.mjs` 注入 staging 的 `bundle/package.json` + `node_modules` 相对 symlink（`scripts/stage-dev.mjs:246-259`，staging 专属，不是可分发 tarball）。Host 通过 `createRequire(import.meta.url)` 从安装 bundle 解析 engine 包并启动独立 Node worker（`host/engine.js:49-104`），版本不匹配由 `MIN_EXPLICIT_SPAWN_CLIENT=0.1.1` 与 `compareVersion` 严格门禁（`host/bridge.js:695-721`）。

### 1.2 「大版本」在当前体系里的含义

当前没有 `1.0.0`/独立 engine 版本线；所谓「大版本」实际 = **一次新的固定 staging + root bundle 版本号 bump + engine 版本对登记**。要改的文件/动作：

1. `package.json:3` bump root 版本（必须 semver，`--bundle-version` 显式声明且与**已提交** manifest 完全一致，`scripts/lib/stage-version.mjs:42-62`；`scripts/stage-dev.mjs:202-209` 在创建目录/安装依赖**之前**失败）。
2. 若动 engine：`packages/video-engine-worker|client/package.json:3` bump，并把新版本对加入 `REVIEWED_ENGINE_PAIRS`（`scripts/stage-dev.mjs:70-77`）与 `MANAGED_ENGINE_VERSIONS`（`:79`）——**不会自动跟随分支 HEAD**。
3. `scripts/check.mjs:137-139` 有硬编码断言 `pkg.version === '0.3.0-alpha.10'`，每次 bump 必须同步改门禁（技术债）。
4. 运行 `node scripts/stage-dev.mjs --engine-commit <sha> --bundle-version <semver> --node <abs> --browser <abs> --out <new-dir>`；输出必须**全新非空禁止**目录（`stage-dev.mjs:211-216`），生成 `bundle/ engine-client/ engine-worker/ config.json session-cwd/ INTEGRITY.json cache/ managed/ projects/ asset-inbox/ restore/`。
5. staging 时把可信 config 注入**副本**的 `cordis.patch.yml`（`stage-dev.mjs:344-347`；仓库内 `cordis.patch.yml` 永远 `config: {}`）。
6. 交付前门禁：`npm run check`、`node scripts/test-stage-version.mjs`；真链 `test-host-engine --staging`、`test-canvas-chain`、`test-conversation-chain`、`test-conversation-preview` 等（`README.md` 本地检查节）。
7. 安装/启用由 DSH Plugins 页执行（`link:` 到 bundle 绝对路径）；安装后重启 DSH 验证 client bundle 已换（`docs/STATUS.md:16`）。

**注意**：`stage-dev.mjs` 的 `RUNTIME_PATHS`（`:39-62`）是白名单式复制清单，新增 host 文件（例如未来的 `host/reveal.js`）必须手工加入，否则 staging 安装缺文件。engine 侧 `packages/video-engine-worker/README.md:107-114` 与 Host `host/config.js:10-33` 的 `CONFIG_KEYS` 也要同步新配置键。

## 2. 存储与持久化全链路（需求 5 核心）

### 2.1 真实磁盘布局（本机安装 = 用户数据）

```
artifacts/p2-b/staging-alpha10-1cceb96/          # 206 MB 固定 staging（可被清理/替换）
├── config.json                                  # 注入 patch 的可信配置（绝对路径）
├── bundle/                                      # link: 安装的插件根（root 0.3.0-alpha.10）
├── engine-client/ engine-worker/                # engine 0.4.0 快照 + node_modules
├── managed/
│   ├── registry.json                            # worker 配置：projectsRoot/registryPath/outputRoot/assetInboxRoot/browserPath
│   └── projects.json                            # 工程注册表 {"projects": {id: abspath}}
├── projects/                                    # ★ projectsRoot：工程内容在这
│   ├── demo/                                    # fixture（stage-dev 从引擎包复制）
│   └── proj-mvhecao6-54fd712a/                  # ★ 真实用户工程「DS 宣传片」
├── session-state.json                           # ★ 工程↔DSH 创作会话映射（原子写）
├── session-cwd/<projectId>/                     # ★ 每个工程的创作会话 cwd + .dsh-video-frames/latest.png
├── asset-inbox/                                 # ★ 上传收件箱（临时；当前为空）
├── engine-worker/artifacts/output/              # ★ artifactRoot/outputRoot：frame/render 产物 + previews/
├── restore/demo/                                # staging 校验用备份
└── cache/                                       # npm 缓存（staging 专属）
```
（以上逐项来自 `ls`/`find`/`cat` 实际磁盘；`config.json` 路径含空格，绑定当前 worktree 绝对路径。）

工程目录内部（实测 `projects/proj-mvhecao6-54fd712a`）：
```
index.html                 # composition 入口（唯一可编辑文档）
project.json               # {"entry":"index.html","assets":["assets/gsap.min.js"],"title":"DS 宣传片"}
assets/gsap.min.js         # 声明资产
.dsh-video/history/        # ★ 撤销历史：entries.jsonl / ops.jsonl / state.json / snapshots/<revision>.html
.hf-versions/              # HyperFrames 自己留下的版本缓存（demo 工程可见，非插件管理）
```

### 2.2 数据流图（写路径与落盘）

```
AI Tool / UI ──POST /api/dsh-video/request 或 fetch 路由──▶ VideoBridge.dispatch (host/bridge.js:1339)
   │                                                          │ 发现工程：读 managed/projects.json（:1341-1348）
   │                                                          ▼
   │                                                   WorkerClient JSONL ──▶ worker.mjs
   │                                                                          │
   │        ┌────────────────────────── 磁盘（唯一权威）──────────────────────┤
   │        │ projects/<id>/project.json + index.html + assets/                │
   │        │ .dsh-video/history/*（undo/redo）                                 │
   │        │ managed/projects.json（新建工程后写，registry.mjs:100-113）       │
   │        │ session-state.json（工程↔会话，session-state.js:223-267）         │
   │        │ outputRoot/<uuid>.png|.mp4、outputRoot/previews/<snapshotId>/      │
   │        │ asset-inbox/upload-<uuid>-<name>（临时，导入即删）                 │
   │        └────────────────────────────────────────────────────────────────┘
   ▼
Host 内存（重启即丢）：jobs Map（jobId→工程/revision，bridge.js:786）、inFlight、projectFactsById、
snapshot 路由表（每工程最多 4 个，host/snapshot.js:36）、asset receipts（assetInbox.receipts）
```

### 2.3 持久化清单（谁落盘、谁易失、TTL/清理）

| 数据 | 位置 | 落盘 | 重启/Host 重启后 | 清理/TTL |
|---|---|---|---|---|
| 工程内容（HTML/composition/assets/project.json） | `projectsRoot/<id>/` | ✅ 原子写（`registry.mjs:28-35,131-146`） | 保留 | 无自动清理 |
| 工程注册表 | `managed/projects.json` | ✅ 原子写（`registry.mjs:100-113`） | 保留；worker/Host 启动 reload（`registry.mjs:76-98`、`bridge.js:831-854`） | 无；单条损坏/目录缺失→全桥 `E_CONFIGURATION`（`bridge.js:737-762`） |
| 回归历史 | `.dsh-video/history/` | ✅（`history.mjs:56-136`） | 保留；undo/redo 读快照（`:231-236`） | 上限 64 条/8 MiB，超出从头裁（`:7-8,138-161`） |
| 工程↔会话映射 | `sessionStatePath`(=staging/session-state.json) | ✅ 原子写、版本 1（`session-state.js:20,223-240`） | 保留 | 无 TTL；损坏/版本不符即持续 typed error，不自动清 |
| 创作会话 cwd / frameImage | `sessionCwd/<projectId>/` | ✅（`sessions.js:286-308`） | 保留（路径依赖 staging） | 无 |
| 上传收件箱 | `assetInboxRoot` | ✅ 文件 | 文件在，**receipt 在内存** → 重启后 receipt 全失效 | 10 分钟 TTL + 仅上传/take 时 sweep（`asset-inbox.js:23,163-177`）；dispose 删自身副本（`:320-354`） |
| frame/render 产物 | `outputRoot/<uuid>.png|.mp4` | ✅ | 文件保留，但 Host job 表丢失 → artifact 路由 404（`bridge.js:1692-1699`） | 无 TTL；job 临时目录在 finally 删除（`jobs.mjs:481-485`） |
| worker preview 快照 | `outputRoot/previews/<snapshotId>/` | ✅ 但**临时** | worker 启动即 `rm -r` 整个 previews 根（`previews.mjs:54-63`） | 默认 TTL 10 分钟（`previews.mjs:18-20`）；Host 路由注册表每工程最多 4 个（`snapshot.js:36`） |
| Host 预览路由 | 内存 | ❌ | 丢失（可重建） | close 工程/worker TTL/release 撤销（`bridge.js:1490-1492`） |
| Host job 归属 | 内存 Map | ❌ | 丢失；旧 MP4 不可再下载 | 单实例 `jobs.size` 无清理（进程生命周期） |
| 上次打开的工程 | `editorMemory` 内存变量（`client.js:1438,4454,4639-4650`） | ❌ | **页面重载/面板重挂后不记得**；boot 用 `project.list` 的 `defaultProjectId`（index.html mtime 最新，`bridge.js:873-895`）回退 | — |
| 布局比例（右栏宽度） | `localStorage['dsh-video.ui.v1']`（`client.js:44,1333-1390`） | ✅ 浏览器侧 | 保留 | 用户可删 |

### 2.4 asset-inbox 导入链路（需求 3 的现状）

1. UI `fetch('api/dsh-video/asset-upload', {POST, 头 x-dsh-project-id / x-dsh-file-name})`（`client.js:3874-3906`，只接受 `image/png,image/jpeg`）。
2. Host 路由校验 allowlist/projectId/文件名/大小（≤8 MiB，`host/config.js:49-50`）、PNG/JPEG 魔数嗅探，写 `assetInboxRoot/upload-<uuid>-<name>`，返回内存 receipt（TTL 10 分钟，最多 32 个）（`asset-inbox.js:27,80-84,223-292`）。
3. UI 再调 `asset.import {projectId, expectedRevision, operationId, receiptId}`（UI-only，Tool 不可调，`bridge.js:1379-1391`）；worker 校验 receipt 对应文件、重算 revision、复制到 `projects/<id>/assets/` 并重写 `project.json`（`registry.mjs:182-253`；上限 16 张/8 MiB/张/64 MiB 总），Host 随后 `assets.finish(receipt)` 删 inbox 副本（`bridge.js:1382-1389`、`asset-inbox.js:313-318`）。
4. 结果：**导入成功 = 复制进工程目录 → 持久**；未完成导入的 upload 副本是临时的（10 分钟后 sweep 或插件 dispose 时删）。素材抽屉只在 `CanvasWorkspace` 的 `previewOnly=false` 开发路径出现（`client.js:4397-4405`），**产品 UI 当前不可达/无素材库页面**（`README.md` 对 P3-008 的说明、`ROADMAP.md` P4）。

已知风险：receipt 在内存、inbox 清理只在 sweep/dispose；用户上传后不完成 import 会留下孤儿文件（有界但仍在磁盘）；导入失败时 UI 未见回收路径（未验证用户可见表现）。

### 2.5 client 工程列表/新建/打开流程

- boot：一次 `project.list` → 优先 `editorMemory` 记住的 projectId → 否则 `defaultProjectId`（按 `index.html` mtime 降序，`bridge.js:882-894`）→ 否则第一个 → 都没有则 `project.create`（`client.js:4946-5065`）。
- `project.list` 只返回 `{projectId, updatedAt, title}`，**不返回路径**（`bridge.js:873-895`）；`title` 来自 `project.json` 可选字段（UI-only rename，`:1363-1377`）。
- `project.create` 仅接受固定模板 `product-launch-v1`、可选 title/width/height/30fps（`bridge.js:488-505`）；worker 创建目录 + 嵌入 gsap + `ensureHistory` + 写 registry 后才返回（`projects.mjs:1092-1186`），Host 再 `discoverManagedProjects` 把它加入可信 allowlist（`bridge.js:1354-1361`）。**创建与 session 绑定是两步**：client `openProject` 后 `session.list` → 无会话则 `session.create`（`client.js:5030-5070,5075-5100`）。
- 「上次打开的工程」：没有 localStorage/Host 持久记忆；只有页面内 `editorMemory`。跨刷新恢复依赖 mtime 排序，**不是** last-opened。

### 2.6 结论：今天重启后工程一定还在吗？

- **同一安装、同一 staging 目录、DSH 重启/Host 重启：在。** 代码路径与磁盘事实一致：工程/registry/history/session-state 都在 staging 目录的普通文件中；worker 第一次业务请求时惰性启动并 reload registry（`README.md` 停止/重启节；`worker.mjs:255-300`；`bridge.js:1341-1348`）。实际验证：关掉 DSH 后这些文件仍在（本次审计 `ls/cat` 只读确认），重启 DSH 后 UI 能打开工程的行为已由 `docs/STATUS.md:16`（重启后加载新 client bundle）与用户验收覆盖，但本轮**未再次重启 DSH 实测**（未验证）。
- **不保证的场景（重要）**：
  1. **换新 staging/升级**：新 `config.json` 指向新的空 `projectsRoot` → 旧工程从 UI 消失；无迁移脚本。删除旧 staging 目录 = 真丢（当前用户工程就在其中）。
  2. **worktree/artifacts 目录移动或清理**：config 是绝对路径（含空格），移动后 `E_CONFIGURATION`/找不到工程。
  3. **registry 损坏或单个工程目录被删/不可读**：bridge 对**所有**业务请求抛 `E_CONFIGURATION`（`bridge.js:737-762`），UI 表现为整体不可用；文件不会被删但「看不见」。
  4. **session-state 损坏/版本不符**：会话功能持续 `E_SESSION_STATE_CORRUPT`，无自动修复（`session-state.js:56-114,140-178`）；工程内容仍在。
  5. **降级/回滚到旧 staging**：旧 staging 的 projectsRoot 是旧的，期间在新 staging 里创作的内容不会自动带回去。
  6. **preview/snapshot/导出产物**：预期会丢/重建，不算工程丢失；但「导出文件」在重启后无法通过插件下载（job 表内存）。
- **「文件夹」按钮**：现有 Host 没有 `project.path`/`reveal`（`grep -n "openPath|reveal|showItemInFolder|shell\." host/*.js` 无结果；`REQUEST_METHODS` 见 `bridge.js:27-58`）。bridge 其实已持有权威目录（`projectDirectories()`，`bridge.js:911-948`），加一个 **UI-only** `project.path` 返回绝对路径即可；「打开文件夹」需要 OS 能力（DSH Host API 是否提供 `shell.openPath`/reveal 未见文档，**未验证**，兜底是新增受控 action 由 Host 服务层执行 `open` 命令，需产品/安全评审）。

## 3. 工程数据模型与 AI 写协议

### 3.1 数据模型（当前实际）

- 工程 = `project.json`（`{entry:"index.html", assets:[相对路径...], title?:string}`）+ `index.html`（受控 HTML composition）+ `assets/`。manifest 只允许这三个键，`entry` 必须是 `index.html`（`projects.mjs:372-396`），manifest ≤16 KiB，单文件 ≤64 MiB，总 ≤128 MiB（`:365,406-410`）。
- **revision** = `sha256(JSON.stringify({entry, files:[{path,bytes,sha256}...]}))`（`projects.mjs:418-428`）——内容哈希，任何入口/资产字节变化即变；rename 不改 revision（`:290-314` 返回同一个 revision）。Host Tool 读 `project.source` 拿完整 HTML，写 `project.compose` 整篇原子替换（`tool.js:218,124-128`；`bridge.js:1464-1498`）。
- **Scene 模型**：`product-launch-v1` 固定模板，`sceneId`（默认 `scene-1`…）、`duration`（0.5–60s）、start 自动累加、总长 ≤3600s、≤12 个（`scenes.mjs:4-13,86-183`）；每个 Scene 生成固定 HTML 片段（标题/副标题/色块/分隔线等，`scenes.mjs:190-255`）。`scene.reorder` 只接受完整顺序数组（`tool.js:121,165`；`bridge.js:545-552`）。**没有**位轨/clip/裁剪/多轨概念。
- **stableId**：inspect 返回元素的 `stableId`（`projects.mjs:451-468`），`edit` 支持 `text/timing/layout/style` 四类 typed ops，最多 32 个（`tool.js:67-103`）；`timing` 已能改元素 start/duration（`:76-77`），是可复用的「精调」基元。
- **history/undo**：entries/ops jsonl + snapshots；`undo/redo` 需要 `expectedRevision`+`operationId`（`tool.js:168-169`），写回 index.html 并推进 cursor（`history.mjs:201-236`）。`asset.import` 只记录 op、不产生可撤销内容条目（`history.mjs:239-262`）。
- **actor**：worker 侧 history 记录 `actor: "human"|"system"`（`history.mjs:88,104`；实际磁盘 `entries.jsonl` 可见 `actor":"human"`）。Host Tool 无 actor 参数，由 source=ui/tool 决定（`bridge.js` 的 UI-only 分支）。

### 3.2 AI 写协议（`video_engine` Tool，`host/tool.js:17-37`）

- 19 个 action：doctor/open/inspect/edit/frame/render/status/cancel/close + project.compose/source、scene.create/update/remove/reorder、project.revise、history/undo/redo。
- 每次写必须带 `expectedRevision`+`operationId`；worker 对 `operationId` 做签名去重/重放（`projects.mjs:1072-1091`），revision 不符返回 `E_REVISION_CONFLICT`（`projects.mjs:531-534,750-752`）。
- **UI-only 动作不污染 revision 的先例**：`project.rename`（`bridge.js:1363-1377`；worker 只改 manifest title、revision 原样返回，`projects.mjs:290-314`）；`project.list`/`project.create`/`asset.import`/`preview.*`/`session.*` 同样禁止 Tool 调用（`bridge.js:1350-1458`）。**素材库/文件夹/时间线 UI 操作应沿用这个「UI-only + 不改内容 revision」模式**。
- Tool 结果有 64 KiB 硬上限（`host/limits.js:12`；`tool.js:196-211`），compose HTML ≤48 KiB/转义 ≤60 KiB（`composition.mjs:22-25`；`host/limits.js:18-42`）——这直接限制「整篇 HTML」方案能承载的工程规模。
- Prompt 上下文（`sessions.js:417-488`）把 workflow/契约/skeleton 硬编码进模型上下文，明确禁止模型用 shell 写工程文件、禁止本地渲染；大版本改协议必须同步这段（约 4000 字符预算，`:36`）。

### 3.3 支持「片段级操作」需要扩展什么

1. **数据模型**：二选一——(a) `project.json` schema v2 增加 `tracks[]/clips[]`（`{trackId, kind:"video"|"audio", clips:[{clipId, asset, start, duration, in, out}]}`）并生成 HTML composition；或 (b) 保留 HTML 但约定 `data-clip-id/data-start/data-duration/data-in` 的 clip 元素 + `data-scene` 结构，worker 提供结构化读写。现状没有这些字段（`scenes.mjs:190-255` 只有 scene/template 字段）。
2. **新动作族**：`timeline.split/trim/move/reorder`、`clip.adjust`（in/out/播放速度）——每个都要 `expectedRevision/operationId`，可复用现有 queue/operation 幂等与 history 机制（`projects.mjs:259-266,1072-1091`；`history.mjs:83-136`）。
3. **合并/人工保护**：现有人工 override 机制在 `merge.mjs`（707 行，P3-009 managed elements）；clip 级操作需要纳入同类「人类修改优先/AI 删除保护」规则，否则 AI 重排会覆盖用户剪辑。
4. **UI 侧只读预览→可编辑时间线**：当前左列只有播放/导出（`client.js:5895-5970`）与只读 canvas（`previewOnly` 路径）；需要新增时间线组件 + 拖动/选择状态 + 与 Host 的 preview.release/inspect 轮询协调（现有 revision 轮询 `client.js:4620-4660`、REVISION_POLL_MS 去抖）。
5. **渲染**：如果 HTML composition 由 tracks 生成，render 管线可不变；如果直接放 `<video>/<audio>` 元素，则必须先解除 §5 的禁止项。

## 4. 渲染/预览管线与音频可行性

### 4.1 现状（`packages/video-engine-worker/src/jobs.mjs`）

- 执行器：`node_modules/hyperframes/dist/cli.js`（`jobs.mjs:10`），每次 job 先 `projects.snapshot()` 把工程复制到 `outputRoot/.job-*/project`（`:219-225`），再 `buildDocument()` 校验尺寸/时长（≤3840×2160、≤3600s，`:230-247`），固定 **fps=30**（`:247`）。
- frame：`hyperframes snapshot <dir> --at <t> --keep …`，单帧 PNG 或 ≤4 帧 hstack 联系表（`:271-283,86-106`）。
- render：`hyperframes render <dir> -c index.html -o render.mp4 --fps 30 --format mp4 --quality standard --workers 1 --no-browser-gpu`（`:288-304`）。
- 校验：ffprobe `select_streams v:0`，要求 h264、宽高一致、`r_frame_rate=30/1`、帧数 = duration*30、时长误差 ≤1/30；**没有检查音频流**（`:342-388`）。产物 rename 到 `outputRoot/<jobId>.mp4`（`:462-473`），Host artifact 路由再验哈希/大小后提供下载（`bridge.js:1692+`）。
- 限制：frame 120000ms、render 900000ms（`jobs.mjs:19-20`；Host 侧 `bridge.js:112-120`）；同时最多 4 个非终态 job、job 表上限 256（`jobs.mjs:150-155`）；尺寸/时长/时长上下限同 composition 校验（`composition.mjs:26-31`）。
- 预览：worker 快照 + Host 路由 + iframe 播放；快照是**私有副本**，Host 注入固定 runtime 与严格 CSP（`host/snapshot.js` 文件头、`injectRuntime`/CSP 段），子资源走 public exact 路由（random snapshotId 即能力），每工程保留 ≤4 个（`:36,173-260`）。

### 4.2 音频可行性（需求 1）

- **底层能力存在**：HyperFrames 0.8.167 README 有 `audio`（onset/loudness/silence 分析）、`normalize-audio`（LUFS 匹配写回 `data-volume`）、render 的 `audioFailures` 诊断（`node_modules/hyperframes/README.md:50-97`）；dist 中出现 `<audio>`、`audio-group`、`aac` 混流与 `audio-media`；CLI help 还有 `tts`——“Generate speech audio from text using a local AI model (Kokoro-82M)”（`dist/help-7MQDFXVN.js:99`）。
- **我们的卡点（按依赖顺序）**：
  1. composition 校验器**无条件拒绝** `<audio>/<video>/<source>/<track>`（`composition.mjs:35-46,97-103`），模型契约里也写明禁 audio（`sessions.js:448`）。
  2. 资产类型只允许 PNG/JPEG：inbox MIME/嗅探（`asset-inbox.js:27,80-84`）、worker `IMAGE_EXT`（`registry.mjs:14,19`）、manifest 资产导入（`registry.mjs:182-253`）、Host `preview` 的图片扩展表（`preview.js:25-31`）、snapshot 路由 MIME 表（`snapshot.js:44-58`，无 mp4/mp3）。
  3. 渲染校验不看音频（`jobs.mjs:342-388`）——音频存在时不会失败，但也**无法证明**音轨正确；应增加 `a:0` codec/channels/duration 断言。
  4. 「生成音频」本身没有服务：`video_engine` 无 audio 生成 action；HyperFrames `tts` 用本地 Kokoro-82M 模型（需 `hyperframes models install` 下载，模型大小/许可/离线策略**未验证**）；音乐/音效生成无内置能力。
- **最小可行路径**：解锁校验器（仅允许 manifest 声明的 audio 资产 + 相对路径）→ 扩展资产导入（mp3/wav/m4a，大小上限调高）→ 模板/协议允许 `data-volume` 与 clip 时间 → render 加音频流校验 → UI 加音频轨/音量；「AI 生成音频」另开 Host 服务（TTS CLI 子进程或外部 API），生成文件走同一 asset 导入/注册通路。

## 5. UI 结构与插入点

### 5.1 client.js 结构（单文件 6313 行，`wc -l`）

- 模块格式：`window.__ModuleLoader__.load({...factory(require)})`，只能用 `require('react')` 平台 seed、禁 ESM（`client.js:31-39`；门禁 `scripts/check.mjs:81-86`）。
- 布局/尺寸常量与 AI 栏比例纯函数：`client.js:44-110`；CSS 主题 token 全部 `var(--dsw-alias-*)`（约 `:150-1300`）；i18n 是 client.js 内联中英字典（ZH 约 `:150-420`，EN 随后），`locale/{zh,en}.json` 只有 meta 6 行（`wc -l locale/*.json`）——新增文案要改 client.js，不是 locale json。
- 关键块：prefs/store `:1307-1500`；图标 `:1508-1600`；请求/错误/路径辅助 `:1635-1960`；canvas runtime 协议 `:2048-2670`；CanvasWorkspace 大组件 `:2674-4420`（含 upload/drawer `:3874,4397-4405`）；VideoWorkspace 主面板 `:4424-6026`；组件注册/apply `:6028-6313`。
- 主面板布局（`client.js:5966-6030`）：
  - `header.dv-topbar`：返回按钮 + `projectBar()`（标题内联重命名 + 工程菜单箭头，`:4743-4830,5835-5988`）+ 右侧 `exportControl()`（`:5288-5375`）。
  - `main.dv-main` → `div.dv-left`（`stageContent()`：stage + 播放/时间/导出状态，`:5895-5970`）+ `div.dv-splitter`（拖拽/键盘，`:4833-4910`）+ `aiPanel()`（`:5665-5740`）。
  - 宽度约束：`.dv-ai-pane width: clamp(320px,42%,min(720px,calc(100% - 360px)))`（`:550-556`）→ **左列保底 360px**；窄容器媒体查询下 splitter 隐藏、左列 48%（`:1276-1300`）。时间线放左列纵向可行（stage 下方），第三列不可行。
- 右侧 AI 栏：宿主原生 Conversation 嵌入——`SessionConversationContent` 用 `renderFactorySlot('conversation.content',{variant:'embedded', hero:false})`（`client.js:2505-2510`），`SessionConversationHost` 管 Session 引用/phase（`:2558-2670`）；Composer、模型 seat、审批、Stop 都来自宿主，**插件不绘制输入框**（`P3-005A-native-conversation-contract.md:32,92,143`）。
- 只读预览：StageFrame iframe（`:4095-4145`）、自动跟随 revision 轮询（`:4620-4660`）、失败重试/旧画面保留（P3-017）。导出：绑定点击时 revision 的 render + artifact 下载（`:5119-5375`）。

### 5.2 插入点结论

| 新能力 | 最自然插入点 | 约束/证据 |
|---|---|---|
| 时间线（视频/音频轨、剪辑） | 左列 `dv-left` 内、`stageContent()` 下方新增 `dv-timeline` 区域（纵向，高度可折叠）；工具/上传/检查器已有 canvas 侧栏先例 | 左列最小 360px（`client.js:554`）；现有只读 stage 不能变成可编辑画布（产品定位），时间线是新的可交互面 |
| 素材库页面 | 左列 tab（预览/素材）或复用一个受控 drawer；现 `dv-drawer` 只在开发路径可达（`:4397`） | 需要 Host `asset-upload` 扩格式 + 工程资产列表/缩略图接口（现在只有 `inspect.files`：`projects.mjs:501`） |
| 音频轨/生成音频 | 时间线内 audio track + 生成入口（按钮 → 新 Host action/服务） | 无宿主音频生成 API；HyperFrames `tts` 是本地模型（未验证） |
| 输入框 @ 引用片段/素材 | 宿主 Composer 本身不是插件 DOM；可插入 slot `conversation.composer.dock`（kit `README.md:102`；`P3-005A:46,54` 确认存在 input.attachments/composer.dock） | **插件不能读取/写入宿主 composer 草稿或 receiptId**（`P3-005A:272,297`：未找到受支持通路）；需要宿主新增 mention/attachment API，或退化为「素材/片段选择器 + 由插件通过 session 服务发送结构化消息」（需验证 `sessionController`/`fileUploads.bindPrompt` 组合，未验证） |
| 工程文件夹按钮 | 顶栏工程菜单（`projectBar()` 旁） | 需新增 UI-only Host `project.path`（bridge 已有目录 Map，`bridge.js:911-948`）+ OS 打开能力（未验证 DSH 是否暴露 shell/openPath；可能需要 host capability 审批） |

主题/CSP：所有颜色用 `--dsw-alias-*` token；预览 iframe 有严格 CSP（`snapshot.js` 注入 runtime + inline script hash 白名单），新增时间线播放 mp4/音频若走 `<video>` 需扩展 Host MIME/路由与 CSP 的 media-src；**不要**把素材 URL 指向任意 file://（现有 preview/artifact 路由都是受控 exact 路由）。

## 6. 测试门禁

| 门禁 | 命令/位置 | 规模（实测 grep） | 覆盖 |
|---|---|---|---|
| 静态/契约检查 | `node scripts/check.mjs`（`package.json:26`） | 55 个 `check()`、298 个 assert | manifest/patch/exports/files/locale、侧栏契约、会话接线、staging 版本门禁、UI 范围、Host 安全不变量 |
| client 行为 | `node scripts/smoke-client.mjs` | 81 个 `test()`、752 个 assert | 模块加载、侧栏原子生命周期、原生会话 kit/历史/切换、打开/编辑/帧/导出/取消/错误 |
| Host | `node scripts/check-host.mjs` | 523 个 assert | 配置/env/启动单飞/参数/job 归属/路由/Tool/会话持久化与范围/artifact 字节校验/预览归属/准入排空 |
| 版本门禁回归 | `node scripts/test-stage-version.mjs`（不安装、不生成快照） | 28 个 assert；STATUS 10/10 | `--bundle-version` 与已提交 manifest 完全一致、非法 semver 拒绝 |
| worker 单测 | `cd packages/video-engine-worker && npm test`（`node --test`） | 11 个 unit 文件（`*.test.mjs`），另 7 个 `*.integration.mjs` 走 `test:real` | schema/compose/history/scene/layout/preview/frame/worker 协议 |
| engine client 单测 | `cd packages/video-engine-client && npm test` | 8 个文件 | compose/protocol/layout-style/预览/打包/真实链 |
| 真链（需 staging，不在 `npm run check`） | `scripts/test-host-engine.mjs`、`test-canvas-chain/browser/workspace`、`test-conversation-chain`、`test-conversation-preview`、`test-stage-version` | chain 261/261、preview 164/164（`docs/STATUS.md:15`） | 真实 Node/HyperFrames/Chrome/ffmpeg、会话/预览/ToolRow DOM |

**缺口（大版本必须补）**：project schema v2 校验单测；clip/timeline 动作的 revision/幂等/undo 测试；音频资产导入 + render `a:0` 断言；真实「worker 重启→再打开工程」持久化 E2E；registry/session-state 损坏的容错与降级测试（现有是 fail-closed）；新 UI 的 smoke（时间线/素材库/文件夹按钮）；@ 引用的宿主能力集成测试（若宿主无 API，则需先做能力探测门禁）。

## 7. 需求 1–5 需要改什么（按改动面）

| # | 需求 | 现状缺口 | 必改文件/层（证据） | 新能力 | 风险/不确定 |
|---|---|---|---|---|---|
| 1 | 生成音频 | 无音频生成 action；composition 禁 audio；资产只 PNG/JPEG；ffprobe 不验音轨 | `composition.mjs:35-46`、`asset-inbox.js:27`、`registry.mjs:14-19,182-253`、`jobs.mjs:342-388`、`tool.js:17-37`、`sessions.js:448` | Host audio 服务（TTS 本地/外部）、asset 类型扩展、composition 允许声明 audio、render 音轨校验、UI 音频轨 | 本地 Kokoro 模型下载/许可/离线未验证；长音频与 900s render 预算；「生成」质量无验收标准 |
| 2 | 视频/音频轨 + 剪辑（人工+AI：排序/再剪/精调） | 无 track/clip 模型；Scene 仅是模板；无时间线 UI；无 clip 级 Tool 动作 | `scenes.mjs:4-13,125-255`、`projects.mjs:418-428`、`tool.js:150-170`、`client.js:5895-5970`、`bridge.js:60-91` | schema v2（tracks/clips）或约定 clip 数据属性；`timeline.*`/`clip.*` 动作族；时间线组件；预览/导出接入 | 最大改动；merge.mjs 人工保护需扩展；compose 48 KiB 上限可能不够；video clip 必须解锁 `<video>` 并处理解码/ffmpeg 校验 |
| 3 | 素材库（按工程、导入、页面、AI 可参考） | 只有单工程 manifest≤16 图；无库页面/元数据/缩略图/跨工程；素材抽屉仅开发路径 | `client.js:4397-4405`、`asset-inbox.js:27,223-292`、`registry.mjs:14-19,182-253`、`projects.mjs:501`、`sessions.js:466-468` | 工程 assets 索引 + 上传格式扩展 + UI 库页 + Tool `asset.list`/prompt facts 扩展 | 视频/音频格式；缩略图/预览；孤儿清理；大小/数量配额需重定 |
| 4 | 输入框 @ 引用片段/素材 | Composer 是宿主原生；插件不能写草稿/读 receipt | `client.js:2505-2510`、`P3-005A:272,297`、kit `README.md:102`（composer.dock） | 优先 `conversation.composer.dock` 选择器 + 宿主 mention API（需宿主支持）；或新通路上报 | 宿主无公开 API（未验证能否新增）；替代方案需验证 `fileUploads.bindPrompt`；@ 的语义（定位/上下文注入）需产品定义 |
| 5 | 存储复核 + 文件夹按钮 | 工程数据在 staging 目录内、无迁移；无 project.path/reveal；上次打开工程不持久 | `stage-dev.mjs:294-334`、`config.json`、`bridge.js:27-58,873-895,911-948`、`session-state.js` | 数据根迁到稳定目录 + 安装/升级迁移；`project.path`/`project.reveal` UI-only；last-opened 持久化；registry 容错 | 迁移顺序/回滚；旧 staging 工程导入；OS 打开能力未验证；路径含空格 |

## 8. 风险清单（按严重度）

**S0（会丢用户数据 / 阻断需求 5）**
- R1 工程数据根在**按版本新建的 staging 目录**内（`stage-dev.mjs:294-334`；真实 `config.json`）。换 staging/清 `artifacts/`/移动 worktree = 用户工程从 UI 消失甚至真丢；无迁移/导入/备份机制。当前唯一真实用户工程 `proj-mvhecao6-54fd712a` 就在其中。
- R2 registry（`managed/projects.json`）损坏或任一工程目录不可读 → **所有**业务请求 `E_CONFIGURATION`（`bridge.js:737-762,1341-1347`），故障面被放大；无降级/quarantine。
- R3 若未来把素材/导出路径塞进 staging 或临时目录而不迁移，会复制同类问题（现在 inbox/preview 是临时的，属预期）。

**S1（功能不可用 / 高返工）**
- R4 需求 2 没有数据模型基础：Scene 仅是固定模板，无 track/clip；compose 整篇 HTML 48 KiB 上限 + 64 KiB Tool 结果上限可能卡住复杂工程。
- R5 音频/视频素材在 5 层被拒（校验器/资产/预览 MIME/快照 MIME/ffprobe），打通是横切改动，且 render 音频无验收断言。
- R6 @ 引用依赖宿主 Composer 能力；`P3-005A` 明确「本轮源码没有找到插件从 native composer 草稿读取 receiptId 的受支持通路」，若宿主不扩 API，需求 4 只能降级为「插件侧选择器 + 结构化消息」。
- R7 session-state 损坏/版本不符无自愈，`E_SESSION_STATE_CORRUPT` 持续（`session-state.js:56-114,140-178`）；会话映射只有 id，没有 title 冗余。
- R8 上次打开工程不持久（`editorMemory` 仅内存，`client.js:1438,4639-4650`）；多工程场景下刷新后按 mtime 打开，可能不是用户预期。

**S2（可维护性 / 发布摩擦）**
- R9 单文件 `client.js` 6313 行、`host/bridge.js` 1813 行、`projects.mjs` 1891 行、`merge.mjs` 707 行；无构建步骤、无 TS、无组件边界（`client.js:31` 模块格式限制）；时间线/素材库/音频三件事同时进入会显著放大单文件复杂度。建议先拆「纯函数/协议层」出独立文件并加入 stage-dev `RUNTIME_PATHS`，本轮不做大重构（无回归基线成本更高）。
- R10 版本门禁硬编码 `0.3.0-alpha.10`（`check.mjs:137-139`）+ `REVIEWED_ENGINE_PAIRS` 手工登记（`stage-dev.mjs:70-77`）→ 每次版本 bump 要改多处；大版本建议至少把版本断言改为「来自 package.json 的单一来源 + 交付记录」。
- R11 新 Host 文件必须手工加入 `RUNTIME_PATHS`（`stage-dev.mjs:39-62`），漏加会让 staging 安装坏掉（有测试但容易被忽略）。
- R12 history 上限 64 条/8 MiB 会裁剪（`history.mjs:7-8,138-161`）；长剪辑会话早期撤销点丢失——需产品定义是否可接受。

**S3（体验/边界）**
- R13 仅 30fps、固定 h264、尺寸/时长范围固定（`jobs.mjs:247,342-388`；`scenes.mjs:6-12`）；多轨/变速/字幕烧录等未来能力会被当前校验硬卡。
- R14 导出产物不可持久下载（Host jobs 内存，`bridge.js:786,1692-1699`），且 `outputRoot` 产物无 TTL → 磁盘累积；导出“作品文件”概念需要产品化（保存到工程目录或用户选择目录）。
- R15 preview/snapshot 每工程仅 4 个、TTL 10 分钟（`snapshot.js:36`、`previews.mjs:18-20`）；重开/切工程需重新渲染，属于现有体验成本。
- R16 `sessionCwd` 在 staging 内（`config.json`），新版本 staging 后旧 DSH 会话的 cwd 不存在；DSH 侧会话仍可见但插件侧映射为空（未验证宿主表现）。
- R17 绝对路径、含空格路径、固定 worktree 依赖（`config.json`）对安装/迁移不友好；`project.path` 若要暴露给 UI 需明确 UI-only 与脱敏边界。

## 9. 未验证清单（诚实边界）

- 未重启 DSH 做「重启后打开旧工程」的实测（仅有磁盘文件仍在 + `docs/STATUS.md` 安装事实）；结论基于代码路径 + 磁盘证据。
- 未验证 HyperFrames render 对 `<audio>` 的实际混音结果（未跑渲染）；未验证 `hyperframes tts` 在本机是否可用（需下载模型）。
- 未验证 DSH Host 是否提供打开文件夹的 shell/openPath 能力（插件 kit 文档未见）。
- 未验证需求 4 的宿主 Composer mention/attachment API 是否存在；`P3-005A` 的结论是「未找到」。
- 未验证 staging 目录被 Plugin Manager 卸载时是否会清理 `projects/` 等数据目录（当前证据只有 bundle link；行为取决于 Plugin Manager）。
- 未验证 registry/session-state 损坏时 UI 的具体降级表现（仅代码层 fail-closed 结论）。
