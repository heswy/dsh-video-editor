# BaoCut 与 AI 剪辑产品形态调研

日期：2026-10-21。基线：`origin/main` @ `9b0928e`（只读，未改代码、未装依赖）。范围：为 0.3.0-alpha.10 之后的大版本预研提供外部证据与可落地模式，不涉及实现。

证据分级：**A** = 一手文档/源码仓库/官网；**B** = 官方帮助中心或发布说明；**C** = 第三方报道、教程、社区帖；**D** = 行业通识，本次未验证。文中每条结论标级别；「产品宣传」与「实际可用」分列。

## TL;DR（≤15 行）

1. **BaoCut 是真实产品**：`JimLiu/baocut`，v3.9.0（build 79，2026-10-20 前后），Electron 桌面端 + Rust 视频引擎 + WASM 预览，定位「**AI video agent with an editable timeline**」——不是一次性成片，每次结果都落在可继续编辑的时间线上。[A]
2. 它和我们的架构**高度同构**：受控 HTML composition + 代码包、Scene/章节抽象、独立 Runtime/Engine 进程、AI 通过工具改工程。它明确支持 `baocut/1` 与 `hyperframes/1` 契约——我们用的 HyperFrames 路线被同类产品验证。[A]
3. 最值得抄的不是功能，而是**协作机制**：界面手势、Agent 工具调用、流程结果全部走**同一条命令网关 → 事务 → 回执 → 撤销栈**，没有旁路。[A]
4. **回执（receipt）**是它让 AI 操作「可见、可回滚」的核心：返回 created/updated/deleted ID、lineage（split 前后对应）、时长变化、失效依赖、undo 可用性。[A]
5. **引用问题它用「自动上下文 + 落点」解决**：每条用户消息尾部自动带编辑器状态（打开的视频、revision、选中片段、播放头、语言）；批注带「时刻 + 区域 + 段/句锚点 + 元素 + 截图」。[A]
6. 它专门为「不想碰时间线的人」做了**审片视图（Review）**：画面 + 按段分格的播放条 + 侧栏脚本/逐句 + 画面标记直接发给会话；顶栏一键切回时间线，两边共用同一份文档与撤销栈。[A]
7. **持久化**：`video.db` 权威 + `.bcut-snapshot/` 确定性文本快照 + 最近 10 个 unified diff；回滚靠反向应用 diff 并校验摘要，作为一笔可撤销事务；git 可选且只提交自己的路径。[A]
8. **素材**：内容寻址的资产版本（linked/collected）、缺失原因（missing/changed/outside-project）、relink；跨工程 Space 检索有 speech/visual 通道且可按视频排除索引。[A]
9. **音频**按角色分轨（配音/旁白/配乐/音效），配乐压在人声下、片尾淡出、不足循环铺满；旁白与配乐分轨、按句重配。[A]
10. 「opus5.5」经查是 **Claude Opus 5.5 模型**，2026-09/10 出圈的是「模型写代码直接生成音乐/MV」，**不是音频 API**。所以「生成音频」要拆成两条路：资产型（TTS/音乐/音效）与代码合成型（Web Audio 写进 composition）。[C]
11. 行业过渡规律：**没有一家从对话-first 直接长成 NLE**。CapCut/剪映是 timeline-first 加 AI 按钮；Descript 是文本即编辑；OpusClip/Submagic 是 AI-first 不做时间线；BaoCut 是唯一同时做「Agent 对话 + 可编辑时间线」且公开设计文档的样本，且它用**双视图**过渡。[A/B/C]
12. 对 DSH 的硬约束结论：**不要试图改宿主 Composer 做 @ 菜单**；把「引用」做成插件内可点选的引用状态 + 只读 Host Tool 让 AI 主动读取 + 可粘贴的稳定引用文本（`@场景:s3`）作为降级。[推断，需宿主能力实测]
13. 五项需求里风险最高的是 **#2 时间线**（面板宽度与克制风格冲突、且会成为第二写入端）与 **#1 音频导出链**（现管线是否带音频未验证）。建议都按「单一写者 + 模型先行 + UI 后置」推进。
14. 不要照搬 BaoCut 的 6 种 ID、1380 行协议、WASM 预览与本地模型栈——那是桌面 NLE 的体量。只抽 3 个概念：**稳定 ID、revision 冲突、回执+撤销**。
15. 反模式清单见 §4，其中「UI 直改工程文件」与「把时间线写进 composition 当真源」是会把下一版拖死的两个。

## 1. BaoCut 调查结论

### 1.1 定位与身份（排除「口误/功能名」假设）

