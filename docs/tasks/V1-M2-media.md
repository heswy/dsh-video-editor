# V1-M2 素材库与媒体管线 · 实现契约与任务卡

日期：2026-10-21（Asia/Shanghai）。状态：**delivered（开发与 L1–L3 已完成；固定 alpha.2 候选已验证，待用户真机验收，不标 accepted）**。
工作树：`dsh-video-editor-worktrees/v1-m2-media`（分支 `codex/v1-m2-media`，**stacked on `codex/v1-m1-storage` @ `e810a68`**；因为 M1 尚未合并 main、也尚未真机验收，M2 PR 依赖 M1 PR）。
依据：[V1.0-PLAN](../plans/V1.0-PLAN.md) §5 M2 · [M0 报告](../research/V1-M0-report.md) §2.4（Range/大文件）· [验收矩阵](../plans/V1.0-ACCEPTANCE.md) §M2。
性质：实现产品代码（worker/Host/client/脚本），不安装、不重启 DSH、不合并 main；Lead 评审 → commit → 构建 `1.0.0-alpha.2` staging → 与 M1 一并在用户重启窗口验收。

## 0. 目标（M2 完成定义）

1. 按工程导入**视频/图片/音频**素材：文件选择或拖拽 → 流式上传（不把大文件整读进内存）→ 探测元数据 → 内容寻址落盘 → 工程素材索引原子更新。
2. 工程级**素材库 UI**（复用现有素材抽屉入口）：网格缩略图、全部/视频/图片/音频筛选、搜索、详情、预览、删除（引用检查预留）；当前工程隔离。
3. **媒体路由**：认证路由，支持 HTTP Range/HEAD/416 流式读取；禁止任意路径/跨工程访问；CSP 不破坏现有预览。
4. **派生缓存**：视频缩略图、音频波形（异步 job），可重建、失败可重试；重启不丢索引。
5. **AI 可参考**：`asset.list` Tool（只读、分页、结果有界）+ prompt 事实更新；AI 可查询素材元数据。
6. 门禁：格式/限额/签名/穿越/Range/大文件/工程隔离/删除/重启 E2E；L3 真链。

## 1. 数据模型（M2 版，M3 会并入 timeline）

```
<projectDir>/
├── project.json            # 不改：entry/assets/title（composition 声明资产，仍走 revision）
├── index.html              # composition（不变）
├── media/<sha8>.<ext>      # ★M2 新：内容寻址媒体文件（视频/图片/音频）
├── asset-index.json        # ★M2 新：工程素材索引（不属于 composition revision）
└── .dsh-video/...          # history/legacy/etc 不变

<projectDir>/.dsh-video/media-cache/
├── <assetId>-<fullsha>-thumb.png     # 视频/图片缩略图
├── <assetId>-<fullsha>-waveform.png  # 音频/视频原声波形
└── <assetId>-<fullsha>-proxy.mp4|m4a # 兼容播放代理；均可重建
```

- `asset-index.json` schema：
```json
{ "version": 1,
  "assets": [
    { "assetId": "as_<sha8>", "kind": "video|image|audio", "name": "产品片段.mp4",
      "ext": "mp4", "sha256": "<64hex>", "bytes": 12345678,
      "media": { "durationSec": 12.5, "width": 1920, "height": 1080, "fps": 30,
                 "videoCodec": "h264", "hasAudio": true,
                 "sampleRate": 48000, "channels": 2, "audioCodec": "aac" },
      "origin": "import", "createdAt": "<iso>" } ]
}
```
- 内容寻址：`assetId = "as_" + sha256(前 8 hex)`；同工程重复导入同字节 → 复用已有 asset（返回 `deduped:true`），不重复占盘。
- 索引原子写（temp+rename），内容摘要 `indexRevision`（独立于 project revision）；损坏可备份重建（扫 `media/` + 探测，尽力）。
- 不修改 `project.json` 的 `assets[]`、不触碰 composition/revision/preview 管线（M2 不要求素材出现在画面；M3 才接时间线）。

## 2. 上传与导入

