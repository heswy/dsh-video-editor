# DSH Video 下一大版本预研报告与开发方案（v1.0 提案）

日期：2026-10-21（Asia/Shanghai）。状态：**已按用户决策修订（v2）；实施规划见 `docs/plans/V1.0-PLAN.md`，待“开始”指令后执行**。
基线：缓存 `origin/main` @ `1aabd6e`（PR #16 合并 0.3.0-alpha.11 收尾文档；网络暂不可 fetch，以本地缓存 main 为准）。当前已安装 **0.3.0-alpha.11**（staging-alpha11-51b95dc），engine client/worker `0.4.0`。调研原始材料基于 `9b0928e`（alpha.10）；alpha.11 只改顶栏 CSS/版本/文档，不影响结论。

**已确认的 v1.0 决策（2026-10-21 用户拍板）**：

| # | 决策 |
|---|---|
| 版本 | **1.0.0**（开发线 `1.0.0-alpha.1 … alpha.N`；engine 两包升 `0.5.0`） |
| 时间线 | **统一时间线**：`timeline.json` 真相 + 生成 composition；媒体片段与 AI 场景片段混排 |
| 音频 | **供应商可插拔**；首个试点 **千问云（qianwenai.com）**；本地 macOS `say` 保底；key 由用户配置（0600，永不入库/日志/提示词） |
| 数据根 | **`~/Movies/DSH Video/`**（用户可见；可配置，外置盘可覆盖） |
| @ 引用 | **接受宿主内部 API 方案**（`inputTriggers`，spike + 降级兜底） |
| 交付方式 | Lead 统筹：工作区/任务卡/评审/staging/验收；用户真机验收后才进入下一阶段；用户说“开始”后才开发 |

调研材料（均已入库到本 worktree `docs/research/`）：

| 文件 | 内容 |
|---|---|
| [2026-10-21-baocut-and-ai-editor-landscape.md](2026-10-21-baocut-and-ai-editor-landscape.md) | BaoCut 与 10 组 AI 剪辑产品对比、UX/架构模式、反模式 |
| [2026-10-21-audio-generation-research.md](2026-10-21-audio-generation-research.md) | 「opus5.5」澄清、音乐/TTS/SFX 能力与价格、接入架构、成本延迟 |
| [2026-10-21-dsh-platform-capabilities.md](2026-10-21-dsh-platform-capabilities.md) | DSH 0.2.1-rc.2 宿主能力矩阵：@ 扩展、Finder、音频播放、持久化、内部 API 风险 |
| [2026-10-21-video-plugin-architecture-audit.md](2026-10-21-video-plugin-architecture-audit.md) | 本仓库只读审计：版本/存储/数据模型/渲染/UI/门禁/风险 |
| [2026-10-21-timeline-architecture-research.md](2026-10-21-timeline-architecture-research.md) | 时间线数据模型、剪辑 op 协议、预览/导出管线、迁移与里程碑 |

---

## 0. 一页结论（TL;DR）

1. **当前大版本是 0.3，且已收尾**：已安装 `0.3.0-alpha.11`（0.3.0 的最后一次改动，顶栏修复）；engine client/worker `0.4.0`。下一版本从 post-alpha.11 的 main 开始。
2. **下一大版本已定为 `1.0.0`**（开发线 `1.0.0-alpha.1 … 1.0.0-alpha.N`，真机验收后发 `1.0.0`；engine 两包升 `0.5.0`）。这是首个公开发布版本，且是平台级能力（时间线/音频/素材/持久化）。
3. **五项需求不是五个独立功能，而是同一个工程模型的升级**：工程真相从"整篇 HTML composition"升级为 **`timeline.json`（tracks/clips/assets，帧为单位）**；受控 HTML composition 降级为**由 timeline 单向生成的渲染目标**，预览与导出仍共用 HyperFrames（媒体元素 + 原生音频混流）。这同时解决"AI 可操作片段""素材上轨""音频轨""@ 引用"四件事。
4. **音频不需要另造渲染器**：已装 HyperFrames `0.8.167` 原生支持 `<video>/<audio>`、`data-media-start`（源内 in 点）、`data-playback-rate`、`data-volume`，render 内部有 `extractAudioSegment`/`mixAudioTracks`（ffmpeg `amix` + AAC 192k）/`generateSilence`。真实阻塞在插件自己的 5 层校验（composition 禁媒体、资产只收 PNG/JPEG、预览无 Range、快照复制大文件、ffprobe 不验音轨），全部可改。
5. **生成音频**：不存在「Opus 5.5 音频模型」——公开信息显示 `opus5.5` 指 **Claude Opus 5.5**（2026-07/09），出圈用法是"写代码 + Web Audio/外部音乐 + ffmpeg 直出 MV"，不是音频 API。产品上做**可插拔的资产型生成**：首个试点 **千问云（qianwenai.com，TTS/音乐/音效/声音设计；详见供应商调研）**，备选 ElevenLabs/MiniMax/豆包/Mureka/Lyria；**本地 macOS `say` 中文旁白保底**（零配置、免 key）。user key 由用户配置、Host/worker 持有，永不进模型上下文；产物进素材库再上音轨；"Web Audio 代码合成音乐"不进 v1（render 不采集程序化音频）。
6. **@ 引用可以做成"真 @"**：DSH 客户端存在 `ctx.inputTriggers.registerSource()`（官方 `@file/@session` 同机制，内部 API，需 1 次 spike），可在宿主原生 Composer 里注册片段/素材候选并插入 chip；Host 侧配 `timeline.resolve` + system prompt 解析稳定 token（`@clip:cl_xxx`）。若 spike 失败，降级为"插件内引用 chip + 复制稳定 token + AI 主动 inspect"。
7. **存储必须重构，这是发布阻断项（S0）**：当前 `projectsRoot/registry/session-state/assetInbox` 全在**按版本新建的 staging 目录**里（`stage-dev.mjs:294-334`）。同一安装重启 DSH 工程还在；但换新 staging/清理 `artifacts/` 就从 UI 消失甚至真丢——alpha.9 的「Watch Demo」与 alpha.10 的「DS 宣传片」已是两个独立工程目录，**跨版本没有迁移**。v1.0 已定：稳定数据根 **`~/Movies/DSH Video/`**（可配置、可外置盘）+ 一次性迁移 + registry 容错 + `project.path/reveal` 文件夹按钮 + 上次打开工程持久化（**不能放 localStorage**：DSH desktop 每次 `--port 0` 随机端口，origin 变化 localStorage 即失效）。
8. **必须有一个 M0 预研验证门（Go/No-Go）**：验证 HyperFrames 媒体逐帧 seek 的渲染性能/稳定性（20s/120s 基准）、预览 iframe 内音频自动播放、Range/CSP、大文件内存、旧工程迁移视觉一致性。若媒体 capture 不可接受，启用兜底渲染器（ffmpeg 时间线组装），**数据模型与 op 协议不变**，只换渲染适配层。M0 不通过不进入 M1 全量开发。
9. **交付节奏**：M0 验证门（1–2 周）→ M1 存储与工程生命周期 → M2 素材库/媒体管线 → M3 时间线内核 + 视频轨 → M4 音频轨 + 生成音频 → M5 @ 引用 + AI 协作 → M6 发布硬化（1.0.0）。每个里程碑一个 `1.0.0-alpha.N` 固定 staging + 真机验收。
10. **风险最高的三件事**：① 媒体逐帧 seek 性能（行业公认坑，Remotion 为此做 OffthreadVideo）；② 跨版本用户数据迁移（迁移失败=发布事故）；③ 宿主内部 API（`inputTriggers`/`fetch.register`）随 nightly 漂移——必须集中在薄适配层并准备降级。
11. **本报告已获确认，实施规划另见 `docs/plans/V1.0-PLAN.md`**：版本/范围/音频供应商/数据目录/@ 方案均已拍板；正式开发从缓存 main `1aabd6e` 建 `codex/v1-*` 分支，用户说“开始”后按 M0→M6 推进，每个里程碑一个 `1.0.0-alpha.N` staging + 用户真机验收。