- 官网 [baocut.com](https://baocut.com/) 与仓库 [github.com/JimLiu/baocut](https://github.com/JimLiu/baocut) 均为同一产品；官网下载页给出 macOS（签名+公证）与 Windows x64（CPU/CUDA/Vulkan）安装包，最新已验证版本 **v3.9.0 build 79**；仓库 package 提交为「prepare BaoCut 3.9.0 build 78」（2026-10-19）。[A]
- 许可证 **BaoCut Community License 1.0（source-available）**：个人/研究/公司内部免费，可自由用其产出（含商业内容），但销售软件本体、改名分发、做成托管服务或嵌进商业软件需另行授权。**不是 OSI 开源**，引用其代码需注意。[A]
- 定位原话：「**An AI video agent built around an editable video, not a one-shot MP4.**」「The video is the source of truth. Files (SRT, MP4, audio, transcripts) are exports of it, never the other way around.」[A]
- 活跃度：仓库自 2026-10-08 导入源码快照，10-20/21 仍有大量提交；文档自称 under active development，Windows 包未签名、GPU 推理未在硬件上全测。[A]
- 中文侧证据：cocoloop 论坛 2026-10-14 有用户分享「BaoCut 的 Skill（暂时只支持 Mac），转录+识别说话人+顺手剪口癖，进度实时同步到图形界面」——说明有真实中文用户在用 CLI/Skill 形态。[C]
- 音近中文名（宝剪/豹剪/爆剪/包剪）本次未获可信对应；不影响结论：英文名已有一手命中，**排除「用户口误」与「某功能名」假设**。

### 1.2 产品形态（四个入口、一个 Runtime）

| 入口 | 形态 | 说明 |
|---|---|---|
| Desktop（Electron） | Home（与 Agent 对话）/ Space（跨工程产物）/ 编辑器（预览+时间线+撤销+字幕） | 主形态；Electron 44，UI 为 React Spectrum 2 + Zustand [A] |
| CLI `baocut` | 薄客户端，JSON 输出、退出码表达是否需人处理（2 = 需要用户操作） | 供脚本与外部 Agent [A] |
| MCP + Skill | 把同一工具目录交给 Claude Code / Codex / Cursor / Gemini CLI 等 | 已验证 Codex CLI 与 Claude Code 端到端 [A] |
| Web 客户端 | 一次性审片链接打开某视频编辑器 | 远端 Agent 给用户看片、标记 [A] |

关键：**Agent 不是内置的**。它要求用户已登录一个 Agent 引擎（Codex CLI / Claude Code 等），BaoCut 只提供 Runtime + 工具目录 + 编辑器。这与我们「DSH 原生对话就是 Agent」恰好互补：我们不需要 skill/MCP 桥，但需要自己实现「编辑器上下文如何进入会话」。

### 1.3 技术架构线索（A）

- 进程分层：Electron 主进程/渲染 UI ↔ Runtime（WebSocket 网关、会话、任务、Agent Driver）↔ Engine Host（stdio）↔ 原生 workers（render/export/speech/model）。预览走 **WASM**，导出走原生 `export-worker`。
- Rust crates 命名直接暴露数据模型：`editor-semantics`（有理数时间、帧量化）、`timeline`（时间线与元素模型）、`video-model`、`video-engine`（事务、回执、撤销）、`render-graph`（帧计划，原生导出与 WASM 预览共用）。
- **代码合成**：Agent 写自包含 HTML 画面 → 打包成 code bundle → 烘焙帧 → 放到时间线；支持 `baocut/1` 与 `hyperframes/1` 两种契约。文档另有一篇「章节化代码动画片」设计：章节表、按章重做、旁白/配乐按角色分轨、代码包在播放器里实时播、后台烘焙与导出。
- 数据：视频 = 目录（`video.db` SQLite + `blobs/`）；项目 = 文件夹（默认 `~/BaoCut`，`BAOCUT_PROJECTS_DIR`）；便携包 `.baocut` 导出文档版本+素材版本（不含完整事务历史）。

### 1.4 五个直接可借鉴的机制

#### (1) 单一命令网关：人和 AI 改同一份文档，走同一套事务

- 原文：客户端（UI/CLI/Agent 工具）→ `@baocut/client` Command → Runtime（认证、授权、幂等、构造事务）→ VideoEngine（校验、量化、原子提交）→ 回执+事件。「界面手势、智能体的工具调用和自动应用的任务结果使用同一组 EditOperation，经过同样的校验。**没有只给某一类调用方使用的旁路。**」[A]
- 严格乐观并发：修改命令必须带 `videoId` + `expectedRevision`；不匹配返回 `PROJECT_REVISION_CONFLICT`，调用方必须**重新读取、重新形成操作、用新 commandId 提交**；不自动重放。[A]
- 幂等：同一 `commandId` + 相同 payload 返回同一回执；payload 不同则拒绝。[A]
- 长任务不持有视频：模型计算在事务之外，结果作为产物发布，再用独立幂等事务应用，应用时重新校验输入版本。[A]
- **对我们的意义**：这正是「手动剪辑与 AI 指令协作」的答案——不是靠 UI 锁或提示，而是靠**单写者 + revision + 冲突重读**。我们的 worker 已经是唯一写者，下一版要让 UI 手势也走 Host Tool 同一套 mutation API，而不是让渲染进程直接写 `project.json`。

#### (2) 回执（Receipt）：AI 操作可见、可解释、可回滚

回执必显字段（节选）[A]：

| 字段 | 用途 |
|---|---|
| `createdIds` / `updatedIds` / `deletedIds` | 到底动了什么对象 |
| `lineage: Record<Id, Id[]>` | **split/trim 后旧实例 → 新实例的对应**（AI 后续能继续操作这几段） |
| `impact.oldDurationFrames` / `newDurationFrames` | 时长变化，用户能核对 |
| `impact.translationUnitsStale` / `dubbingUnitsStale` / `orphanedAnchors` | 失效的字幕/配音/锚点，必须如实报告 |
| `impact.removedTransitions` / `shortenedTransitions` / `removedByCuts` | 被连带删/缩短的对象与原因 |
| `timeResolution[]` | 请求时间 vs 实际落点 vs delta（帧量化回执） |
| `undo.available`（+ 不可用原因） | 哪一步能撤、哪一步撤不了 |
| `preserved` | 明确没变的对象 |

规则：「回执是『这次修改确实发生了』的唯一依据；界面与智能体都不得在收到回执之前宣称修改已完成。」[A]
- **对我们的意义**：我们 alpha.10 已经有 revision/快照，但没有「变更回执」这一层。下一版 AI 改完后应给用户一张**变更卡**（改了什么、影响几分钟、几段、哪条音轨），并让撤销只撤这一笔。

#### (3) 引用：自动上下文 + 可落点标注，而不是让用户打字 @

- **隐式上下文**：用户消息末尾自动附 `<baocut-editor-context>`：打开的视频、版本、**选中的片段**、播放头、界面语言；skill 明确「这不是用户写的话」。[A]
- **显式标注**：`<baocut-video-annotations video=… revision=…>`，一帧一条，含时刻（含毫秒）、九种标记（box/arrow/text/pin/pen/line/ellipse/element/comment）、归一化区域、样式、**element（字幕行/HTML 节点/合成层元素）**、**segment/line 落点**（第几场第几句）、截图附件、`candidateBoundsMs`（候选范围，明确不是要改的区间）。[A]
- **选区快照**：发送给 Agent 的选区包含 `videoRevision`、`sequenceId`、实例 ID、词锚、可见帧范围，「不是一句『当前那一段』」；并且发送前先结算本地未落盘编辑（`CONTEXT_PENDING_EDITS`），冻结上下文。[A]
- **时间输入**：`seconds` 与 `frames` 互斥；词/句/occurrence 锚点是口播与语义编辑的**优先输入**（不让调用方先换算成秒）；「晚两秒」发**相对偏移**，不发送算好的帧号；引擎在事务内量化一次并回执 requested/actual/delta；不在帧网格上返回 `TIME_NOT_ON_FRAME_GRID`，量化后长度为零返回 `TIME_RANGE_COLLAPSED`，不自动补帧/扩大删除。[A]
- 尚未定义：相对偏移的字段形式是文档 §13 明列的待评审项。[A]
- **对我们的意义**：引用体系 = 「选中态自动带 + 落点稳定（ID/段/句）+ 时间只作为辅助」。我们的 Scene 有稳定 ID，天然适合做落点；需要补的是「选中态（scene/clip/asset/timeRange）如何在 Host Tool 里被 AI 读到」。

#### (4) 双视图与「段」抽象：从对话-first 过渡到可剪辑的现成答案

- 轻量/审片视图：画面居中，**底部按段分格的进度条**，右侧当前段脚本与逐句台词，画面可直接画标记发给会话；不做分轨与裁剪；面向「看一遍、指出哪里要改」的人。[A]
- **段（segment）抽象**：统一 `scene`（场景）/ `chapter`（章节）/ `speech`（旁白分段）/ `whole`（整条）四种来源，字段 `id/kind/index/title/start/end/status/script/lines[]/assets[]`；段是从视频**派生的，不单独存**，视频改了就重算，选中按 ID 找回。[A]
- 顶栏「审片 ｜ 时间线」一键切换，**共用同一份文档、同一撤销栈、同一个会话**；播放头、选字/选元素、标注草稿跨视图保留；视口与选择存为界面偏好，不进业务撤销栈。[A]
- 默认打开规则：路由 `?view=` > 该视频上次的视图 > 全局默认 > 按视频种类（会话里打开且有章节 → 审片；其余 → 时间线）。[A]
- 拖段边界的语义分两类：场景拖的是本场时长（后面整体推开、总长变化）；章节拖的是与下一章边界（总长不变）；旁白分段/整条没有把手。松手才生效、toast 带撤销、也进撤销栈。[A]
- **对我们的意义**：这是「已有对话优先，下一版加轨道，行业怎么过渡」的直接模板——**先给一个按 Scene 分格的审片条（认知成本低），再给时间线视图（能力完整），共享同一模型与撤销**。我们已经有 Scene 与 composition，做「片条」比做完整轨道便宜得多。

#### (5) 持久化：确定性快照 + 版本 diff + 冲突可见

- 三层历史：撤销历史（每笔事务）／版本记录（一段工作）／git（可选）。[A]
- `video.db` 仍是唯一权威；`.bcut-snapshot/video.json` 是**行稳定的确定性投影**（键按字典序、LF、三层以下压行、同一状态逐字节相同），`documents/<id>.json` 一文档一文件，`history/000001.patch…` 是标准 unified diff，头部含 `Kind/Summary/Action/Conversation/File sha256`。[A]
- 写入时机：最后一笔编辑后 **10 秒去抖**；关视频时、保存版本/回滚/代为提交 git 前立即写；打开期间快照最多落后 10 秒；不属于项目的视频不写快照、不记版本（`VERSIONS_NEED_PROJECT`）。[A]
- 版本边界：安静满 5 分钟、单版满 30 分钟、终结版本（save/restore/external）、按回合切分（可选）→ 否则并入当前版本重写 diff。保留最近 **10** 个未命名版本 + 全部具名版本；history 超 64 MiB 从最旧未命名删起。[A]
- 回滚：从最新快照逐版反向应用 diff，每步精确匹配 + 按 File 行校验摘要；任何一步对不上就停，报告断点，不导入半成品；回滚本身作为**一笔可撤销事务**提交并产生新版本（「回滚是向前的」）。[A]
- 外部改动（`git pull`、同步盘、手改）：只有快照变 → 导入为一笔 `external` 事务（可撤销）；两边都改 → **不自动合并**，让用户在「保留 BaoCut 里的 / 用磁盘上的」中选；快照读不出时只允许保留库里的。[A]
- git 桥：只提交自己的路径（`--only`），写 `.git/info/exclude` 与 attributes（`eol=lf merge=binary linguist-generated`），不跑钩子/本地过滤器（除非用户显式允许），不 push/fetch/merge/rebase。[A]
- **对我们的意义**：#5（工程不消失 + 文件夹按钮）几乎可以按这个缩小版实现：**权威工程 JSON + 确定性快照 + 最近 N 版 diff + 原子写 + 打开时自检 + 明确的「已保存/保存中/冲突」状态**。注意：确定性序列化是 diff 可读的前提，`JSON.stringify` 键序不稳会让 diff 全是噪声。

#### (6) 素材、音频与其他

- 素材：资产带版本（`assetId + revision`），记录内容摘要、大小、时长、尺寸；**linked（链接原文件）与 collected（收进视频）**两种；缺失原因分 `missing/changed/outside-project`；`assetStatus` 在打开视频、收到 `video.replaced`、提交素材类操作后各查一次，界面标出缺失；可 `relinkAsset`。[A]
- 素材来源：导入、链接下载、生成图片、代码包、贴纸/品牌套件；「导入为**候选素材**」（AI 生成的封面/配图先当候选，不直接上轨）。[A]
- 跨工程检索 Space：`space_search_v2` 有 `speech` 与 `visual` 两个索引通道；`videos_match_frames` 按文字找画面；语义索引可被用户按视频**排除**（`excluded`），且「不替用户改语义索引的设置」。[A]
- 音频：翻译配音 → 分离人声/背景（HTDemucs）→ 逐句合成 → 新音轨；配乐「放上单独的配乐轨，压在人声之下、片尾淡出，比单次上限长就循环铺满」；`role: music` 的音频轨在审片视图有独立静音开关；旁白与配乐按角色分轨、只重配不合格的句子。[A]
- 时间语义：`editor-semantics` 用精确有理数 + 帧量化；「10 秒」在 30000/1001 帧率下落在第 300 帧 = 10.010s，回执写明 delta。[A]

### 1.5 与我们（dsh-video）的同与不同

| 维度 | BaoCut | DSH Video（alpha.10） | 结论 |
|---|---|---|---|
| 权威对象 | 可编辑视频（目录+DB） | `project.json` + composition/Scene | 同构；我们要补「快照+版本」 |
| 渲染 | Rust 引擎 + WASM 预览，代码包支持 `hyperframes/1` | HyperFrames 渲染 + 独立 Node worker | **路线被验证**；不必换后端 |
| AI 来源 | 外部 Agent 引擎（Codex/Claude）+ skill/MCP | DSH 原生对话（Host Tool） | 我们更省，但**没有「往用户消息里塞上下文」的 Runtime 层** |
| UI 结构 | Home/Space/编辑器（时间线+审片） | 左预览 + 右原生对话（单面板） | 我们不能扩成多表面；要在一个面板内做双视图 |
| 编辑入口 | UI/CLI/Agent 三入口同网关 | Agent 工具为主；UI 仍只读 | 下一版的核心工程任务 |
| 持久化 | DB+快照+版本+便携包 | 工程目录 + revision（已有） | 取快照/版本/冲突三层，不取 SQLite |
| 音频 | 本地+在线模型、分轨、混音、导出分轨 | 无 | 需补最小编排与导出链 |
| 体量 | 1380 行协议、6 种 ID、四种入口 | 插件形态，克制 | **只抽原则，不搬机器** |

### 1.6 BaoCut 自身局限与「产品宣传 vs 实际可用」

- 需要用户已登录 Agent 引擎；媒体分析/转写/导出还依赖 `ffmpeg`/`ffprobe`（不捆绑）。开箱不是「装完就能剪」。[A]
- 文档明说**未实现/未验证**的：`prepareBatch` 预检尚未实现（只有较弱的 `dryRun`）；自动重基为 P1；相对时间输入未定义；Windows 包未签名、GPU 推理未做硬件测试；macOS 需完整 Xcode/Metal 才能源码开发。[A]
- 第三方真实使用证据仍然少（官网场景、论坛一贴、augmentclaude 的 Skill 索引页）。它的设计文档质量远高于其市场验证程度。[C]
- 结论：**把它当「设计参考 + 机制样本」，不是当「竞品数据」**。

## 2. 同类产品对比

| 产品 | 形态 | AI 交互 | 片段/素材引用方式 | 素材库 | 持久化 | 可借鉴 / 不适用 |
|---|---|---|---|---|---|---|
| **BaoCut** [A] | 桌面 NLE + Agent | 对话/CLI/MCP 驱动，事务+回执 | 自动编辑器上下文；标注落点（时刻+区域+段/句+元素+截图）；稳定 ID+revision | 项目文件夹 + Space 跨工程检索（语义可排除） | 本地 DB+确定性快照+10 版 diff+可选 git | **全部机制**；不搬协议体量 |
| **CapCut / 剪映** [B/C] | timeline-first 全端 | 功能按钮化 AI：智能字幕、自动踩点、**Auto Cut**（按节奏自动切）、智能镜头分割、图文成片/剪同款 | 靠「选中片段 + 素材面板点击」；AI 不理解自然语言对象引用 | 本地「媒体库」+ 模板库；草稿在 `com.lveditor.draft`（`draft_info.json`/`draft_content.json`） | 本地草稿目录，云同步另收费；草稿是私有 JSON 格式 | 借鉴：**按节奏/静音自动切**、素材面板、草稿即文件夹；不适用：功能堆叠的证据、私有草稿格式（不可被 AI 稳定读写） |
| **Descript** [B] | 文本即编辑 | **Underlord**（agent 协作改片）；删字=删画面、移句=移画面 | 引用对象是**文稿里的字/句**；场景/图层 | 项目内媒体 + 云端 | 云端 SaaS | 借鉴：**transcript 作为引用层**（对长视频最自然）；不适用：云持久化与我们的本地工程定位冲突 |
| **OpusClip** [B] | AI-first，无时间线 | 长转短；提交后可用 **AI Co-pilot 写具体指令** | 无片段引用——用户只给视频与指令 | 云端上传 | 云端 | 借鉴：**评分/挑段/按指令出多个候选**；不适用：没有可编辑时间线，改一次要重跑 |
| **Adobe Premiere** [B] | 专业 NLE | **Text-Based Editing**：自动转写、按 transcript 剪、填词/口癖管理、时间码对齐 | transcript 选句 + 时间线选区 + 序列/轨道 | 本地媒体库/项目 bin | 项目文件 + 自动保存 + 团队库 | 借鉴：transcript 与时间码双向定位、按句删除；不适用：专业快捷键与面板密度 |
| **OpenCut** [A/C] | 开源 CapCut 替代（web/desktop/mobile） | 正在重写：Rust core、**计划 MCP server（给 AI agents）**、插件优先、headless 渲染、脚本标签页 | 多轨时间轴 + 片段/轨道/trim/转场数据结构 | 本地浏览器存储/项目 | 本地优先（「Your videos stay on your device」）；经典版归档 | 借鉴：**MCP/headless/插件化的方向**与我们 Host Tool 一致；不适用：社区版仍在重写、无 AI 交互证据 |
| **Runway / 即梦 / 可灵** [C/D] | 生成式视频 | 文/图生视频、首尾帧、参考图；编辑多为「重生成」而非「改时间线」 | 引用靠 prompt 描述 + 参考图 | 生成历史/素材库 | 云端 | 借鉴：生成素材进工程当候选；不适用：不能替代剪辑与精修 |
| **开拍 / 度加 / 腾讯智影** [D 未验证] | 国内「口播/图文成片」工具 | 文稿→数字人/配音→自动成片；模板化 | 稿子与模板，不面向片段 | 模板+素材库 | 云端 | 借鉴：**稿-声-画三段式**（我们 #1 的旁白先行）；不适用：一次性成片，不保留可编辑结构 |
| **必剪 / 快影** [D 未验证] | 移动端剪辑 | 智能字幕、变声、一键成片、模板 | 选中片段/素材 | 本地素材库 | 本地草稿 | 借鉴：移动端「低认知字幕/配音」交互；不适用：面板与手势 |
| **Veed / Klap / Submagic / Gling / Pictory / InVideo** [C] | 字幕/脚本驱动的 web 工具 | 上传→自动转写→自动剪、加字幕、B-roll、翻译；Pictory/InVideo 是「脚本→成片」 | 主要按 transcript/关键词，少量按片段 | 云端媒体库 | 云端 | 借鉴：**字幕/静音/关键词驱动的批量剪辑**；不适用：AI-first 单向流水线，改一处要重跑 |

### 2.1 模式归纳（回答「AI-first vs timeline-first」）

1. **三种稳定形态**：① AI-first 无时间线（OpusClip、Submagic、Pictory）——快、不可精修；② timeline-first 加 AI 按钮（CapCut、Premiere）——可精修、AI 是工具不是合作者；③ **Agent + 可编辑对象**（BaoCut、部分 Descript/Underlord）——对话产出**结构化结果**，再落到可继续编辑的文档。我们 alpha.10 已属③，下一版只是给③补上「结构化结果的 UI 表达」。
2. **过渡不是「加时间线」，是「加可点选的结构」**。BaoCut 先做「按段分格的审片条 + 标记发会话」，时间线视图后置且共用状态；CapCut 反向（先轨道再 AI）。对我们：**先 Scene 片条 + 选中即上下文，再轨道**，风险最小。
3. **AI 引用可靠性的排序**（认知成本从低到高）：自动上下文（选中/播放头）> 点选 > @ 菜单 > 编号（「第 2 段」）> transcript 选句 > 标签/描述。编号会随剪辑漂移，描述最容易歧义。**首选「点选 + 稳定 ID」，transcript 只对长口播值得做。**
4. **素材库的组织**：一律「按工程」，跨工程检索是**可选增强**且必须可关闭（BaoCut 的 `excluded`）。内容寻址 + 缩略图 + 类型过滤是标配；「AI 自动参考全部素材」是反模式（隐私、成本、误解）。
5. **持久化没有中间态**：要么像 CapCut 用私有草稿格式（AI 难稳定读写）、要么像 BaoCut 用「权威库 + 确定性文本快照」。我们应选后者，且**工程目录就是用户能打开的文件夹**——正对应 #5 的「文件夹按钮」。
6. **音频**：所有能出片的工具都把音频当**轨**（旁白/BGM/SFX 分离，可分别调音量、可 ducking），没有一家把音频塞进视频片段里当属性。最小可用 = 两条音轨 + 音量 + 淡入淡出 + 一条旁白/配乐生成入口。

## 3. 映射到 5 项需求的具体建议

> 约束复述：DSH 原生对话在右侧，插件不能改宿主 DOM/协议；界面克制、精致、作品贡献颜色；工程 = 受控 HTML composition + 多 Scene + 稳定 ID；独立 Node worker 是唯一引擎。

### 3.1 需求①：生成音频，让作品完整有声

**先澄清「opus5.5」**：公开资料显示 Claude Opus 5.5（2026-07 发布）在 9–10 月被大量用来**用代码直接生成音乐/动画/MV**（智源社区、量子位、Simon Willison 博客均有记录），而不是一个音频 API。[C] 因此「生成音频能力」应实现为两条互补路径：

| 路径 | 产物 | 优点 | 代价 | 建议 |
|---|---|---|---|---|
| A. 资产型 | TTS 旁白、音乐、音效文件（wav/mp3）→ 素材 → 音轨 | 可控、可替换、导出简单 | 需 provider/模型；有成本与延迟 | **v1 主路径** |
| B. 代码合成型 | composition 内 Web Audio/JS 合成 | 零 provider、确定性、与 HyperFrames 天然契合 | 导出需离线渲染音频；复杂音乐难写 | **v1.5 增强**（BGM/音效/氛围） |

**UX**：对话里「给这段配旁白/配乐」→ 生成候选（可试听、可换一版）→ 落轨；时间线底部两条音轨（旁白/BGM），每条音量+淡入淡出+静音；预览播放带声；导出对话框显示「含音频」。
**架构**：`audio` 是一等资源（`audioAsset` 或 synthesis spec + 参数），落在轨道 item 上；生成走 job（不在事务内），完成后按 BaoCut 的方式作为**产物发布 → 独立幂等事务应用**；即使生成失败也不污染工程。
**必须提前验证的点（未验证）**：现有 HyperFrames/worker 导出链是否带音频？ffmpeg 混音是否已在管线内？Chrome 侧能否离线渲染 Web Audio 为 PCM？如果只能出静音 MP4，#1 就是空头承诺。
**不做**：完整混音台、逐句 EQ、多语言配音矩阵、把音频写进 composition 当唯一真源。

### 3.2 需求②：视频轨 + 音频轨 + 基本剪辑（split/trim/排序/精调 + 对话操作片段）

**结论**：照 BaoCut 的「双视图 + 段抽象 + 单网关」做缩小版，不做 CapCut 克隆。

- **模型先行**：工程里新增 `timeline: { tracks: [{id, kind: video|audio, role?, items: [...] }] }`，item 有稳定 `id`、`kind`（scene | footage | audio）、`start/duration`（毫秒 + 帧率）、`in/out`、`assetRef`、`label`。Scene 仍由 composition 渲染，作为 video 轨上的一个 item；footage 是素材片段。`project.json` 是唯一真源，composition 由模型**生成**，不要反过来解析 composition。
- **split 语义**：footage/audio 的 split = 两个 item + `lineage: oldId → [newId1, newId2]`；scene 的 split 在 v1 **不支持**（场景是整块 HTML，切了就没有语义），只支持场景排序/时长调整。这条必须在产品上明说，避免「为什么场景不能切」的困惑。
- **UI（克制版）**：底部抽屉，默认收起；展开后上方一条 Scene 片条（按段分格，可点选、可拖排序），下方两条音轨/一条视频轨的简化轨道条（片段块 + 首尾把手 + 时间标尺）；选中即高亮，右侧对话不动。顶层有「片条 ｜ 轨道」切换（对应 BaoCut 审片/时间线），共用同一模型与撤销。
- **手动操作的落盘路径**：手势 pointerdown/move 只改临时覆盖层，pointerup 生成**一笔 mutation**（split/trim/move/reorder），带 `expectedRevision`，失败则回滚这一笔并 toast，不恢复整份旧工程。→ 这正是 BaoCut §9.1；我们补上「UI 也能写」但只经 worker。
- **AI 操作片段**：AI 必须先读（`get_timeline` 返回 item ID + revision + 时长），再用 `edit_timeline` 提交 operations；回执里带 lineage，AI 下一轮才能引用「切出来的第二段」。**禁止 AI 用「第 2 段」这种位置描述直接写**。
- **撤销**：单一 undo 栈（UI 与 AI 共用）；undo 是补偿事务，不覆盖后续改动（用户撤自己的 trim 不应抹掉 AI 刚加的旁白）。BaoCut 明确「没有安全补偿的操作不显示撤销按钮」——我们也应这样，而不是假装都能撤。
- **风险**：面板宽度 320–720px，轨道条会挤压预览与对话；建议轨道抽屉浮在预览下方、可折叠，绝不常驻。

### 3.3 需求③：素材库（导入、按工程建立前端页面、AI 可参考）

- **数据**：`<projectDir>/assets/<sha256>.<ext>` + `assets/index.json`（id/name/type/duration/dims/thumb/hash/origin: imported|generated|linked/createdAt）。**内容寻址去重**；导入默认**收进工程**（copy），链接模式（linked）只作为高级选项并记录原路径与 relink 信息——否则 #5「下次打开不消失」会被用户删原文件击穿。
- **UI**：左侧预览区可切换「预览 ｜ 素材」页签，或底部抽屉的「素材」标签；网格缩略图、类型过滤（视频/图片/音频）、按名称搜索、拖到轨道/场景；空态给「导入」按钮（走宿主文件选择/附件）。
- **AI 参考**：只暴露工程内素材的 manifest（id/name/type/时长/标签），AI 通过工具查询；生成的新素材自动注册为**候选素材**（先不入轨，等用户/AI 明确使用）。**不自动扫描用户磁盘，不跨工程自动索引**；将来若做语义检索，默认关闭、按工程白名单、写明「哪些素材会被读取」。
- **边界**：素材删除要检查引用（BaoCut `removeAssets` 在用即拒）；缩略图/波形缓存放 `cache/` 可重建，不进快照。

### 3.4 需求④：输入框 @ 引用某段视频/某个素材

**硬约束下的现实方案**（这是本次调研最需要与 lead 对齐的一条）：

- 我们**不能**像 BaoCut 那样在 Runtime 层往用户消息尾部塞 `<editor-context>`，也不能改宿主 Composer 的 DOM 去插入 @ 菜单。
- 因此采用**「点选→引用态→AI 主动读取」的拉取模型**：
  1. 用户在我们面板里点选 Scene/片段/素材/时间区间 → 进入「引用态」，预览高亮 + 面板显示 chip（如 `场景 3 · 00:12.4–00:18.0`）；
  2. 新增只读 Host Tool（如 `get_editor_context`），返回 `{ projectRevision, selection: {kind, id, label, rangeMs}, playheadMs, visibleKind }`；
  3. 插件侧提供给模型的说明（系统提示/工具描述）里写清：**用户说「这段/它/第 2 段/这个素材」时，先调用 `get_editor_context`，不要猜**；
  4. 降级通道：chip 可「复制引用」，生成稳定文本 `@scene:s3 @asset:a_7f3a (00:12.4–00:18.0)` 供用户粘贴；AI 侧按 `@kind:id` 解析，失败则回退读上下文。
- **为什么这样最优**：BaoCut 的经验是「选中态自动带」成本最低；我们无法自动 push，就用「显式选中 + 工具拉取」近似，用户仍只需点一下。@ 菜单只是糖，真正的可靠性来自**稳定 ID + revision**，而不是字符串匹配。
- **待验证（未验证/需实测）**：DSH 对话是否有 Composer 扩展点或 mention/attachment 注入能力；插件能否注册系统提示/技能片段；Host Tool 的调用时机是否早于 AI 作答。若宿主支持 composer slot，再升级为真正的 @ 菜单；否则不要伪造。
- **反模式**：解析用户文本里的「第 2 段」去猜对象；用 label 模糊匹配；在会话里放不可见 DOM 注入。

### 3.5 需求⑤：复核存储机制 + 每个工程的「文件夹」按钮

- **布局**（建议）：`<DSH userData>/video-projects/<projectId>/`
  - `project.json`（权威，schemaVersion + revision + title）
  - `scenes/<sceneId>/…` 或 composition 源文件
  - `assets/` + `cache/`（缩略图/波形，可重建）
  - `history/000001.patch…`（最近 N 版 unified diff，含摘要与操作清单）
  - `snapshots/latest.json`（确定性投影，打开时校验）
  - `exports/`
- **写入**：worker 单写者；tmp + rename 原子替换；去抖 1–3s 自动保存 + 关面板/退出前强制写；每次写产生或并入一个版本（参考 BaoCut：安静 5 分钟切版、单版 30 分钟、保存为具名版本）。
- **自检/恢复**：打开时校验 snapshot 与 project 的 revision/digest；不一致给出「本地有更新/磁盘被外部改」的选择，不静默覆盖；素材缺失标出并给 relink；损坏时用最近快照重建（保留 videoId/projectId 不变）。
- **UX**：标题旁状态点（已保存/保存中/保存失败），**回执前不显示「已保存」**；「历史」面板列版本（时间/摘要/改了哪几段），可预览 diff、回到某版（作为新事务）。
- **文件夹按钮**：优先走宿主 Electron 能力 `showItemInFolder(path)`；若插件运行在受限渲染进程/网页态，则降级为「显示路径 + 复制路径」。**必须实测**：插件 client 是否拿到 shell/fs 权限；路径是否在用户可访问目录；Windows/macOS 差异。
- **不做**：自建云同步、自建 git（项目在 git 仓库里时可让用户自己提交，参考 BaoCut 的「只提交自己路径」）、把会话消息写进工程（会话与工程分离，切历史不回滚工程——这条 alpha.10 已定）。

## 4. 反模式与风险

1. **双写**：UI 直接改 `project.json`，AI 又另写一份 → 必然丢更新。**唯一写者 + expectedRevision + 冲突重读**是底线。
2. **把时间线写进 composition 当真源**：HTML 一改就丢失结构、无法 diff/撤销/AI 引用。模型在 `project.json`，composition 是派生物。
3. **照搬完整 NLE**：CapCut 级交互需要大量控件、快捷键、缩放层级；我们的面板 320–720px、要求克制。做「片条 + 简化轨道」就够。
4. **改宿主 DOM/协议去伪造 @**：一次宿主升级就碎，且违反插件边界。
5. **一次性成片作为主路径**（Pictory/InVideo/图文成片模式）：与「可持续修改的工程」定位冲突；只可作模板/场景生成入口，产物必须可编辑。
6. **位置式引用**（「第 2 段」）当契约：剪辑一改就漂移；必须 ID + revision，位置只作展示。
7. **回执缺失**：AI 说「改好了」但用户看不出改了什么；必须给变更卡（对象/时长/影响），否则撤销与信任都无从谈起。
8. **撤销实现成「反向执行命令」**：删除的内容无法反推；用状态补偿/快照，且「不可安全撤销就不显示撤销」。
9. **非确定性序列化**：`JSON.stringify` 键序不稳 → diff 噪声、版本链校验失败。键排序 + LF + 固定投影。
10. **自动索引用户全部文件/自动上传素材**：隐私与成本双雷；工程内白名单 + 明示 + 可关闭。
11. **音频塞进片段属性**：BGM/旁白/音效必须分轨，否则永远做不了「旁白压配乐」和「重配一句」。
12. **导出链不带音频**：验收会假通过（预览有声、导出无声）；写进验收矩阵。
13. **版本号/ID 复用、split 后不记录 lineage**：AI 下一轮引用失效，协作断裂。
14. **过早做「AI 自动剪完整片」**：BaoCut 也是先有可编辑结果再有自主流程；我们是插件，先保证可改。

## 5. 参考链接

**BaoCut（一手为主）**
- 官网：[baocut.com](https://baocut.com/)
- 仓库与 README：[github.com/JimLiu/baocut](https://github.com/JimLiu/baocut)
- 文档索引：[docs/](https://github.com/JimLiu/baocut/tree/main/docs)
- Agent Skill（含工具目录、编辑器上下文、标注解读、交付规则）：[skills/baocut/SKILL.md](https://github.com/JimLiu/baocut/blob/main/skills/baocut/SKILL.md)
- 命令与协议规范（事务/回执/时间输入/预检/撤销/手工交互）：[command-protocol-spec.md](https://github.com/JimLiu/baocut/blob/main/docs/spec/command-protocol-spec.md)
- 轻量/审片编辑器设计：[lite-editor-design.md](https://github.com/JimLiu/baocut/blob/main/docs/design/lite-editor/lite-editor-design.md)
- 版本记录设计：[version-history-design.md](https://github.com/JimLiu/baocut/blob/main/docs/design/version-history/version-history-design.md)
- 中文用户分享（第三方，2026-10-14）：[cocoloop 帖子](https://www.cocoloop.cn/t/topic/21181/9)
- Skill 第三方索引页：[augmentclaude.com/s/baocut-jimliu](https://augmentclaude.com/s/baocut-jimliu)

**同类产品（官方/帮助中心优先）**
- Descript 文本即编辑与 Underlord：[descript.com](https://www.descript.com/)（[转写页](https://www.descript.com/transcription)）
- OpusClip 长转短与 AI Co-pilot：[help.opus.pro/docs/introduction](https://help.opus.pro/docs/introduction)
- Adobe Premiere Text-Based Editing：[helpx.adobe.com](https://helpx.adobe.com/my_ms/premiere/desktop/edit-projects/edit-video-using-text-based-editing/overview-of-text-based-editing.html)
- CapCut Auto Cut（官方帮助）：[capcut.com/help/auto-cut-in-capcut](https://www.capcut.com/ko-kr/help/auto-cut-in-capcut)
- 剪映草稿目录与 `draft_info.json`/`draft_content.json`（第三方工具文档）：[pypi.org/project/jianying-tool](https://pypi.org/project/jianying-tool/)、[jianying-export-guide.md](https://raw.githubusercontent.com/wjmboss/ArcReel/refs/heads/main/docs/jianying-export-guide.md)
- OpenCut 新版（重写计划：Rust core、MCP server、插件优先、headless）：[github.com/OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut)；经典版：[opencut-classic](https://github.com/OpenCut-app/opencut-classic)
- OpenCut 架构解读（第三方）：[dev.to 文章](https://dev.to/jamse_bao/why-opencut-is-pulling-1040-github-stars-today-5gni)

**Opus 5.5 与「代码生成音乐/视频」（C 级）**
- 智源社区：Opus 5.5 代码直出音乐 MV：[hub.baai.ac.cn/view/58331](https://hub.baai.ac.cn/view/58331)
- 量子位/c114：Opus 5.5 实测（动画、谱曲）：[c114.net.cn](https://www.c114.net.cn/ainews/127984.html)
- Simon Willison：Opus 5.5 发布记录：[simonwillison.net](https://simonwillison.net/search/?tag=claude)
- Scrimshaw Jukebox（Opus 5.5 写游戏音乐测试）：[news.e-ink.me](https://news.e-ink.me/zh/archive/2026-10-07/article/scrimshaw-jukebox)

**未验证/待实测项汇总**
- DSH 插件是否支持 Composer mention/上下文注入、能否注册系统提示片段（决定 #4 走「拉取」还是「真 @」）。
- 现有 worker/HyperFrames 导出链是否含音频、能否离线渲染 Web Audio（决定 #1 的实现路径）。
- 插件是否具备 `showItemInFolder`/文件选择等 Electron 能力（决定 #5 文件夹按钮形态）。
- 国内开拍/度加/腾讯智影/必剪/快影、Runway/即梦/可灵的具体交互细节：本次仅按产品公开定位归类，未逐条打开验证，标 D 级。