- 扩展 Host `asset-inbox`：支持 `mp4/mov/m4v/webm/mp3/wav/m4a/aac/flac/png/jpg`；**流式写盘**（Request body），按字节计数限额；不再一次 `arrayBuffer`。
- 限额：单文件 **2 GiB**、单工程 **8 GiB**（可配置）；上传前 Host 用 `statfs` 检查剩余空间（低于 1 GiB 拒绝并提示）。
- 命名/签名：按扩展名+mime 白名单；落盘后用 ffprobe 探测（视频/音频）或 PNG/JPEG 头（图片）验证真实类型；探测失败删除临时文件并返回 `E_ASSET_UNSUPPORTED`。
- Worker `asset.importMedia`（新 action）：`{projectId, operationId, sourceName, name?}`；从 inbox 读取→hash→`media/<sha8>.<ext>`（已存在则 dedupe）→ffprobe→更新索引→返回 asset + indexRevision。operationId 幂等。
- Host UI-only 上传路由沿用 `/api/dsh-video/asset-upload`（认证），返回 receipt；成功后自动调 worker 导入（与现有 image 流程一致）。
- 失败/取消：临时文件清理；inbox receipt TTL 10 分钟；不污染工程。

## 3. 读取与派生

- **媒体路由**（认证 Fetch 路由）：`GET/HEAD /api/dsh-video/media?projectId=<id>&assetId=<as_x>`；校验工程在 dataRoot registry、asset 在索引、realpath 在 `media/` 下、hash 可选校验（注册时/首次）；实现 **Range/206/HEAD/416/Accept-Ranges**，`createReadStream` 流式；MIME 由 ext 决定。
- **派生路由**：`GET /api/dsh-video/derived?projectId=&assetId=&kind=thumb|waveform`，不命中则 404 由 UI 触发 derive。
- Worker `asset.derive`：job（`kind:'asset'`）或同步任务（实现方选简单方案，必须可取消/有超时）；生成工程私有 `.dsh-video/media-cache/`；同 asset 同 kind 已存在则直接返回。
- 缩略图：视频 `ffmpeg -ss min(1s, dur/3) -vframes 1`；图片直接缩放；音频无缩略图（UI 用波形图标）。
- 波形：`ffmpeg -i audio -filter_complex showwavespic` 或 PCM 峰值降采样；尺寸/颜色由后端固定（UI 不传任意参数）。
- 派生缓存可重建：缓存缺失时重新生成；不进入工程 revision。

## 4. 工程素材库 UI（复用现有 drawer）

- 入口：保留现有画布左上「素材」按钮/抽屉（`video.canvas.materials`）；打开后是工程素材库（宽 ~320px，或浮层，不挤压 AI 栏）。
- 顶部：标题「素材」+ 导入按钮（`<input type=file multiple accept=...>`）+ 关闭；拖拽到抽屉/面板可导入（有进度/失败重试）。
- 筛选：全部/视频/图片/音频；搜索按 name；空态一句提示。
- 网格：图片缩略图、视频缩略图+时长角标、音频波形/图标+时长；加载骨架；派生失败可重试。
- 详情：点选显示 name/kind/duration/尺寸/大小/来源时间；操作：预览（图片 overlay、视频/音频播放器）、删除（确认；检查 timeline 片段与 project/composition 引用，引用中拒绝删除）、「引用」按钮生成 `@asset:as_x` 文本供复制（M5 接真 @）。
- 删除：UI-only `asset.remove`（confirm；原子更新索引并删 media/缓存；失败可重试；不删索引外文件）。
- 不修改右侧 AI 面板/原生对话；不新增第三列；样式沿用现有 `.dv-drawer`/token；中英文案走内联字典。
- 窄容器：抽屉浮层覆盖画布，不挤压 AI。

## 5. Host/Worker API（M2 新增/变更）