---

## 1. 现状基线（事实 + 证据）

### 1.1 版本与安装

| 事实 | 值 | 证据 |
|---|---|---|
| 当前大版本 | **0.3**（alpha 线） | 版本历史：0.1.x → 0.2.0/0.2.1/0.2.2 → 0.3.0-alpha.1…alpha.11 |
| 已安装 bundle | `0.3.0-alpha.11` | Plugins 页 v0.3.0-alpha.11 / 1 of 1；`~/.dsh/profiles/desktop/package.json` `link:` → `staging-alpha11-51b95dc/bundle` |
| main 最新（缓存） | `1aabd6e`（PR #16 合并 alpha.11 收尾文档；`package.json` = `0.3.0-alpha.11`） | 网络 fetch 暂不可用，以本地缓存 main 为准；alpha.11 是 0.3.0 最后一次改动 |
| engine 包 | client/worker `0.4.0` | `packages/video-engine-*/package.json:3` |
| 渲染依赖 | HyperFrames + SDK `0.8.167`、GSAP `3.15.0` | `packages/video-engine-worker/package.json:22-27` |
| 宿主 DSH | Desktop `0.2.1-rc.2`，nightly 通道，`hostProtocolVersion 4` | T3 报告 §一（asar `dsh/package.json`、`Info.plist`、`app-update.yml`） |
| 安装数据位置 | `artifacts/p2-b/staging-alpha11-51b95dc/{projects,managed,session-state.json,asset-inbox,...}` | 实际磁盘 + staging bundle patch |

### 1.2 今天的产品能力边界

- 右侧：宿主原生 AI 对话（模型/历史/Composer/附件），插件只嵌入 `conversation.content`，**不拥有输入框**。
- 左侧：只读预览（sandbox iframe + 快照路由）、播放/seek、导出 MP4（真实 render job）、顶栏作品名/工程切换/导出。
- 工程 = `project.json`（`entry/assets/title`）+ `index.html`（受控 HTML composition + GSAP timeline，≤48 KiB）+ `assets/`。
- AI 通过 `video_engine` Tool 的 `project.compose` 整篇写 HTML、`edit` 改元素、`scene.*` 改模板场景；revision = 内容哈希，`expectedRevision + operationId` 保证并发安全；history/undo 已有。
- **没有** track/clip/素材库页面/音频/输入框 @。Scene 只是 `product-launch-v1` 模板的 section，不是可裁剪片段。

### 1.3 与下一版需求的关键差距（详见 T4 报告 §7）

| 需求 | 现状缺口 |
|---|---|
| ① 生成音频 | 无音频生成能力（宿主也没有）；composition 禁媒体标签；资产只收 PNG/JPEG；导出 ffprobe 只验 `v:0`；预览无音频 |
| ② 视频轨/音频轨/剪辑 | 无 track/clip 实体；无 in/out、速度、多轨、转场；无双写者命令网关；无时间线 UI；Scene 不可切 |
| ③ 素材库 | 只有工程 manifest 里 ≤16 张图；无元数据/缩略图/波形/代理；素材抽屉只在开发路径可达；无列表接口 |
| ④ 输入框 @ | 输入框是宿主 Composer，插件不能读写草稿；宿主有 `inputTriggers` 内部服务可注册 source（需 spike） |
| ⑤ 存储/文件夹 | 数据根在按版本新建 staging 内、无迁移；无 `project.path/reveal`；上次打开工程只在内存；localStorage 因随机端口不可靠 |

### 1.4 DSH 宿主约束（决定方案形态）

- 插件不能改宿主 DOM/会话协议/凭据；只能用受支持 Slot/theme token/locale；内部 API 不属于承诺面（`inputTriggers`、`fetch.register`、`remote` 等）。
- 插件 Host 代码运行在 DSH 进程内，具备真实 `fs`/`child_process` 能力；有一条鉴权 `/api` fence 与 public exact webServer 路由两种载体（本插件已同时使用）。
- 宿主**没有** TTS/音乐生成能力；模型 provider 输入只有 text/image。生成音频必须插件自建 provider/本地命令。
- 42% 右栏、左列保底约 360px：**不能加第三列**，时间线只能放在左列预览下方/浮层。

---

## 2. 版本号方案（需要拍板）

### 2.1 版本历史

```
0.1.0 → 0.1.3   宿主壳 + 侧栏入口
0.2.0 → 0.2.2   Host bridge、独立 worker、预览快照、真实导出
0.3.0-alpha.1 … alpha.10   对话优先创作闭环、UI 优化、预览/导出、fileLink 修复（当前安装）
0.3.0-alpha.11  顶栏修复 candidate（main 已合并，未安装）
```

### 2.2 下一个大版本号

| 候选 | 含义 | 优点 | 风险 | 建议 |
|---|---|---|---|---|
| **1.0.0**（推荐） | 开发线 `1.0.0-alpha.1…N`，验收后 `1.0.0` | 与"发布"语义一致；一次到位，不再有 0.4→1.0 的额外仪式；对外/插件市场表达清晰 | 对稳定性承诺更高；需配套发布门禁 | **推荐** |
| 0.4.0 | `0.4.0-alpha.1…N` → `0.4.0` | 保守，保留继续大改空间 | 首个公开版是 0.4 显得"还没完成"；发布后还要再跳 1.0 | 备选 |
| 0.3.0（去掉 alpha） | 当前线收稳定 | 改动最小 | 容纳不下时间线/音频/存储重构，语义不符 | 不推荐 |

**推荐约定**：

- root bundle：`1.0.0-alpha.1` 起，每完成一个里程碑出一个 candidate（真机可验收），全部通过后 bump `1.0.0`。
- engine client/worker：`0.4.0 → 0.5.0`，把新版本对加入 `scripts/stage-dev.mjs` 的 `REVIEWED_ENGINE_PAIRS` / `MANAGED_ENGINE_VERSIONS`（`:70-79`）。
- 版本号同步点（技术债，R10）：`package.json`、`scripts/check.mjs:137-139` 的硬编码断言、`scripts/test-stage-version.mjs` 的 `REVIEWED_BUNDLE_VERSION`、README/STATUS/handoffs、staging 名 `staging-v1.0.0-alpha.N-<sha>`。
- 发布定义：`1.0.0` = 通过 §8 发布门禁 + 用户真机清单 + 数据迁移演练；**不是**"合并 PR"或"构建 staging"。

> 如果你更看重"先发 0.4 观察一轮再 1.0"，把上表整体读作 0.4.0 即可，架构与里程碑不变，只改版本串。

---

## 3. 调研结论（外部 + 宿主）

### 3.1 BaoCut 与 AI 剪辑形态（详见 T1 报告）

- **BaoCut 是真实产品**（`JimLiu/baocut`，v3.9.0，Electron + Rust 引擎 + WASM 预览，Apache-ish source-available），定位「**AI video agent with an editable timeline**」——视频是可编辑真相，MP4/SRT 只是导出物，明确支持 `baocut/1` 与 **`hyperframes/1`** 契约，与我们路线同构。
- 最值得借鉴的三件事：
  1. **单一命令网关**：UI 手势、Agent 工具、流程结果都走同一套 `EditOperation → 事务 → 回执 → 撤销栈`，没有旁路；写操作强制 `expectedRevision`，冲突不自动重放。
  2. **回执（receipt）**：返回 `created/updated/deletedIds + lineage（split 前后对应）+ 时长变化 + 失效依赖 + undo 可用性`，"回执前不宣称完成"；这是 AI 操作可见、可解释、可回滚的基础。
  3. **引用 = 自动上下文 + 稳定落点**：消息自动附编辑器状态（打开视频/revision/选中片段/播放头）；批注带时刻+区域+段/句+元素；发送前冻结上下文。行业里"编号引用（第 2 段）"会随剪辑漂移，不能当契约。
- 产品形态上，**没有一家从对话-first 直接长成完整 NLE**：BaoCut 用「审片视图（按段分格）+ 时间线视图」双视图共享同一模型与撤销栈过渡。我们应该照做（先片条/轨道简化视图，不做 CapCut 克隆）。
- 反模式：UI 直改工程文件（双写）、把时间线写进 composition 当真源、位置式引用当契约、回执缺失、音频塞进片段属性、导出链不带音频、自动索引用户全盘素材。

### 3.2 DSH 宿主能力（详见 T3 报告）

| 能力 | 结论 | 对方案的含义 |
|---|---|---|
| 原生 Composer @ 扩展 | ✅ 有机制（`ctx.inputTriggers.registerSource()`，官方 @file/@session 同机制），但**非文档化 API** | 需求 4 可做"真 @"，需 spike + 适配层 + 失败降级 |
| 引用 chip 序列化 | ✅ chip + 文本送模型；`appearance` 只允许 `session|file|folder` | 我们插 `@clip:cl_xxx` 文本 token，AI 用 Tool 解析 |
| 打开工程文件夹 | ✅ 插件 Host `spawn('/usr/bin/open',[dir])`（DSH 自己也这么做）；或内部 Remote `session/openWorkspacePath` | 文件夹按钮走自建 Host 路由，路径只来自 Host 权威 |
| 面板内音频播放 | ✅ 普通 DOM 可 `<audio>`/`new Audio()`；无全局 CSP | 素材/音频预览放在插件面板；自建 Range 路由 |
| 聊天内音频/视频播放 | ❌ 无原生播放器 | 不承诺聊天内播放；相关素材在插件面板预览 |
| 宿主音频生成 | ❌ 无 TTS/音乐 | 生成音频自建 provider/本地命令 |
| 持久化 | Host 文件唯一权威；`$DSH_HOME/storages/<plugin>/` 有第三方先例；localStorage 因随机端口不可靠 | 工程数据落稳定目录；UI 偏好也进 Host 文件 |
| 版本稳定性 | nightly，4 天内 rc.2→rc.2；内部 API 无 semver | 内部 API 集中适配层 + 启动自检 + 降级 |

### 3.3 生成音频（详见 T2 报告）

- **「opus5.5」判断**：≈85% 指 Claude Opus 5.5（2026 年）的"代码直出 MV"现象；≈10% 是把 Suno v5.5 记混。**不存在 Opus 音频模型**。
- 可落地 provider（2026-10）：
  - 音乐：ElevenLabs Music v2（$0.15/min，条款清晰）、Google Lyria 3/3.5（$0.04–0.08/次）、MiniMax Music 3（≈¥0.4/30s，中文友好）、Mureka V9.5（官方 API、商用授权）。Suno 无官方 API（聚合商逆向，不设默认）；Udio 围墙花园排除。
  - 旁白：ElevenLabs v4/Turbo、豆包 TTS（≈¥4.5/万字符）、MiniMax Speech、Fish Audio、本地 CosyVoice3；**macOS `say` 零配置**（中文 Tingting/Meijia 等系统音色，可直接出 AIFF→m4a）。
  - 音效：ElevenLabs SFX（$0.12/min）、Stable Audio。
  - 成本量级：30s BGM ≈¥0.3–0.6、30s 旁白 ≈¥0.01–0.05、整片音频 <¥1；瓶颈是 10s–2min 异步延迟与失败/取消。
- **v1.0 已定**：**供应商可插拔的资产型生成**——首个试点 **千问云（qianwenai.com；TTS/音乐/音效/声音设计，API 细节见同批供应商调研 `2026-10-21-qianwen-audio-provider.md`）**，适配层 `AudioProvider` 支持能力发现与替换；**本地 macOS `say` 中文旁白保底**（零配置、免 key）。key 由用户配置（`~/Movies/DSH Video/settings/` 或环境变量，0600），Host/worker 持有，永不进模型上下文/日志/仓库；生成走异步 job（可取消/重试/计费提示）；产物经 asset 导入进工程素材库 → 用户或 AI 上音轨。