| 方法 | 来源 | 说明 |
|---|---|---|
| `/api/dsh-video/asset-upload`（扩展） | UI | 流式上传媒体；receipt；限额/格式/空间 |
| `asset.importMedia` | UI→worker | inbox→media 内容寻址 + ffprobe + 索引 |
| `asset.list` | **UI 与 Tool** | 分页/筛选/搜索；Tool 结果 ≤64 KiB；只读 |
| `asset.remove` | UI-only | 删除 index+文件+缓存；幂等 |
| `asset.derive` | UI（Host 内部触发） | 生成 thumb/waveform；job/同步；去重 |
| `/api/dsh-video/media` | UI | Range 流式读取 |
| `/api/dsh-video/derived` | UI | thumb/waveform 读取 |
| `asset.index`（可选诊断） | UI-only | 索引状态/修复（可选） |

- Tool `asset.list` 只返回元数据（不含绝对路径）；prompt facts 增加素材数量/类型摘要。
- 与 M1 契约：工程目录来自 dataRoot registry/realpath；不允许 UI 传路径。

## 6. 任务分解

| ID | 任务 | 主要文件 | 写作用域 |
|---|---|---|---|
| M2-01 | 索引/内容寻址/探测/去重/原子写/限额 | worker `assets.mjs`（新）、`projects.mjs`、`worker.mjs`、protocol.schema | `packages/video-engine-worker/**` |
| M2-02 | 流式上传/inbox 扩展/receipt/空间检查 | `host/asset-inbox.js`、`host/bridge.js`、`host/routes.js`、`host/config.js` | host |
| M2-03 | media/derived 路由（Range/HEAD/416/流式/隔离） | `host/bridge.js`、`host/routes.js`（新 host/media-routes.js 可选） | host |
| M2-04 | 派生缓存 job（thumb/waveform）+ 缓存目录 | worker `assets.mjs`/`jobs.mjs`/`previews` 邻近、`host` 触发 | worker+host |
| M2-05 | 素材库 UI（抽屉升级：筛选/搜索/导入进度/网格/详情/预览/删除/引用） | `client.js` | client |
| M2-06 | `asset.list` Tool + prompt facts + 分页 | `host/tool.js`、`host/sessions.js`、worker | host+worker |
| M2-07 | 门禁/E2E/文档（单元、Range、大文件、组件 smoke、L3） | `scripts/check*`、`scripts/test-v1-media.mjs`（新）、README/STATUS | scripts/docs |

依赖：M2-01→M2-04→M2-03；M2-02 可并行早期；M2-05 依赖 M2-02/03；M2-06 依赖 M2-01；M2-07 最后。单 worktree 单写入者顺序做。

## 7. 验收（M2 真机，延后到用户重启窗口；先 L3/组件）

见 [V1.0-ACCEPTANCE §M2](../plans/V1.0-ACCEPTANCE.md)：导入 1 GiB 视频/音频/图片、素材库筛选/搜索/详情/预览、视频拖动进度（Range）、删除、重启保留、跨工程隔离、AI 列素材、无内存暴涨。

自动化门禁（本阶段先绿色）：`check.mjs`、`smoke-client.mjs`（组件 harness）、`check-host.mjs`、`test-v1-storage.mjs` 回归；新增 `test-v1-media.mjs`（上传/索引/Range/限额/隔离/重启）；L3：`test-host-engine --staging`、`test-conversation-chain`、`test-canvas-chain`、`test-conversation-preview`。

## 8. 验证命令与约束

```sh
node --check host/*.js client.js
node scripts/check.mjs && node scripts/smoke-client.mjs && node scripts/check-host.mjs
node scripts/test-v1-storage.mjs && node scripts/test-v1-media.mjs
# L3 在 Lead 构建 staging 后跑；测试必须临时 dataRoot/HOME，真实数据根不被创建
```

- 按用户本轮授权由本会话提交/推送/开 PR/构建候选；不安装/重启 DSH、不改 DSH/asar/profile、不读凭据；测试只用 `/tmp` 临时 HOME/dataRoot。
- 版本按验证后独立提交升 `1.0.0-alpha.2`；engine client/worker 同升 `0.5.0`。
- 大文件不进仓库；测试产物 `/tmp`，证据摘要 `artifacts/v1/evidence/`。
- 不改 M1 已实现的数据根/迁移/文件夹按钮语义；如需小修，先报 Lead。


## 9. 接手实现与契约收敛（2026-10-21）

- 用户已明确将 M2 及后续 V1 开发交给本会话；保留接手时的任务卡和 `assets.mjs` 草稿，完成接线与验证。规则统一维护在 DEVELOPMENT。
- 资产 ID 仍为 sha 前 8 位，但去重按完整 SHA-256；短 ID 冲突明确 `E_ASSET_CONFLICT`，不覆盖。派生缓存文件名包含完整 SHA，避免删除/重导后复用旧缓存。
- `indexRevision` 为索引规范化内容的 SHA-256，用于判断变化；不是顺序号。媒体不进入 composition revision；M3 再接时间线。
- 缓存保存在工程 `.dsh-video/media-cache/`，沿用冻结的五键 worker registry，避免新增任意目录参数；缩略图/波形 30 秒超时，兼容代理 110 秒超时，可重试/可重建。索引是权威，缓存不是；无另立 derive.json。
- 删除检查 timeline 中的素材引用并报告片段 ID；损坏 timeline 拒绝删除。还检查 project.json/index.html 的媒体路径引用；先暂存媒体，索引写入失败则恢复，成功才清理缓存。
- 流式 inbox 支持中文名、计数限额、并发上限、剩余空间预检、取消、每分钟过期清理与生命周期排空；仅清理本实例持有的收件副本，不扫描/删除不明历史文件。
- 素材抽屉在只读产品画布中开放；上传进度来自 XHR upload 事件，上传阶段可取消；后端探测/派生显示处理中并受超时限制。支持多文件/拖放/分页/筛选/搜索/详情/原生播放和 seek/手动生成兼容代理/确认删除。引用标记为可选择文本，M5 再接原生 @。
- AI `asset.list` 复用原生 Session/project 归属检查，只读且分页 ≤50；Tool 不开放导入/删除/派生；显式读/导入后更新提示词素材数量摘要。
- 发现并复现 M1 基线测试工具 UTF-8 跨 chunk 解码损坏（长中文副标题 600→601）；仅修测试 helper 的流解码，生产场景逻辑未变。

### 当前本地证据（不是 DSH 安装/真实模型验收）

- `test-v1-media`：15 个场景，包括支持格式矩阵、探测、去重、真实 worker JSONL/schema、缩略图/波形/代理、短哈希碰撞、路径/缓存 symlink、引用删除保护、取消/限额/清理。
- `test-v1-media-routes`：Range 区间/后缀/open range、HEAD、416、额外参数拒绝。
- `test-v1-media-host`：真实 Host→worker，导入/同请求重放/探测/缩略图/Range/重启/删除，作品 revision 不变，Tool 写入拒绝。
- `--large`：有效 1 秒 MP4 补齐到 1 GiB（验证大字节吞吐与内存，不代表 1 GiB 复杂长片解码性能）；实际完成 1,073,741,824 字节导入，上传 Host RSS 峰值增量各次运行约 46–74 MiB（均低于 256 MiB 测试门限）；证据 `/tmp/m2-large.log`。最终候选另跑固定 staging 链。
- Chrome 真实媒体 UI：`/tmp/m2-browser-final/result.json` 与截图，13 项：多文件上传、自动缩略图/波形、元数据、视频 seek/播放、搜索、音频加载、刷新保留、340px 不横向溢出。
- 引擎 client 单元/集成/打包回归：23/23（启用已配置 Node 24 的 opt-in 项，无跳过）。
- 完整回归：check 58/58、smoke-client 86/86、check-host 71/71、worker 56/56；M1 存储 21/21。最终提交前重跑并记录差异。
- 未验证：DSH 实际加载 alpha.2、用户真机拖放/取消/重启保留、真实模型查询素材、真实用户 1 GiB 长片、非 darwin 平台。安装/重启/真实模型/合并尚未执行。


## 10. 固定候选交付（2026-10-21）