---

## 4. 总体架构决定（v1.0）

> 这一节是本方案的核心。每条都对应到可写进 `docs/DECISIONS.md` 的决策记录。

### D1. 时间线是工程唯一真相；composition 是由它生成的渲染目标

- 新增 `<projectDir>/timeline.json`（schema `dsh-video/timeline@1`）：`settings`（分辨率/fps=30/背景/总长/响度目标）+ `assets[]` + `tracks[]`（视觉轨 z-order、音频轨 gain/role）+ `clips[]`（`media | image | scene`，含 `startFrame/durationFrames/sourceInFrame/speed/volumeDb/fade`）。
- `index.html` 不再由 AI 整篇提交，而是 worker 从 timeline **确定性生成**的受控 composition（媒体元素 + 模板/场景 section + audio 元素），只用于预览与导出，可随时丢弃重建。
- 预览与导出共用这一份生成结果、同一个 HyperFrames 引擎——保证"预览看到的就是导出的"。
- 旧 `project.compose`/`scene.*`/`edit` 动作在 legacy 工程上保留；新工程走 `timeline.apply`（详见 D2/D5）。
- 好处：字段级 diff、原子批量、稳定 ID、AI 小 payload、规模上限高；坏处：需要一次性迁移与生成器。**不做 C 方案双向同步**。

> 依据：T5 报告 §2–§3；BaoCut「video 是真相，文件只是导出」；反模式「时间线写进 composition 当真源」。

### D2. 统一工程模型：媒体片段 + AI 场景片段都在同一时间线上

- **视觉轨**（v1 ≤2 条）：`media`（视频 mp4/mov 等，可 split/trim/移动/换轨）、`image`（图片 + 时长）、`scene`（AI 生成的 HTML 场景文档，作为子 composition 片段）。
- **音频轨**（v1 ≤3 条，角色 voice/music/sfx）：媒体原声、上传音频、生成音频；轨级 gain/mute、clip 音量/淡入淡出、速度。
- **AI 创作路径不变味**：AI 仍可自由写 HTML/GSAP，只是提交单位从"整片"变成"场景文档"（`scene.compose`，每场景 ≤48 KiB，可多段），场景按顺序落在视频轨，用户可 split/排序/再剪；模板场景（`product-launch-v1`）继续作为便捷生成器。
- **旧工程迁移**：惰性一次性转换。**默认粒度 = 整篇 composition → 一个 `scene` clip**（原文件原样作为场景文档，内部 Scene/GSAP/全局时间线都不拆，视觉零变化，SSIM 门禁，风险最低）；M0 迁移原型再对比"按 Scene 拆分"（每个 Scene 一个 scene clip，便于分段编辑，但可能破坏跨 Scene 的全局动画），若实测 SSIM 达标再作为 v1.1 增强。迁移前备份 `.dsh-video/legacy/`，可回滚。
- 若 M0 证明嵌套子 composition 在预览/渲染中不可用：场景 clip 自动改为"烘焙为视频资产"（异步 render 成 clip 视频），数据模型/操作不变，只换生成策略。

> 依据：T5 §3.1/§7.1；BaoCut 双视图过渡；我们现有用户作品必须零回归。

### D3. 音频 = 工程级音轨 + 原生 media 元素 + HyperFrames 混音

- 音频不是 composition 外的"外挂后混流"，而是生成 composition 里的 `<audio>`/`<video>` 元素（`data-start/duration/media-start/playback-rate/volume`），由 HyperFrames 预览 runtime 与 render 的 `mixAudioTracks` 统一处理。
- 导出新增校验：`a:0` 必须是 AAC/48kHz/双声道；音视频时长差 ≤1 帧；透出引擎 `audioFailures` 诊断；渲染超时按工程时长自适应（目标 `max(900s, 60s + 3×duration)`）。
- 响度：默认 -16 LUFS（可在工程 settings 调）；若引擎参数不可控，导出后加一遍 ffmpeg `loudnorm` 二遍法。
- 波形/节拍分析复用 HyperFrames `audio`/`beats` 模块或 ffmpeg/librosa 派生缓存，不进 revision。
- 预览音频有自动播放风险（sandbox opaque origin）：M0 验证；失败则父页面 WebAudio 调度兜底，UI 明示"点击开启声音"。

> 依据：T5 §5；T2 修正版；已装 0.8.167 的 `mixAudioTracks`/`extractAudioSegment` 证据。

### D4. 素材 = 内容寻址 + 工程级媒体路由（HTTP Range）

- 工程内 `assets/<sha8>.<ext>`，只增不改、内容去重；`timeline.json` 的 `assets[]` 记录 `kind/durationFrames/fps/width/height/hasAudio/sha256/bytes`（ffprobe 得出）。
- 导入：插件 UI 文件选择/拖拽 → Host 流式上传（临时 inbox，限额）→ worker 探测/校验/内容寻址落盘 → 写 timeline 资产表（原子）。
- 媒体路由：`/api/dsh-video/media/<projectId>/<sha8>.<ext>`，**206 Range/HEAD/流式读盘**，注册时一次性校验 hash、之后按"资产只增不改"信任；不把 GB 文件读进内存、不复制进预览快照。
- 预览快照只含生成入口 HTML + 小 overlay；大媒体由稳定 asset 路由提供；CSP `media-src 'self'`；快照子资源继续走 public exact 路由（能力路径）。
- 派生缓存：`cache/thumbs`、`cache/waveforms`、`cache/proxies`（大/非 30fps 源生成 720p/30fps 代理），全部可重建、不进 revision。
- 限制：格式白名单 `mp4/mov/m4v/webm`（v1 以 H.264/AAC 为准）+ `mp3/wav/m4a/aac/flac` + `png/jpg`；单文件默认 **2 GiB**、单工程默认 **8 GiB**（可配置）；VFR/29.97 源导入时转 CFR 30 代理并提示。**注意本机磁盘余量约 19 GiB**：默认数据根在 `~/Movies/DSH Video/`，同时提供 `DSH_VIDEO_DATA_ROOT` 覆盖以支持外置盘；剩余空间低于阈值时 UI 预警并阻止继续导入。

> 依据：T5 §5.4；T4 §2.4。

### D5. 存储：稳定数据根 + 迁移 + 文件夹按钮 + 上次打开工程（发布阻断项）

- **数据根**（Loader config 可覆盖，默认）：
  ```
  ~/Movies/DSH Video/                      # 用户可见；folder 按钮直达
  ├── registry.json                        # 工程登记表（id → 目录）
  ├── session-state.json                   # 工程 ↔ DSH 创作会话映射
  ├── ui-state.json                        # 上次打开工程、面板比例等 UI 偏好（Host 权威）
  ├── projects/<projectId>/                # timeline.json + assets/ + scenes/ + .dsh-video/history
  ├── asset-inbox/                         # 上传临时收件箱（TTL/清理）
  ├── exports/                             # 导出产物（可选保留）
  └── cache/                               # 全局派生缓存（可重建）
  ```
  备选：`$DSH_HOME/storages/dsh-video/`（隐藏目录，第三方插件有先例）。**二选一见 §9 待拍板。**
- **配置原则**：staging/发布包不得写死绝对路径；bundle patch 的 `config` 只放默认数据根（或空，由 Host 从 DSH env 推导），显式覆盖仅用于迁移/测试。
- **迁移**：首次启动 v1.0 时，若新数据根为空：读旧 staging 的 `config.json`/registry（可由 `legacyDataRoots` 配置或扫描已知 staging 目录）→ 复制工程 + registry + session-state 到新根（**复制不移动、旧目录保留**）→ 写 `migration.json` 记录来源/时间/结果；失败不阻塞启动，UI 提供"导入旧工程"入口。发布前必须做一次真实用户工程迁移演练 + 回滚演练。
- **registry 容错**：单个工程目录不可读 → 该工程标记 `quarantined` 并在列表里显示"需要修复"，**不能**让整个 bridge 返回 `E_CONFIGURATION`；损坏 registry 先尝试 `.bak`/原子写残留恢复；session-state 支持备份与重建（最坏重建映射，不删数据）。
- **文件夹按钮**：`project.path`（UI-only，返回权威绝对路径）+ `project.reveal`（UI-only，Host 校验 realpath 在数据根内 → `spawn('/usr/bin/open',[dir])`；Windows/Linux 对应 `explorer`/`xdg-open`）。UI 同时在菜单里显示路径 + "复制路径"兜底。
- **上次打开工程**：写 `ui-state.json`（Host 权威，原子写），boot 优先恢复；不再依赖 localStorage（随机端口会清）。
- **保存状态**：写操作天然原子 + revision；UI 显示"已保存到 revision xxx / 保存中 / 失败可重试"；关闭面板/退出前强制 flush（若引入去抖）。
- **历史**：v2 快照内容改为 `timeline.json`（小）+ 场景文件引用（内容寻址，不复制）；保留最近 N 版 + 导出记录。

> 依据：T4 §2；T3 §3 持久化；BaoCut 版本/快照/diff 设计（缩小版）。

### D6. @ 引用：原生 Composer source + 稳定 token + resolve 工具

- **主路径**（需 M0 spike）：`ctx.inputTriggers.registerSource({trigger:'@', name:'dsh-video-clip', ...})`，候选来自插件 Host 的"可引用对象"接口（片段/素材/场景/播放头区间）；onPick 插入 chip + 序列化文本 `@clip:cl_xxx`（appearance 用 `file`）；`ctx.systemPrompt.section()` 注入 token 语义；Host Tool 增加 `timeline.resolve`，把 `@clip/@asset/@range/@index` 解析为稳定 ID，歧义返回候选不猜。
- **降级路径**（spike 失败/宿主变更）：插件内"引用条"：用户点选片段/素材 → chip + "复制引用" → 粘贴进宿主输入框；AI 先 `timeline.inspect` 拉上下文。功能可用，只是 @ 菜单不原生。
- **不做**：改宿主 DOM、伪造 `dsh-session:`、把位置编号当契约。
- 选择状态同时进入 `ui-state`/Host 内存，并在 Tool 调用时作为上下文返回（"用户当前选中/播放头在哪"）。

> 依据：T3 §3 需求 4；T5 §4.4；BaoCut 自动上下文经验。

---

## 5. 数据模型与 API 契约（摘要）

> 完整字段、JSON 示例、错误码见 T5 报告 §3–§5；这里只列对实现/评审最关键的部分。

### 5.1 工程目录（v2）

```
<projectDir>/
  project.json          # manifest v2: {schema:"dsh-video/project@2", entry:"timeline.json"|"index.html", title, assets[]}
  timeline.json         # ★真相（schema dsh-video/timeline@1）
  assets/<sha8>.<ext>   # 内容寻址、只增不改
  scenes/<sha8>.html    # AI 生成的场景 composition（≤48 KiB；或模板生成）
  index.html            # 生成物（预览/导出用；legacy 工程保留旧 index.html）
  .dsh-video/
    history/            # entries/ops/state + snapshots/<rev>/timeline.json
    legacy/             # 迁移备份
    cache/              # thumbs/waveforms/proxies（派生）
```

### 5.2 关键不变量

- `revision` = `sha256(JSON({schema, files:[{path,bytes,sha256} sorted]}))`，只覆盖真相文件（timeline/scenes/assets manifest）——沿用现有语义，`expectedRevision` 冲突处理不变。
- 稳定 ID：`assetId = as_<sha8>`（内容寻址）；`clipId = cl_<10 base32>`（**永不复用、不从位置派生**）；`trackId = tr_v1/tr_a1`；split 左段保留原 ID、右段新 ID，回执带 `lineage`。
- 时间：真相层统一整数帧 @30fps；素材 in/out 存源 fps 帧；API 可收秒但只 round 一次并回执双写；v1 不做 29.97/VFR 原生支持。
- 单轨不重叠；`E_OVERLAP`/`E_RANGE`/`E_CLIP_NOT_FOUND`/`E_TRACK_KIND`/`E_TRANSITION_INVALID`/`E_TIMELINE_INVALID` 等 typed error；批量 op 原子（失败全不写，返回 `failedOpIndex`）。
- 所有写：`expectedRevision + operationId + ops[]`；operationId 幂等；单写者队列；不自动重放/不自动 rebase。

### 5.3 AI Tool 面（`video_engine` 扩展）