- PR：[M2 #18](https://github.com/heswy/dsh-video-editor/pull/18)，base `codex/v1-m1-storage`，依赖 [M1 #17](https://github.com/heswy/dsh-video-editor/pull/17)。两份均保持草稿、未合并；M1 合入后将 M2 retarget 到 main。
- 固定源码 root=engine=`939419e10fe5e0b3b9c526d6bc580558d850c9cb`，`rootDirty=false`；bundle `1.0.0-alpha.2`，client/worker `0.5.0`。
- staging：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-v1.0.0-alpha.2-939419e`。安装入口为该目录的 `bundle/`。
- `INTEGRITY.json` SHA-256：`0ead5c6bf48b340dc6712fe457ee3c46cff46ce7603d05426a76b1a7ed3903fa`，所有回归结束后未变。
- 持久证据：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/v1/evidence/m2-alpha2-939419e-20261021/verification-summary.json`（含日志、真实 Chrome 截图、chain/preview 完整证据，均不入 Git）。
- 前序 alpha.2 候选 `1e09a56`、`96cf93b`、`1476f91` 仅保留追溯，已被本候选替代，不安装、不热改、不删除。

### 最终验证

| 层 | 结果 |
|---|---|
| 静态/组件/Host | check **58/58**；smoke-client **86/86**；check-host **71/71**；stage-version **10/10** |
| 引擎单元与协议 | worker **56/56**；client **23/23**（Node 24 opt-in 启用，无跳过；含固定 tarball/导出入口校验） |
| 存储/素材 | M1 storage **21/21**；M2 media **15 个场景**；Range/HEAD/416/停用门禁通过 |
| Chrome 媒体界面 | **13 项通过**：多文件选择上传、拖放、自动缩略图/波形、类型筛选/搜索、详情、视频播放/seek、音频加载、刷新保留、确认删除、340px 无横向溢出 |
| 最终 staging 媒体 | 实际候选 Host/worker：带音轨有效 MP4 补齐到 **1,073,741,824 B**，上传/探测/去重语义/同请求重放/稳定 indexRevision/缩略图/Range/重启/删除通过；Host 上传 RSS 增量 **77,234,176 B（约 74 MiB）**；这是字节吞吐 fixture，不当作复杂长片解码性能 |
| 最终 staging 引擎 | `test-host-engine` **ok=true**：实际 Node 24 / HyperFrames / Chrome / ffmpeg；frame、MP4 render、取消与清理通过；无 Host warning |
| 最终 staging 画布 | `test-canvas-chain` **ok=true** |
| 最终 staging 对话 | `test-conversation-chain` **261/261**；`test-conversation-preview` **164/164**，B1–B5 全 true，源码只读审计 **same=true（86→86）** |

最终 staging 原始证据：`artifacts/p2-b/evidence/engine-run-2026-10-21T10-03-38-293Z.json`、`artifacts/p2-b/evidence/canvas-chain-2026-10-21T10-03-56-465Z.json`；对话/预览副本在上述持久证据目录。

补充回归已关闭：音视频元数据键顺序改变索引摘要、筛选切换后迟到缩略图不显示、正在导入的过期 receipt 被 sweep 重复遍历；分别先复现失败，再修复并验证。原 M1 测试辅助解码/真实数据根已存在时的守卫也已修正，生产 Scene 文本逻辑未改。

### 用户验收与下一步

本轮**未安装 alpha.2、未重启 DSH、未请求真实模型、未合并 main、未发布**。下一次用户授权的重启窗口，通过 Plugins → Add plugin → 上述 `bundle/` → Install → Enable now；重启后核对实际加载的 client 为 alpha.2，再按 V1.0-ACCEPTANCE 的 M1/M2 清单逐项记录。

M2 真机重点：①视频/音频/图片导入、进度/取消与重复去重；②筛选/搜索/详情/工程隔离；③缩略图/波形/重启后恢复；④素材播放/seek；⑤未用素材确认删除；⑥原生对话真实模型 `asset.list`。在用素材保护已由真实 worker/受控 timeline fixture 验证，真实片段的引用删除路径留待 M3 时间线接入时补验，不能代填为真机通过。

回滚保留 alpha.11 `artifacts/p2-b/staging-alpha11-51b95dc/bundle`，以及 M1 alpha.1 固定候选。保留已有数据根、用户作品、旧 staging；不回滚或删除用户数据。M3 及后续 V1 开发继续由当前会话负责，按用户联合验收结果推进，无需重新指定开发 Agent。