| action | 用途 | 关键参数/回执 |
|---|---|---|
| `timeline.inspect` | 读时间线（分页/限量，结果 ≤64 KiB） | `view/trackId/offset/limit` → settings/tracks/clips/assets + revision |
| `timeline.apply` | 批量剪辑操作（UI 与 AI 同一入口） | `expectedRevision/operationId/ops[]/dryRun` → revision + applied[] + lineage + changeSummary + undoHint |
| `timeline.resolve` | 把 `@clip/@asset/@range/@index/第N段` 解析成 ID | 歧义返回候选 + warnings，不猜 |
| `scene.compose` | 提交/替换 AI 场景 HTML（≤48 KiB，沿用受控校验但允许场景文档） | `sceneId?/html/revision` → sceneId/sha/revision |
| `scene.inspect` | 读场景文档 + 元素 stableId（只读） | html/elements（供 AI 修改） |
| `asset.list` | 列工程素材元数据（供 AI 参考/选材） | assets[]（id/name/kind/duration/dims） |
| `audio.generate` | 异步生成旁白/BGM/SFX（provider 配置后） | jobId + 状态/取消；完成后产物进素材库 |
| `project.path` / `project.reveal` | UI-only；文件夹按钮 | 绝对路径 / 已打开 |
| 现有 legacy | `project.compose`/`scene.*`/`edit` 仅 legacy 工程 | 迁移后 deprecated，最终移除 |

### 5.4 素材/媒体接口

- `POST /api/dsh-video/asset-upload`：扩展格式/流式/限额，返回 receipt；`asset.import` worker 侧探测+入内容寻址库+更新 timeline assets（UI-only）。
- `GET /api/dsh-video/media/<projectId>/<sha8>.<ext>`：Range/HEAD/流式；只服务已注册工程的声明资产；注册时校验 sha、路径 realpath。
- `POST /api/dsh-video/open-project-dir`：UI-only 文件夹按钮。
- `GET /api/dsh-video/refs`（或 request action）：@ 候选（片段/素材/场景/区间）+ 当前 revision，供 inputTrigger source 使用。

---

## 6. 前端设计（与当前风格一致）

> 设计原则沿用 `docs/design/FRONTEND-DESIGN.md`：灰白工作面、精细字体层级、细线图标、作品贡献颜色、玻璃只作少量点缀、动效服务反馈。**不新增第三列、不套卡片、不堆参数。**

### 6.1 布局（左列 = 预览 + 时间线，右列 = 原生 AI）

```
┌─────────────────────────────────────────────────────────────┐
│ ←  作品名 ▾（菜单含：重命名 / 在 Finder 中显示 / 复制路径）  导出 MP4  │
├──────────────────────────────────┬──────────────────────────┤
│                                  │                          │
│      [ 预览 16:9 ]               │   宿主原生 AI 对话         │
│      （自动跟随 revision）        │   （模型/历史/输入框）     │
│                                  │                          │
│  ▶ 00:12.4 ────────●───── 00:22  │                          │
│  ◎ 引用：片段「开场」 00:00–00:08  │   [ 引用 chip 复制到输入框 ]│
├──────────────────────────────────┤                          │
│  时间线（可折叠，展开 ~200px）     │                          │
│  [片条|轨道] ⊕ ✂ 🗑 缩放 ———    │                          │
│  V2  标题卡 ▓▓▓                  │                          │
│  V1  开场 ███ 中段 ███ 结尾 ██   │                          │
│  A1  🎙 旁白 ▒▒▒▒▒▒▒             │                          │
│  A2  🎵 BGM  ▒▒▒▒▒▒▒▒▒▒▒▒        │                          │
└──────────────────────────────────┴──────────────────────────┘
```

- **默认态**：保持当前"左预览 + 右对话"；时间线区域以 **32–40px 的"片条"** 存在（按 Scene/片段分格，可点选、显示总长），不抢画面；点开才展开完整轨道（高度 ~200px，可拖拽调高，100–320px）。
- **视图切换**：`片条 ｜ 轨道`（对应 BaoCut 审片/时间线），共享同一模型与撤销栈；默认用户"看片"用片条，编辑用轨道。
- **素材库**：左列左上"素材"按钮打开浮层/抽屉（宽 ~300px，可占预览左侧或不遮 AI），网格缩略图 + 全部/视频/图片/音频筛选 + 导入 + 搜索；拖到时间线 = 添加片段，拖到"引用条" = 引用给 AI。
- **音频生成入口**：时间线工具栏"音频"按钮 → 小面板（旁白/配乐/音效；provider/音色/时长；生成→试听→入轨）；也可直接在对话里说"给这段配旁白"（AI 调 `audio.generate` + `timeline.apply`）。
- **引用 chip**：选中片段/素材/区间后出现在预览下方（或时间线工具栏上方），显示名称+时间范围+`@clip:cl_xxx`，一键复制；若原生 @ 可用，同时出现在宿主 Composer 的 @ 菜单里。
- **变更回执**：AI/手动操作完成后左下角"变更卡"（改了什么、时长变化、撤销按钮），与历史面板对应；不让用户在无反馈下猜测。
- **保存状态**：作品名旁状态点（已保存/保存中/失败），悬停显示 revision/时间；失败可重试。
- **空态**：无工程时左侧留白 + 一句提示；素材入口可先收集素材，建工程后转入。
- **窄容器**（<900px）：右栏上下堆叠（现状保留），时间线在左列下方折叠。
- **风格细节**：全部颜色用 `--dsw-alias-*`；新增图标走同一套细线 SVG；交互动效 100–160ms（浮层 180/120ms）；轨道块用作品色/中性色，避免彩色装饰；`prefers-reduced-motion` 生效；键盘可达（空格播放/暂停、`S` 切分、`Delete` 删除、方向键微调、Esc 取消选择）。
- **文案**：中英双语沿用 client 内联字典；新增文案（时间线/素材/音频/引用/文件夹/保存状态）同步两份。

> 可另出 1–2 张概念图辅助确认（本 worktree `docs/design/concepts/`，标注"概念图，非真机"）。

### 6.2 与现有 UI 的兼容

- 现有顶栏"作品名 / 工程箭头 / 导出"保留；工程菜单新增"在 Finder 中显示 / 复制路径 / 素材库 / 历史"入口。
- 现有预览 iframe/自动跟随/失败恢复/导出状态全部复用；新增时间线只是左列下方新区域，不改右栏宿主对话。
- 现有"只读画布"定位不变：时间线是可交互面，预览仍是只读（v1 不做画布内直接拖拽对象）。

---

## 7. 里程碑与任务拆分（建议）

> 每个里程碑 = 一个 `1.0.0-alpha.N` 固定 staging + 真机验收；未通过不进下一个。团队按仓库规则从 post-alpha.11 的 main 建 `codex/v1-*` 分支，Lead 构 staging/评审/验收。

### M0 预研验证门（Go/No-Go，1–2 周，不发布）

范围：用真实素材做技术验证，产出实测数据表与决策记录。

1. HyperFrames 0.8.167 媒体行为核对：`<video>/<audio>` 的 `data-start/duration/media-start/playback-rate/volume/fade`、嵌套 `data-composition-src`、音量自动化、变速是否变调。
2. 渲染基准：20s / 120s 工程（3–5 个 media clip + 1 scene + BGM/旁白），记录耗时、帧数、音画偏移、内存峰值、失败率；验证 900s 超时是否够。
3. 预览验证：sandbox iframe 内 media + audio 播放/seek/自动播放；Range 路由；CSP `media-src`；大文件流式。
4. 大文件模型验证：1 GB 源导入/探测/代理/预览/渲染的内存与耗时；`Projects.read()` 改造原型。
5. 迁移原型：alpha.10 真实用户工程副本（「DS 宣传片」）→ v2，抽帧 SSIM、时长/分辨率/音频一致性；回滚演练。
6. @ spike：`inputTriggers.registerSource` 在第三方 bundle 是否可用；chip 序列化/模型可读性。

**Go/No-Go**：媒体 capture 可接受（导出耗时与稳定性达标）→ 按 B-1 进入 M1；否则启用 E2（ffmpeg 时间线渲染）兜底，M1 预算上调、数据模型不变。预览音频自动播放失败 → 父页面 WebAudio 兜底。@ 不可用 → 降级方案。

交付：`docs/research/v1-M0-*.md` + 实测表 + DECISIONS 记录；用户可见的真机 demo（不需新 UI）。

### M1 存储与工程生命周期（alpha.1）——发布阻断优先

- 稳定数据根 + 可配置 + 目录初始化迁移；`legacyDataRoots` 扫描与一次性复制迁移（旧目录保留、`migration.json` 记录、失败可重试）。
- `project.path` / `project.reveal`（UI-only，权威路径、跨平台 open）；文件夹按钮 + 复制路径；工程菜单。
- `ui-state.json`：上次打开工程、面板比例、时间线展开状态；boot 优先恢复并校验。
- registry 容错：单工程 quarantine 而非全桥失败；损坏恢复（bak/原子残留）；session-state 备份/重建。
- 保存状态 UI + 关闭/退出 flush。
- 门禁：重启一致性 E2E（worker/Host 重启）、升级迁移 E2E（alpha.10 staging → v1）、路径/权限/失败路径单测、真机验收。

### M2 素材库与媒体管线（alpha.2）

- 内容寻址资产库 + `assets/` manifest；导入 UI（文件选择/拖拽）、流式上传、ffprobe 元数据、格式白名单、限额。
- 工程级 media 路由（Range/HEAD/流式/CSP/能力校验）；缩略图/波形/代理异步 job + 缓存。
- 素材库页面（按工程、筛选、搜索、详情、删除引用检查）；`asset.list` Tool；AI prompt facts 更新。
- 门禁：1 GB 导入、格式矩阵、跨工程隔离、删除在用素材拒绝、路由 Range/穿越测试。

### M3 时间线内核 + 视频轨（alpha.3–alpha.4）

- `timeline.json` schema + revision v2 + 原子写/幂等/冲突；history 快照 v2；legacy 惰性迁移 + SSIM 门禁。
- 生成 composition 管线（确定性序列化、media 元素、scene section、background/gap）；媒体路由接入预览；扩展 canvas-runtime 媒体同步（或按 M0 结论）。
- 操作：`clip.split/trim/delete/move/reorder/insert/duplicate/speed/replace`、`track.add/update/remove`、`timeline.settings`；`timeline.inspect/apply/resolve` + 回执（lineage/summary/undoHint）。
- 时间线 UI：标尺/轨道/片段块/选择/拖拽/trim 把手/剪刀/删除/缩放/吸附；播放头与预览同步；片条视图。
- AI 场景片段：`scene.compose/scene.inspect`（若 M0 通过）；AI 多场景生成落在视频轨。
- 导出：媒体 + 场景 render，视频 h264/30fps/时长校验；音频在 M4 接入但数据字段先就位。
- 门禁：20s 3 段工程 AI 8 个 op 完成"切/排/精调"；预览误差 ≤2 帧；导出 ±1 帧；冲突/幂等/undo 全覆盖；迁移 SSIM≥0.98；1 GB 不 OOM。

### M4 音频轨 + 生成音频（alpha.5）

- 音频轨/clip 模型与 UI（波形、gain/mute、音量/淡入淡出、速度）；video 原声抽取为音频 clip（或音轨引用）。
- 生成 composition `<audio>` + 预览音画同步（含自动播放兜底）+ 导出 AAC/48kHz + loudnorm + `a:0` 校验 + `audioFailures` 透出。
- 生成服务：本地 `say`（旁白，默认可用）；外部 provider 适配层 + 设置 UI（key 0600，永不上屏/不进模型）；异步 job/取消/重试/费用提示；产物入素材库。
- 门禁：BGM+旁白双轨真机验收；A/V 偏移 ≤1 帧（测试片 0/5/10/20s）；响度 -16±1 LUFS；生成失败不污染工程；key 泄漏审计。

### M5 @ 引用 + AI 协作（alpha.6）

- inputTrigger source（片段/素材/场景/区间）+ chip + `timeline.resolve` + system prompt 语法说明；降级路径同 M0 结论。
- 变更回执/变更卡、dryRun、可解释 summary；AI/UI 交替操作冲突恢复 UX；AI 场景测试集（30 条中文剪辑指令，一次成功率 ≥95%）。
- 门禁：引用解析 100% 走 resolve；AI 误操作可撤销；真实模型多轮修改（3+ 轮）不丢内容。

### M6 发布硬化（alpha.7 → 1.0.0）

- 性能/内存预算；预览/导出一致性回归套件；120s 工程实测；失败/取消/超时路径。
- 打包与版本：`RUNTIME_PATHS` 新文件、Config 键、版本门禁单一来源、staging 可复现、README/STATUS/DECISIONS/设计文档更新。
- 发布演练：全新安装 → 创建 → 导入 → 编辑 → 生成音频 → 导出 → 重启/升级 → 迁移旧工程；回滚演练。
- 发布门禁：`npm run check`、worker/engine 单测、`test-stage-version`、真链（host-engine/canvas/conversation）、真 DSH 安装 + 用户验收清单；发布说明与已知限制。

---

## 8. 验收与发布门禁（摘要）

**功能验收（真机，用户视角）**
1. 新建工程 → 导入 1 个长视频 → 切成 3 段 → 重排 → 精调某段 → 预览可播/可 seek。
2. 对话说"把第二段放到最前面""再从这里剪一刀""这段提到 5 秒" → AI 通过稳定 ID 操作，变更卡可撤销。
3. 生成旁白/BGM → 入音轨 → 调音量/淡入淡出 → 预览有声 → 导出 MP4 用 `ffprobe` 验证 h264 + aac 48k、时长一致、响度达标。
4. 素材库：导入视频/图片/音频、缩略图/波形、AI 能列出并引用、删除在用素材被拒。
5. 输入框 @：选片段/素材 → 插入引用 → AI 理解并操作；失败可复制 token 降级。
6. 重启 DSH 3 次、升级到下一 candidate：工程/时间线/素材/会话映射都在；文件夹按钮打开正确目录；旧 alpha 工程可迁移且视觉一致。
7. 旧 AI 生成作品仍能打开、播放、导出（视觉零回归）。

**工程门禁**：`npm run check`、`scripts/smoke-client.mjs`、`scripts/check-host.mjs`、worker/engine 单测、`test-stage-version`、真链 `test-host-engine`/`test-canvas-chain`/`test-conversation-chain`/`test-conversation-preview`；新增：timeline schema/op/conflict/undo、迁移、重启/升级、音频 render 校验、媒体路由 Range/安全、@ 引用集成。

**发布清单**：版本号单一来源；staging INTEGRITY；数据根默认值/迁移路径文档；回滚到 alpha.10 staging；已知限制（非 30fps/VFR、无 WebAudio 合成、无云同步、无声音克隆）；隐私（不上传素材、不自动索引磁盘）；第三方音频 provider 条款与 key 说明。

---

## 9. 风险与待拍板事项

### 9.1 风险（按影响）

| 等级 | 风险 | 缓解 |
|---|---|---|
| **S0** | 跨版本数据迁移失败 = 用户作品"消失" | M1 优先；复制不移动 + 迁移记录 + 演练 + 回滚；发布阻断 |
| **S0** | HyperFrames 媒体逐帧 seek 慢/不稳（行业坑） | M0 基准 + Go/No-Go；失败启用 ffmpeg 时间线兜底（模型/op 不变） |
| **S1** | 大视频资产与现有"全量读入/快照复制"模型冲突 | M0 原型 + D4 流式/hardlink/Route 设计；M1 前完成读取改造 |
| **S1** | 预览 iframe 音频自动播放被拦 | M0 双路验证；父页面 WebAudio 兜底 + UI 提示 |
| **S1** | 宿主内部 API 漂移（inputTriggers/fetch.register） | 薄适配层 + 能力自检 + 降级；每次宿主升级跑 smoke |
| **S1** | 时间线/音频/素材同时进入导致 client.js/bridge.js 失控（6313/1813 行已很大） | 先拆纯函数/协议模块（stage-dev RUNTIME_PATHS 同步）；里程碑小步交付 |
| **S2** | AI 误操作剪辑 | 稳定 ID + expectedRevision + 原子批量 + dryRun + 回执/undo；UI 锁 |
| **S2** | 生成音频条款/合规/密钥 | 官方 API + 用户自备 key + 条款提示；v1 不做声音克隆；AIGC 标识预留 |
| **S2** | 30fps CFR 限制（非 30fps/VFR） | 导入时转代理并明确提示；v1.1 再扩 |
| **S2** | 48 KiB 场景上限/64 KiB Tool 结果上限 | inspect 分页；scene 分文件；生成 composition 不受用户上限 |

### 9.2 已拍板与剩余待定

**已拍板（2026-10-21）**：版本 `1.0.0`；统一时间线；音频供应商可插拔 + 千问云试点 + 本地 `say` 保底；数据根 `~/Movies/DSH Video/`；@ 引用使用宿主内部 API（spike + 降级）。

**剩余待定（不阻塞 M0 启动，随里程碑确认）**：

1. **素材格式/上限细化**：默认 `mp4/mov + mp3/wav/m4a + png/jpg`、单文件 2 GiB/单工程 8 GiB、30fps CFR；是否需要 4K/HEVC/60fps 原生支持（会显著增加渲染/代理成本；建议 v1.1 再扩）。
2. **导出产物管理**：是否把导出 MP4 保存进工程 `exports/` 并在界面提供"下载/在 Finder 中显示"（建议做，成本低、与文件夹按钮一致）。
3. **音频生成范围**：v1.0 是否只做旁白+音乐+音效（建议是；声音克隆/多语言配音/自动字幕延后）。
4. **文档入库时机**：本批调研+方案+规划是现在提 PR 到 main，还是等 M0 结束后与 M0 报告一起提。
5. **并行度**：M1（存储）与 M2（素材）在写作用域互斥前提下可否双会话并行（Lead 评估后建议：M0 单线；M1 单线；M2 起可并行 M3 的协议层）。

---

## 10. 参考与证据索引

- 五份调研：见文首表格（本 worktree `docs/research/2026-10-21-*`）。
- 仓库事实：`host/bridge.js`、`host/config.js`、`host/session-state.js`、`host/snapshot.js`、`host/asset-inbox.js`、`packages/video-engine-worker/src/{composition,projects,scenes,jobs,previews,history}.mjs`、`scripts/stage-dev.mjs`、`client.js`、`package.json`。
- 宿主 asar 证据（T3 报告 §五）：`dsh-client-ui-input-trigger`、`dsh-client-ui-reference`、`dsh-client-ui-conversation`、`dsh-native-command`、`dsh-host-open-in-app`、`dsh-attachment`、`dsh-storage*`、`dsh-host-webserver`。
- HyperFrames 0.8.167（已装 staging engine-worker/node_modules）：`dist/chunk-4U5FN6FY.js`（`extractAudioSegment` L15042 / `generateSilence` L15088 / `mixAudioTracks` L15130 / render audio mix L15744）、`dist/chunk-HAQ4PMF6.js`（sub-composition/track 解析）、`dist/help-7MQDFXVN.js:99`（`tts`/`models`）。
- 外部：BaoCut（github.com/JimLiu/baocut）、OpenTimelineIO、OpenCut、Remotion OffthreadVideo、Editly、MLT、ffmpeg filters、各 provider 官方文档（见 T1/T2 报告链接）。

---

## 附：为什么不是"直接加时间线 UI"

- 时间线 UI 没有真相模型就是一次性 demo：split/trim 的结果必须可持久、可撤销、可被 AI 按 ID 引用、跨重启一致；否则用户第二次打开就丢或错位。
- 存储不先重构，新功能会把用户数据继续写进按版本新建的 staging 目录，升级即"消失"——这正是需求 5 要防的事故。
- 音频不先解决资产与渲染链路，就会出现"预览有声、导出无声"的假完成。
- 因此顺序是 **M0 验证 → M1 数据根 → M2 素材 → M3 时间线 → M4 音频 → M5 @/协作 → M6 发布**，每一步都可单独真机验收，不做"最后一次性集成"。
