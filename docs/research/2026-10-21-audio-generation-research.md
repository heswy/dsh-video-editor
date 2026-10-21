# 生成音频能力调研（DSH Video next-major 预研）

> 信息日期：**2026-10-21**（Asia/Shanghai）。基线：`origin/main` 9b0928e（2026-10-21，插件 0.3.0-alpha.10）。
> 可信度标注：✅ 官方页面/文档；◐ 媒体/聚合商/社区（二手）；△ 未验证/推断。价格按 1 USD≈7.2 CNY 粗算，仅作量级参考；所有单价以下单当天官方页面为准。
> 本文只做调研与建议，不含实现；仓库未改动。

## TL;DR（15 行内）

1. 「opus5.5」几乎可以断定指 **Anthropic Claude Opus 5.5**（2026-09 发布），它不是音频模型；爆火的是它**写代码直出音画同步 MV**，音乐来自 Web Audio 代码合成或外部 Suno/ElevenLabs，再由 ffmpeg 合成视频。置信度约 85%。
2. 次可能：用户把 **Suno v5.5**（2026-03-26）记成了 opus5.5，置信度约 10%；没有公开的「Opus 音频生成模型」。
3. 结论：我们缺的不是「模型原生音频」；缺的是**音频轨 + 生成/导入 + 预览有声 + 导出混音**的完整闭环。
4. 音乐/BGM：ElevenLabs Music v2（$0.15/min，5 分钟上限，商用清晰）、Google Lyria 3.5/3 Pro（$0.08/≤3min、$0.04/30s，Gemini API 官方）、MiniMax Music 3（≈$0.0018/s，中文友好）、Mureka V9.5（官方 API 商用授权）是 2026-10 最可落地的四家。
5. Suno 质量/热度最高（v6 于 2026-09-08 发布），但**截至 2026-05 无官方开发者 API**，只能走逆向聚合商，商用条款与稳定性都有风险，不适合作为产品唯一依赖。
6. Udio 2026 年转向授权「围墙花园」，产出不得离开平台（Billboard），**直接排除**。
7. TTS/旁白：ElevenLabs v4/v4 Turbo（$0.08/$0.04 per 1k chars，~100ms）、MiniMax Speech 2.6、豆包语音合成大模型（¥4.5/万字符）、Fish Audio S2.1 Pro（≈¥1.14/万字符）都可 API 直连；中文优先豆包/MiniMax/Fish。
8. 本地开源：ACE-Step 1.5（2B，MLX 8-bit 已有 Apple Silicon 移植）、CosyVoice3（150ms 流式）、whisper.cpp/MLX（字幕对齐）、demucs（去人声）可做离线保底，但质量/速度需实测。
9. **成本量级极低**：30s BGM 约 ¥0.3–0.6，30s 旁白约 ¥0.01–0.05，3s 音效约 ¥0.05–0.3；瓶颈是**延迟（10s–2min 异步）与可靠性**，不是钱。
10. 架构推荐 **v1.0 = E（用户上传保底）+ A（worker/Host 直连 1–2 家 REST，密钥用户自备）**，B（复用宿主能力）待宿主审计确认，C（Agent 调 shell/HTTP）只作开发期过渡，D（本地模型）留 v1.1 实验。
11. **【2026-10-21 修正】音频渲染约束是「插件自设」而非引擎能力**：受控 composition 校验器禁用 `<audio>/<video>`（`composition.mjs`；worker README 合成契约第 5 条）、`asset.import` 只收 PNG/JPEG；但已安装 **HyperFrames 0.8.167 原生支持 composition 内 `<audio>/<video>` 按时序混音**（`extractAudioSegment`/`mixAudioTracks`/`generateSilence` + `audioFailures` 诊断，volume 自动化与 `data-fade-in/out`）。→ 音频渲染两条路：**原生媒体元素 + HyperFrames 混音（v1.0 推荐）** 或 工程级音轨 + 渲染后 ffmpeg 混流（后备），对比与代价见 §4.6。
12. v1.0 最小范围：上传音频 + 生成 BGM/旁白 + 单 BGM 轨/旁白轨 + 音量/淡入淡出 + 预览同步 + 导出有声（loudnorm），**不做**自动 ducking/beat-sync/多轨编辑器（列为加分项）。
13. 最大风险：第三方 API 条款与商用授权、声音克隆合规与 AIGC 标识、密钥泄露、长任务失败/取消、离线用户与离线计费。
14. 生态先例：DSH 已存在第三方插件 `dsh-audiogen`（2026-08-30）与 `dsh-voco`，前者正是「本机 settings 存 key + loopback 代理 + agent tool + 素材库」，证明该接入形态可行，也说明「插件不内置凭据」可解释为**不随包分发 key**。
15. 待办：宿主能力审计（是否有 TTS/音频 MCP、OpenAI-compatible 凭据可复用）由另一 teammate 负责；本文第 4.3/6 节列出待确认项。

> **修正注记（2026-10-21，Lead 指出并复核）。** 本文初稿曾写「composition 禁 `<audio>/<video>` → HyperFrames 只渲染无声 h264 → 音频只能工程级音轨 + 后期混流」。复核已安装 `staging-alpha10-1cceb96/engine-worker/node_modules/hyperframes`（**0.8.167**）的 `dist`：`chunk-4U5FN6FY.js` 含 `extractAudioSegment`（mediaStart/duration/playbackRate 截取）、`mixAudioTracks`（ffmpeg `filter_complex` + `amix=inputs=N:duration=longest:normalize=0` + volume/automation + AAC `-b:a 192k`）、`generateSilence`（`anullsrc=r=48000:cl=stereo`）；render 会遍历 composition 的 `<audio>/<video>`，video 先抽音轨为 `${element.id}-extracted.wav` 再混；README 记录 piped render 的 `audioFailures`（≤16 条诊断）。运行时/player 还支持 `data-start`/`data-duration`/`data-media-start`/`data-playback-start`/`data-playback-rate`(0.1–10)/`data-volume`/`data-fade-in`/`data-fade-out` 与 media 同步。**因此原判断作废**：真实约束是插件自己的受控 composition 校验器与 asset 类型白名单，而非 HyperFrames。保留原文表述（§1.3 已改、§3.3/§4.1/§4.6/§5 已改），本注记用于追溯。

## 1. 「opus5.5」澄清

### 1.1 结论

不存在公开的「Opus 5.5 音频生成模型」。用户所指极可能是 **Claude Opus 5.5（Anthropic 的代码/Agent 模型，2026 年 9 月发布）** 以及它在 2026-09 引爆的「代码直出音乐 MV」现象：模型在 Claude Code 里写 Canvas/WebGL/Three.js 分镜与动画、用 **Web Audio API 或纯 JS 合成音乐**（或调用 Suno/ElevenLabs 生成音乐与人声）、分析 BPM/重拍做节拍图、本机 Node+FFmpeg 导出成片。也就是说：**用户看到的是「Agent + 代码 + 外部音频服务」组合出来的有声视频，不是某个音频模型**。

置信度与依据：

| 假设 | 置信度 | 依据 |
|---|---|---|
| Claude Opus 5.5（代码直出 MV） | **≈85%** | 量子位 2026-09-28《Opus 5.5 代码直出音乐 MV 火了》，马斯克多次转发；作者自述用 Suno 做音乐、ElevenLabs 生成人声，再配 Three.js 同步 MV；PTT 讨论指出很多作品「用 Web Audio API 或纯 JS 合成音乐，并让动画与音乐精准同步」；唐纳德式提示词公开、Claude Code + Node + FFmpeg 工作流 | 
| Suno v5.5（版本号误记） | ≈10% | Suno 官方博客 2026-03-26 发布 v5.5，确实存在且是音乐模型；但「opus」是 Claude 家族名，且用户语境是视频创作 |
| 其他（Mureka/udio/GPT-6 等） | ≈5% | 无「Opus」命名；若用户记得的是「5.5」版本号，最接近的是 Suno v5.5 或 Claude Opus 5.5 |

**不要编造型号**：截至 2026-10，公开信息中没有名为 Opus 5.5 的音频生成模型/API。

### 1.2 证据链要点

- **2026-09-28 量子位**：Opus 5.5 代码直出 MV 刷屏；donald 用例中模型自己写代码、做分镜、配画面、加转场跑了 12 小时；作者明确「用 Suno 重新编成 Techno 电子版，再让 Opus 5.5 配上赛博 MV」；社区总结的流程是「本机装 Node.js 和 FFmpeg，需要图片、音乐时再接 Midjourney、Suno」。
- **2026-09-22 PTT**：许多作品用 Web Audio API / 纯 JS 合成音乐并让动画与音乐精准同步；建议提示词「用纯 JavaScript Canvas 绘制每一帧，尝试用 Web Audio 同步音乐」。
- **2026-10-14 36kr**：新一代疑似 Claude 模型可从代码直接产出视觉、音效，甚至做 Hamilton；作者自述使用 Suno 做音乐、ElevenLabs 生成人声 + Three.js 同步 MV。
- 社区共识：「提示词只占 10%，90% 是生产框架」；节拍图（BPM/重拍/音量峰值）是音画同步的关键方法，这也正好对应需求 2 的 beat alignment。

### 1.3 对本产品的直接含义

1. **不要**把「让模型写 WebAudio 代码」当作音频能力交付：composition 禁 `<audio>` 是**插件策略**（HyperFrames 本身可渲染 media 元素），但 render 只采集 video 帧与 `<audio>/<video>` 元素，**页面内 Web Audio 程序化合成的输出不会被 Render 采集**（△ 基于 render 只处理 media 元素的实现推断），程序化音频仍进不了导出 MP4；最多做简单 SFX/chiptune 实验（不推荐 v1）。
2. **要**做的是「生成/导入 → 进工程 → 可预览 → 可导出」的资产与轨道闭环，让 Agent 只负责「选风格、写提示词、选曲、对齐节拍」，音频生成交给受控 provider。
3. 用户预期来自 Opus 5.5 案例，**默认期望音画踩点**；v1.0 至少给「BGM 起点对齐 + 可手动/自动微调偏移」，节拍同步列为加分项。

## 2. 生成音频能力全景（2026-10）

### 2.1 音乐 / BGM

| 产品/模型 | 版本与日期 | 时长/输出 | API 与鉴权 | 计价（量级） | 商用/水印/stems | 备注（来源，日期） |
|---|---|---|---|---|---|---|
| **Suno** | v6/v6-wild/v6-mini 2026-09-08；v5.5 2026-03-26 | 约 4–5 分钟；MP3/WAV | **无官方开发者 API**（截至 2026-05）；第三方聚合商 key（RunAPI/MuAPI/GoEnhance 等） | 官方订阅制；聚合商 $0.078/次请求（GoEnhance，◐） | 付费计划可商用，但 2026-09-03 条款：**只有官方渠道下载的文件可商用**，录音/流抓取禁止，Remix 曲目付费也不可商用；stems 付费 ✅/◐ | 质量与人气第一（AA 人声榜 Elo 1170）；API 为逆向封装，**不建议产品依赖** |
| **Udio** | 2026 年转型授权版 | — | 无可用公共 API | — | **围墙花园**：与 UMG/WMG/Merlin 授权，产出不得离开平台 | 直接排除（Billboard 2025-12-04 / 2026-01-19） |
| **Mureka（昆仑万维）** | V9.5 2026-09；V8 2026 年中 | 歌曲/纯音乐；mp3/wav/flac | **官方 API** `platform.mureka.ai`，key 鉴权，异步任务 | 官方按充值档（单曲单价未在 FAQ 列出，△）；聚合商 $0.225/首（WaveSpeed） | 付费 API 调用**含完整商用授权**（官方 FAQ ◐）；stems 单独付费；中文/9 语种 | 国内主体、中文友好；有官方 API 是最重要优点 |
| **MiniMax Music** | Music 3（2026-08-13） | 最长 360s，默认 300s；m4a/AAC 默认 | 官方 API（MiniMax 开放平台），同步/异步 | ≈$0.0018–0.002/s → 30s ≈¥0.39（EmpirioLabs ◐） | 商用条款未在公开页确认（△）；国内直连 | 中文 prompt 友好，成本最低一档 |
| **ElevenLabs Music** | v2（2026-05）；v1 仍可用 | **最长 5 分钟**；3–600s；44.1kHz MP3 128–192kbps（v2 可到 320） | 官方 REST `music_generation.compose`，`xi-api-key` | **$0.15/min**（官方定价页，2026-10）；v1/v2 已降价至多 50% | 付费计划商用（Starter+）；无同步费/无 clearance 延迟（官方博客 ◐） | 商用条款最干净的之一；中文风格控制未实测（△）；输出格式参数完善 |
| **Google Lyria** | Lyria 3.5 / 3 Pro / 3 Clip（2026-09 前后） | Clip 固定 30s；Pro/3.5 **≤3 分钟**；MP3 默认，Pro 可 WAV | **Gemini API 官方**（`generateContent`），API key；Vertex 企业版另有 indemnification | **$0.04/30s clip；$0.08/≤3min 全曲**（Gemini API 官方，2026-09） | 官方商用条款；Vertex 企业版有 IP 赔偿（◐） | 官方文档支持文本/图片→音乐、按时长或时间戳控制；结构化一致性一般 △ |
| **Stable Audio** | 3.0（≤6 分钟）/ 2.5（≤3 分钟） | 44.1kHz，wav/mp3 | 官方 API `platform.stability.ai` | 8 credits/次，credits 约 $0.00099/个（第三方站 ◐）→ 单曲 ≈$0.008 | 付费商用（未逐条核对 △） | 音乐+音效都能做，audio-to-audio；质量中上 |
| **Adobe Firefly Audio** | GA 2026-08-19（soundtrack/voice/SFX 三模块） | 未公开细项 △ | Firefly API（需 CC 账号/企业） | 积分制 △ | 官方称 **fully cleared for commercial workflows** ◐ | 适合企业合规场景；API 门槛与计价未核实 |
| **开源本地：ACE-Step 1.5** | 1.5（2B，MIT ◐；2026-09 已有 MLX 8-bit 移植） | 最长数分钟；wav | 本地 Python/MLX，无 key | **¥0**（本地算力） | MIT 允许商用（模型卡 ◐），训练数据版权需自查 | Apple Silicon 可跑（`mlx-music` 0.0.1，2026-02）；质量/速度未实测 △ |
| **开源：MusicGen（Meta）** | 2023–2024 | 30s | 本地 Python | ¥0 | **权重 CC-BY-NC 4.0 非商用** | 不能用于产品；仅研究参考 |
| 国内其他 | 豆包/海绵音乐等 App 端 | — | **无公开音乐生成 API**（△） | — | — | 如需国内合规直连，优先 Mureka/MiniMax |

### 2.2 TTS / 旁白

| 产品/模型 | 版本 | 中文效果 | 计价 | 时间戳/对齐 | 延迟/并发 | API/商用 |
|---|---|---|---|---|---|---|
| **ElevenLabs** | v4（2026）/ v4 Turbo / v3 / Flash | 好（未实测） | **v4 $0.08/1k chars；v4 Turbo $0.04；v3 $0.08；Flash $0.04**（官方页 2026-10） | 有 `/with-timestamps` 字符级时间戳（△ 未在定价页列出） | ~75–100ms 首字节（Turbo/Flash）；v3 ~280ms | 官方 REST `xi-api-key`；付费可商用；多角色 v3 |
| **MiniMax Speech** | speech-2.6-hd / 2.6-turbo | 强（中文母语级） | 约 ¥2–3.5/万字符（官方定价页档位，未逐项核对 ◐） | 返回音频时长/大小；逐字时间戳待确认 △ | 同步 T2A + 异步最长 100 万字符 | 官方 API；国内直连；商用需看套餐 |
| **豆包语音合成大模型（火山引擎）** | 2026 在售 | 很强（情感/音色/方言多） | **≈¥4.5/万字符**（官方计费页，2026-09-28 ◐） | 需确认字幕时间戳能力 △ | 并发增购包；流式 | 官方 API；国内合规主体；企业实名 |
| **OpenAI TTS** | gpt-4o-mini-tts（+ gpt-realtime-2 用于实时语音） | 可用（多语种） | **$0.60/1M 文本 tokens + $12/1M 音频 tokens**（官方 docs，≈$0.015/min △） | **无逐字时间戳**（△） | 流式、低延迟 | 官方 API；商用 |
| **Google Cloud TTS / Azure Speech** | 2026 在售 | 一般–可用 | Google ≈$4/$16/$30 per 1M chars（◐）；Azure 中文神经 ¥95.4/1M chars（azure.cn，◐） | Google SSML `<mark>` 可取时间点；Azure word-boundary 需 SDK 事件 | 成熟稳定 | 官方 API；商用 |
| **Fish Audio** | S2.1 Pro / S2 Pro / S1（2026-09 起含 Qwen TTS 3 Flash） | 强（中文、声音克隆） | **≈¥1.14/万字符**（CSDN 2026-10 ◐）；官方 500 credits/1k 中文字（◐） | 支持 duration 参数；时间戳待确认 △ | 云 API | 商用需条款确认；克隆需授权 |
| **CosyVoice 3 / Fun-CosyVoice3** | 3（2026；阿里 FunAudioLLM） | 强（中文，可克隆/指令控制） | **¥0 本地/自托管** | 可自行对齐（配 whisper） | **150ms 级流式**（官方 README ◐） | 开源（Apache-2.0 历史，△ 最新许可需核对）；克隆合规自查 |
| **Hume Octave-2** | 2026 | 英文情绪强，中文未验证 △ | 按字符计费（SDK 无内置价，△） | 未验证 △ | 云 API | 商用条款未核实 |
| **Edge TTS（免费通道）** | — | 中文可用、机械感 | **¥0** | 无 | 无 SLA | 非官方逆向通道，**条款风险**；仅原型/开发者兜底（DSH 生态 `dsh-voco` 已用于语音回复） |

### 2.3 音效 SFX 与音频处理

| 能力 | 方案 | 计价 | 输出/说明 | 来源（日期） |
|---|---|---|---|---|
| 文本→音效 | **ElevenLabs Sound Effects** | **$0.12/min**（官方）；单条通常 ≤22s | 44.1kHz MP3 或 48kHz WAV；royalty-free | elevenlabs.io/pricing/api（2026-10）；22s 上限为二手 ◐ |
| 文本→音效/音乐 | **Stable Audio 3.0/2.5** | 8 credits/次 | ≤6min/≤3min；wav/mp3 | platform.stability.ai/pricing |
| 文本→音效（开源） | Meta **AudioGen** | ¥0 | 约 10s；权重非商用 △ | github.com/facebookresearch/audiocraft |
| 去人声/分轨 | **demucs（htdemucs）** | ¥0 本地（MPS/CPU） | vocals/drums/bass/other 四轨；MIT | github.com/facebookresearch/demucs |
| 降噪/去背景 | **ElevenLabs Voice Isolator** | **$0.12/min**（官方） | WAV/MP3/FLAC/OGG/AAC；≤500MB、≤1h | elevenlabs.io/pricing/api |
| BPM/节拍分析 | **librosa**（本地） | ¥0 | beat_track/tempo；可生成「节拍图」供踩点 | librosa.org |
| 字幕/对齐 | **whisper.cpp / faster-whisper / MLX Whisper**（本地） | ¥0 | 词级时间戳，中英文；与 TTS 音频对齐做字幕 | github.com/ggerganov/whisper.cpp |
| 响度标准化 | **ffmpeg loudnorm（EBU R128）** | ¥0 | 目标建议 -14 LUFS / TP -1.5 dBTP（视频平台） | ffmpeg.org/ffmpeg-filters.html |
| 混音/淡化/变速/ducking | **ffmpeg** `amix/volume/afade/atempo/adelay/sidechaincompress` | ¥0 | 见 3.3 滤镜链 | 同上；可行性参考 claude-mods ffmpeg-ops（2025-11） |

## 3. 视频编辑器里的音频产品设计（分层）

### 3.1 音轨数据模型（v1.1 结构化 UI 的目标格式；v1.0 直接写 composition 内 media 元素）

```
audio: {
  version: 1,
  tracks: [{
    id, kind: "bgm" | "voice" | "sfx",
    volume: 0..1, muted: bool,               // 轨级
    clips: [{
      id, assetId,                            // 指向受管素材（asset.import 后的 id）
      start: 秒,                              // 时间线入点
      inPoint: 秒, outPoint: 秒,              // 素材内裁剪
      gain: 0..1, fadeIn: 秒, fadeOut: 秒, loop: bool,
      ducking: { enabled, targetDb } | null   // 加分项
    }]
  }],
  mix: { loudnessTarget: -14, truePeak: -1.5 } // EBU R128 导出目标
}
```
要点（已按复核修正）：
- **v1.0 音频实际宿主 = composition 内的 `<audio>/<video>` 元素**（`src` 指向 `project.json` 已声明资产，带 `data-start`/`data-duration`/`data-media-start`/`data-playback-rate`/`data-volume`/`data-fade-in|out`），由 HyperFrames 原生混音导出；fade/volume/起点远点都在元素属性上，不需要另建工程级混音器。
- 上面的 `project.audio` 结构**不是 v1.0 的磁盘格式**，而是 v1.1「结构化音轨 UI」的目标模型：UI 编辑后**编译为**上述 media 元素写进 composition（或作为后备的后期混流输入）。好处：同一份数据既能被模型 compose 也能被 UI 编辑，避免双写。
- `assetId` 走现有受管素材收件箱/asset.import（音频类型需扩展）；生成结果与用户上传都落受管目录，天然复用持久化、路径校验与跨工程隔离。

### 3.2 功能分层

| 层 | 必须（v1.0） | 加分（v1.1+） | 暂不做 |
|---|---|---|---|
| 素材 | 上传音频（复用 asset-upload/import）；生成 BGM/旁白/音效并入库；试听、删除、重命名 | 素材库搜索/收藏/去重（hash） | 音频裁剪编辑器 UI |
| 音轨 | 1 条 BGM + 1 条旁白 + 1 条音效；轨级音量/静音；clip 入出点/起点/loop | 多 BGM/多音效轨；轨道重排；solo | 专业多轨时间线编辑器 |
| 包络 | clip 增益 + 淡入/淡出（线性/等功率） | 关键帧音量包络；旁白自动 ducking BGM | 压缩/EQ 等混音处理 |
| 预览 | 与画面同步播放/暂停/seek；音量即时生效 | 波形显示（peaks 缓存）；当前播放头 | 实时音频效果器 |
| 对齐 | BGM 从 0 或指定秒开始；旁白按文案时间对齐 | **beat sync**（BPM/重拍 → 镜头切换建议）；自动对齐旁白与字幕 | 自动剪辑/自动配乐编排 |
| 导出 | **HyperFrames 原生混音**（media 元素 → AAC 192k）；响度用 `hyperframes normalize-audio`/ffmpeg loudnorm | 输出多版本响度（平台/播客）；单独导出音轨 | 母带处理 |

### 3.3 预览同步与两条导出路径（复核后修正）

**路径 1（v1.0 推荐，HyperFrames 原生）**
- 导出：composition 内放 `<audio>/<video>`（本地资产、无外部 URL），`hyperframes render` 自己完成「逐元素截取（mediaStart/duration/playbackRate）→ ffmpeg 混音（`amix normalize=0` + volume 自动化）→ AAC 192k」。`src/jobs.mjs` 不需要新增混流步骤，但**渲染后校验要改**：当前只校验 `streams[0]=h264/30fps/帧数`，需允许并校验可选音轨（aac/48kHz/时长≈composition）与 `audioFailures` 诊断透传。
- 预览：当前预览是插件自研的 `canvas-runtime.js`（`host/snapshot.js` 注入，**不是** HyperFrames player runtime），已有 `postMessage` 的 `play/pause/seek/seeked` 协议，但**尚未镜像 media 元素**；需在该运行时里按 `data-start/duration/mediaStart/playbackRate/volume/fade` 同步播放 `<audio>/<video>`（参考 HyperFrames `hyperframe-runtime.js` 的 media 逻辑）。这是路径 1 的主要增量与最高风险点。
- 响度与节拍：HyperFrames CLI 自带 `audio`（onsets/peaks/loudness/silence，可按 film time 查询）、`normalize-audio`（integrated LUFS 对齐，只改 `data-volume`，+12dB 上限与削波保护）、`beats` 模块（BPM/rhythm/energy）→ beat sync 与响度可复用，少写一套分析。
- 素材服务：需要预览路由支持音频 MIME 与 **HTTP Range/206**（`<audio>` seek 依赖；当前 host 路由未实现 Range），preview snapshot manifest 增加音频条目与上限；CSP 增加 `media-src 'self'`。

**路径 2（后备：工程级音轨 + 渲染后混流）**
- 导出：`hyperframes render` 产出无音轨 h264 后，worker 用 ffmpeg 二次混流（视频 `-c:v copy`，仅一次音轨编码，成本很低）：
  ```bash
  # 1) 各轨预处理（裁剪/延迟/循环/淡入淡出/增益）→ 单轨 WAV
  ffmpeg -i bgm.wav -af "atrim=in:out,asetpts=PTS-STARTPTS,adelay=3000|3000,volume=0.6,afade=t=in:st=0:d=1,afade=t=out:st=27:d=3" bgm_mix.wav
  # 2) 旁白轨 + BGM ducking（加分项）
  ffmpeg -i bgm_mix.wav -i voice.wav -filter_complex "[0:a][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[bg];[bg][1:a]amix=inputs=2:duration=longest:normalize=0[a]" -map "[a]" mix.wav
  # 3) 响度标准化（两遍 loudnorm）后与无声视频混流，视频流直接 copy
  ffmpeg -i render.mp4 -i mix.wav -c:v copy -c:a aac -b:a 192k -shortest out.mp4
  ```
- 预览：客户端外壳（React）在 iframe 外播放 `<audio>`，按播放头时间计算 `start+inPoint`；仍需运行时上报/广播连续播放头（现有协议只有离散 `seeked/paused`）。
- 校验：`streams[0]=h264/30fps/帧数` + `streams[1]=aac/48kHz/时长≈composition`；以视频时长为准，多余音频截断、不足补静音。

**共同点**：两条路都需要「音频资产入库 + 预览服务（MIME/Range）+ 播放同步 + 导出校验」；差别只在混音发生在 HyperFrames 内还是我们自己的 ffmpeg 步骤。取消/超时复用 job 的 AbortSignal 与 `ownedPids`；生成与渲染都必须是**异步 job**，不能是 HTTP 长请求。体积：30s 48kHz 立体声 AAC 192k ≈ 0.7MB；WAV 母带 30s ≈ 5.3MB；素材落盘按工程目录管理，导出后可选清理临时文件。

## 4. 本插件接入架构选项（A–E）

### 4.1 仓库现状约束（已核实）

1. **composition 受控（插件策略）**：`packages/video-engine-worker/src/composition.mjs` 的 `FORBIDDEN_TAGS` 主动禁用 `audio/video/source/track`，并禁止外部 URL，上限 48KiB/转义 60KiB、最多 40 元素；worker README「合成契约」第 5 条同样明示。**这不是 HyperFrames 的限制**——已安装 0.8.167 支持 media 元素与原生混音（证据见文首修正注记）。
2. **渲染链路**：`src/jobs.mjs` 调 `hyperframes render --format mp4 --fps 30 --quality standard`；HyperFrames 会为 `<audio>/<video>` 做截取+混音（AAC 192k），所以**引擎侧音频能力现成**，但插件渲染后校验只关注 `streams[0]` h264，需扩展为允许音轨并透传 `audioFailures`。
3. **Host 边界**：Host 负责 routes/bridge/tool/worker 监督，不跑生成脚本；worker 是独立 Node 进程（自带 ffmpeg/Chrome），适合跑生成与混音长任务。
4. **素材类型白名单**：`registry.mjs#imageSignature` 只识别 PNG/JPEG，`asset.import` 对非图片直接 `E_PARAMS("Only PNG/JPEG assets are supported")`；`MAX_ASSET_BYTES=8MiB`、项目资产总量上限 64MiB、资产数上限。→ 音频要按类型扩展签名嗅探、扩展名、体积上限与 ffprobe 时长探测。
5. **素材受管**：`POST /api/dsh-video/asset-upload`（UI-only）→ `assetInboxRoot` → `asset.import`（worker，凭 receiptId）；生成音频应走同一收件箱模型落盘。
6. **凭据原则**：Host/插件包不内置模型凭据；可信配置（worker 路径等）由部署方在 Loader 行 `config` 提供，缺失即 `E_CONFIGURATION`。**第三方音频 key 应被视为「用户/部署方提供的第三方服务凭据」，而不是宿主模型凭据**。
7. **Tool 授权**：`video_engine` 操作必须来自绑定工程的受信 Agent Session；新增音频生成/轨道操作应沿用同一作用域与校验。
8. **预览运行时**：预览是插件自研 `canvas-runtime.js`（`host/snapshot.js` 注入），非 HyperFrames player；现有 postMessage 只有离散 `play/pause/seek/seeked`，media 播放同步与连续播放头都需要扩展。

### 4.2 A–E 对比

| 维度 | A) Host/worker 直连第三方 REST | B) 复用 DSH 宿主音频能力 | C) Agent 用 shell/HTTP 生成后 import | D) 本地开源模型 | E) 用户自传 + AI 编排 |
|---|---|---|---|---|---|
| 用户流程 | 插件内选 provider/音色 → 生成中 → 入库 → 拖入轨 | 同 A，但走宿主已有 provider/MCP | 让模型自己 curl/脚本生成再 import | 设置里下载模型 → 本地生成 | 上传 mp3/wav → 入库 → 编排 |
| 密钥 | **用户自备**（env/插件设置/钥匙串/Loader config），Host 只在内存/受控文件持有，不进模型上下文 | 宿主已配置的 provider 凭据（**是否存在待审计**） | 密钥会进入 Agent/工具上下文（**高风险**） | 无 key | 无 key |
| 可控性/可取消 | 高（异步 job、超时、重试、计费预估） | 中高（取决于宿主接口） | 低（依赖模型行为与工具权限，失败不可控） | 高 | 高 |
| 质量/覆盖 | 高（接最好的商业模型） | 取决于宿主已有能力 | 同 A | 中（ACE-Step/CosyVoice） | 取决于用户素材 |
| 离线 | 需联网 | 需联网 | 需联网 | **可离线** | **可离线** |
| 工程量 | 中：provider 适配层 + job + 密钥 UI + 素材入库 | 中低（若宿主提供） | 低（插件零 SDK），但不可交付 | 高（模型管理/性能/质量） | **低**（已有 asset-upload） |
| 主要风险 | 条款/计价/稳定性/密钥 | 宿主是否提供、是否开放给插件 | 密钥泄漏、失败不可控、提示词不可复现 | 体积/速度/质量/Apple Silicon 兼容 | 不解决「生成」诉求，但保底 |
| 代表证据 | ElevenLabs/Lyria/Mureka/MiniMax 官方 API | 生态已有 `dsh-audiogen`（本机 settings 存 key + loopback 代理 + `generate_audio` tool，2026-08-30）；`dsh-voco` 用 Edge TTS（2026-08-31） | Opus 5.5 案例本身（Claude Code + Node/FFmpeg + Suno/ElevenLabs） | ACE-Step 1.5 MLX（2026-09）、CosyVoice3 | 现有 `asset-upload`/`asset.import` 已具备 |

### 4.3 密钥从哪来（A 方案展开，必须不违反「不内置凭据」）

优先级建议：
1. **用户环境变量**（`DSH_VIDEO_ELEVENLABS_KEY` 等）：最简单、不落盘，适合开发者/高级用户；Host 构造 worker 环境时显式白名单传入，不继承其他 env（与现有 env 清理策略一致）。
2. **插件设置页用户输入**（存 DSH 本机 settings 或插件私有 settings 文件，0600）：最友好；生态先例 `dsh-audiogen` 即此模式（key 存本机 settings，仅 loopback 路由使用）。需明确「这是用户自己的第三方账号凭据，不随插件分发」。
3. **macOS Keychain**（`security` CLI）：更安全，但跨平台与首启体验成本高，可作为 v1.1。
4. **部署方在 Loader 行 config 提供**（`audioProviders: {elevenlabs: {baseUrl, keyRef}}`）：团队/企业部署用，key 仍在部署配置，不在包内。
- 禁止：把 key 写进包、写进工程、回显到对话、写入模型上下文；日志脱敏；错误信息不含 key；生成请求由 Host/worker 发起，浏览器侧永不接触 key。
- 计费提示：生成前展示「预计成本/额度消耗」，生成后记录 usage（provider 返回的字符/秒数）。

### 4.4 推荐路线

| 阶段 | 范围 | 理由 |
|---|---|---|
| **v1.0 必须** | **E 保底 + A 主路径**（ElevenLabs Music v2 BGM + ElevenLabs v4 Turbo / 豆包 TTS 旁白 + ElevenLabs SFX；provider 适配层可替换；用户自备 key，设置页 + env 两种来源）；**音频渲染走 §4.6 路径 1（composition 内 media 元素 + HyperFrames 原生混音）** | 闭环最短、商用条款清晰、成本可忽略；引擎侧混音现成，导出侧最省；不依赖宿主能力与模型工具权限 |
| v1.0 可选 | C（开发者模式）：允许 Agent 用 `curl` 调已配置 provider 后把文件放进素材收件箱 | 复用 Opus 5.5 工作流，零额外 SDK；但默认关闭并提示风险 |
| v1.1 | B（宿主能力就绪后接入 TTS/MCP，复用宿主 provider 与计费） | 降低用户配置成本；依赖宿主审计结论 |
| v1.1 实验 | D（ACE-Step 1.5 MLX 离线 BGM；CosyVoice3 离线旁白） | 离线/免费卖点，但质量与 M 系列速度需实测 |
| 不建议 | 单纯依赖 Suno 聚合商 API、Udio、MusicGen | 条款/稳定性/非商用许可风险 |

**收益/代价**：A 需要新增「音频生成 job + provider 适配 + 密钥设置 + 素材入库 + 放开受控 media 的音频链路（约 5–8 人日，见 §4.6）」一条中等规模里程碑；但它同时为需求 2（音轨）、需求 3（素材导入，含 `<video>`）打好底座，是最划算的 v1.0 投入。

### 4.5 成本与延迟估算（单次，2026-10 价目）

| 场景 | 方案 | 成本（估算） | 延迟量级（△ 未实测） |
|---|---|---|---|
| 30s BGM | ElevenLabs Music v2 | $0.075 ≈ **¥0.54** | 20–60s |
| 30s BGM | Lyria 3 Clip（30s 固定） | $0.04 ≈ **¥0.29** | 10–30s |
| 30s BGM | MiniMax Music 3 | ≈ **¥0.39** | 30–120s |
| 30s BGM | Suno v6（聚合商，不推荐） | $0.078 ≈ ¥0.56 | 30–120s（异步轮询） |
| 30s BGM | Stable Audio 3（credits） | ≈ ¥0.06（第三方口径 △） | 10–60s |
| 30s BGM | ACE-Step 1.5 本地 | **¥0** | 1–5min（M 系列，△） |
| 30s 旁白（约 100 中文字） | ElevenLabs v4 Turbo | ≈ **¥0.03** | 1–5s（流式首字节 ~100ms） |
| 30s 旁白 | 豆包 TTS | ≈ **¥0.045** | 1–5s |
| 30s 旁白 | Fish Audio S2.1 Pro | ≈ **¥0.011** | 1–3s |
| 30s 旁白 | CosyVoice3 本地 | **¥0** | 实时级（150ms 流式） |
| 3s 音效 | ElevenLabs SFX | ≈ **¥0.04–0.3**（按分钟/按次口径差异） | 1–10s |
| 30s 成片音频总增量（BGM+旁白+1 音效） | v1.0 推荐组合 | **≈ ¥0.5 以内** | 全流程 1–3min（含人工确认） |

结论：单条视频音频成本可忽略（<¥1）；真正的成本是**用户配置成本 + 失败重试 + 长任务等待**，因此产品要把「生成状态、取消、重试、预估费用」做扎实。

### 4.6 音频渲染路径复核：原生混音 vs 工程级音轨（2026-10-21 修正）

**证据（只读检查，已复核）**

| 结论 | 证据位置 |
|---|---|
| HyperFrames 0.8.167 有完整音频混音链 | `artifacts/p2-b/staging-alpha10-1cceb96/engine-worker/node_modules/hyperframes/dist/chunk-4U5FN6FY.js`：`extractAudioSegment`（mediaStart/duration/playbackRate + `atrim/aresample`）、`mixAudioTracks`（`filter_complex_script` + `amix=inputs=N:duration=longest:normalize=0` + volume 自动化 + AAC `-b:a 192k` + `-t totalDuration`）、`generateSilence`（`anullsrc=r=48000:cl=stereo`）；volume 自动化失败时降级重试并标记 `degradedAutomation` |
| render 会处理 composition 内 media 元素 | 同文件：遍历 audio/video，video 先抽 `${element.id}-extracted.wav` 再进混音；空 duration 用 ffprobe 元数据补齐；失败进入 `audioFailures`（≤16 条，allowlist 字段） |
| media 元素属性契约 | `data-start`、`data-duration`、`data-media-start`/`data-playback-start`、`data-playback-rate`(0.1–10)、`data-volume`、`data-fade-in`/`data-fade-out`；player/runtime 同步 media 与 timeline（`hyperframe-runtime.js` 等） |
| 额外原生能力 | `hyperframes audio`（onsets/peaks/loudness/silence，支持 film time）、`normalize-audio`（integrated LUFS 对齐、只改 `data-volume`、+12dB 上限/削波保护）、`beats` 模块（BPM/rhythm/energy）——beat sync 与响度可直接复用 |
| 插件侧限制是自设的 | `src/composition.mjs` `FORBIDDEN_TAGS`；worker README 合成契约第 5/6 条；`registry.mjs#imageSignature` 仅 PNG/JPEG；`MAX_ASSET_BYTES=8MiB` 等 |

**两种实现与代价（人日为粗估，含评审与测试）**

| 项 | 路径 1：放开受控 media + HyperFrames 原生混音（推荐 v1.0） | 路径 2：工程级音轨 + 渲染后 ffmpeg 混流（后备） |
|---|---|---|
| 导出 | 引擎原生混音，几乎零新增；只需扩展 render 校验（允许/校验 aac 48kHz、时长一致）与 `audioFailures` 透传：**1d** | 新增混音器 + ffmpeg 调用 + job 阶段 + 校验：**2–3d**；多一次音轨编码（视频 copy，成本低） |
| composition 策略 | 放开 audio/video 标签（仍禁外部 URL，只允许已声明本地资产），校验属性范围与码率/元素数：**0.5–1d + 安全评审** | 不动 composition；但需要新的音频数据模型/桥方法/Tool 动作：**2–3d** |
| 素材入库 | 扩展 asset 类型（mp3/m4a/wav/aac/ogg/flac 嗅探）、按类型体积上限、ffprobe 时长/采样率：**1–2d** | 同左（**1–2d**） |
| 预览 | 扩展自研 `canvas-runtime.js` 镜像 media 元素（play/pause/seek/连续时间、fade/volume）＋预览路由 MIME/Range：**2–3d**（最高风险） | 客户端外壳 `<audio>` 同步 + 运行时连续播放头上报 + 路由 MIME/Range：**2–3d** |
| 音轨编辑/模型创作 | 音频即 HTML 元素，模型 compose 时自然产出；结构化 UI 可在 v1.1 编译成元素：**0.5–1d（契约/提示词）** | 需双写：模型改 HTML、UI 改音轨 JSON，一致性/回滚复杂：**+1–2d** |
| 数据/工程语义 | 天然随 composition revision/history；无需新持久化格式 | 需在 project.json 新增 audio 段并处理 revision/历史/合并 |
| 合计（v1.0 最小） | **≈5–8 人日** | **≈8–12 人日** |

**推荐**：v1.0 走**路径 1**（原生 media + HyperFrames 混音）——引擎能力现成、导出侧最省、与现有「模型 compose 整份 HTML」的创作模型一致，还能顺带满足需求 3 的**视频素材导入**（`<video>` 抽音轨/画面均原生支持）。路径 2 保留为后备/并行：当 v1.1 要做多轨结构化编辑器、复杂 ducking、或希望音频独立于 composition 时再启用（届时 UI 产出 `project.audio`，可编译为 media 元素，不必走后期混流）。<br>**注意**：路径 1 的关键风险不是渲染而是**预览**——自研 canvas-runtime 不认 media 元素，必须实现同步逻辑；这一点无论选哪条路都要做，故不改变结论。



## 5. v1.0 范围建议（可发布标准）

**Must（发布门槛）**
1. 音频素材入库：上传 mp3/wav/m4a（≤20MB/≤10min）、生成结果自动入库、列表/试听/删除；路径与权限沿用现有 asset 收件箱。
2. 生成能力：BGM（风格/情绪/时长/纯音乐）+ 旁白（文本/音色/语速/情绪）+ 音效（一句话），至少 2 家 provider 可切换；key 由用户提供且永不进对话。
3. 音轨：v1.0 音频以 composition 内 `<audio>` 元素承载（`data-start`/`data-duration`/`data-media-start`/`data-volume`/`data-fade-in|out`/`data-playback-rate`）；对话可增删 BGM/旁白/音效、调音量、起点、淡入淡出、loop；结构化多轨 UI 留 v1.1。
4. 预览有声：与画面 play/pause/seek 同步（扩展 `canvas-runtime.js` 镜像 media 元素）；生成中不阻塞画面预览。
5. 导出有声：HyperFrames 原生混音出 MP4（AAC 48kHz），响度经 `normalize-audio`/loudnorm 达 -14 LUFS / TP -1.5 dBTP；`audioFailures` 可见、可重试、可取消；导出音轨时长与画面一致。
6. 工程持久化：音频元素与素材资产随 composition/project.json 同 revision 生效；重开工程可复现。
7. 素材/媒体服务：音频资产入库（类型嗅探、体积/时长上限）、预览路由 MIME + Range、CSP `media-src 'self'`、快照 manifest 覆盖音频。

**Should（v1.0 末/1.1 初）**：波形显示、旁白自动 ducking、BGM 偏移微调（±0.5s 步进）、生成 prompt 保存/复用、用量与费用记录、批量生成候选（3 选 1）。

**Could**：beat sync（HyperFrames `audio`/`beats` 分析 BPM/重拍后建议切镜点）、结构化多轨时间线（`project.audio` → 编译为 media 元素）、自动字幕（whisper 词级时间戳）、本地模型离线模式。

**Won't（本版明确不做）**：外部 URL 媒体元素（仍只允许已声明本地资产）、音频实时效果器、声音克隆、多语言配音、版权检测。

**验收（真实环境）**：一句话 → 生成 30s BGM + 60 字旁白 → 进工程 → 左侧预览有声且可 seek → 导出 MP4 用 `ffprobe` 验证含 aac 48kHz 音轨、时长一致、loudnorm 达标；取消与失败路径各验证 1 次。

## 6. 风险与未验证项

| 风险 | 影响 | 缓解 |
|---|---|---|
| 第三方条款/商用授权不清（尤其 Suno 聚合商、Udio、MiniMax/Stable 条款） | 用户作品无法商用/法务风险 | 优先条款明确的 ElevenLabs/Lyria/Mureka 官方 API；生成前展示 provider 商用条款；Suno 聚合商不设为默认 |
| Suno 无官方 API、聚合商为逆向封装 | 随时断供/封号/密钥失效 | 不做唯一依赖；provider 适配层可替换 |
| 声音克隆/拟声合规（CosyVoice、Fish、ElevenLabs Voice Design） | 侵权与合规风险 | v1.0 不做克隆；仅预置音色；要求用户确认授权 |
| 中国 AIGC 标识与深度合成规定（生成内容需标识） | 境内发布合规 | 导出/发布链路预留 AI 生成标识能力；需法务确认具体规则（未验证） |
| 平台内容审核（暴力/成人/版权歌词） | 生成被拒、账号风险 | 透传 provider 错误码；不绕过审核；提示词引导 |
| API 不稳定/超时/限流 | 用户等待失败、体验差 | 异步 job + 重试 + 超时 + 取消；多 provider；状态可视化 |
| 密钥泄露 | 用户额度被盗用 | 浏览器与模型永不接触 key；Host/worker 侧持有；日志脱敏；设置页可清除 |
| 离线用户/离线计费 | 无网不可用；无法计费 | E 方案永久保底；离线时隐藏生成按钮；本地模型作为 v1.1 卖点 |
| 长任务取消/进程残留 | 资源泄漏、孤儿 ffmpeg | 复用现有 job AbortSignal/ownedPids/超时；生成请求也纳入 job 管理 |
| 音频体积与持久化 | 工程膨胀 | 素材受管目录 + hash 去重 + 导出后可清理临时混音；单文件上限（音频需按类型放宽） |
| HyperFrames 版本漂移（media 属性/audioFailures/混音行为） | 升级后有声导出回归 | 锁定 0.8.167（staging 已固定）；升级前跑含音频的 render 回归；只用公开属性契约 |

**未验证/待确认清单**
1. 宿主 DSH 是否已提供 TTS/音频生成工具、音频 MCP、或可复用的 OpenAI-compatible provider 凭据（B 方案前提，另一 teammate 审计）。
2. MiniMax/Stable Audio/Adobe Firefly 的官方单曲单价与商用条款细节（页面抓取不完整/未逐条核对）。
3. ElevenLabs Music 中文 prompt 的实际质量、30–60s 生成的实测延迟；Lyria 中文 prompt 质量。
4. 豆包/MiniMax 是否返回逐字/句级时间戳（字幕对齐关键）。
5. ACE-Step 1.5 在 M1–M4 上的实测速度/质量/内存；MLX 8-bit 稳定性。
6. 插件自研 `canvas-runtime.js` 扩展 media 同步的可行性与工作量（播放器协议、autoplay 解锁、seek 精度、media 元素与 GSAP timeline 的对齐）；需先 spike。
7. 宿主 `video_engine` Tool 增加音频动作后的会话作用域与取消语义是否需要扩展现有 Host 契约。
8. 路径 1 真机验证：含音频 composition 的 render 耗时/失败率、`audioFailures` 真实场景、音轨时长一致性；30s 素材端到端。
9. HyperFrames 的 volume 自动化语法与 `data-fade-in/out` 边界；原生混音是否支持 sidechain ducking（当前证据显示只有 volume automation，ducking 需预计算或自实现）。
10. 音频 asset 的体积上限：现有 `MAX_ASSET_BYTES=8MiB` 对 10min WAV（约 100MB）不够，需按类型设限并评估预览 Range 实现成本。
11. 升级 HyperFrames（>0.8.167）时 media/audio 契约（属性、`audioFailures`、混音行为）是否漂移，需锁定版本 + 回归。

## 7. 参考链接（均为 2026-10-21 抓取，标注发布日期）

**opus5.5 澄清**
- [量子位/智源：Opus 5.5 代码直出音乐 MV 火了（2026-09-28）](https://hub-assets-cache.baai.ac.cn/view/58331)
- [PTT：Opus5.5 特别擅长用代码生成动画（含 Web Audio 同步音乐，2026-09-22）](https://www.pttweb.cc/bbs/AI_Art/M.1790155994.A.0C8)
- [36kr：疑似新 Claude 模型可从代码生成视觉/音效（2026-10-14）](https://eu.36kr.com/en/p/4026736601125252)

**音乐**
- [Suno：Introducing v6（2026-09-08）](https://suno.com/blog/introducing-v6)；[Suno v5.5（2026-03-26）](https://suno.com/blog/v5-5)
- [Suno 2026-09-03 条款变更解读：官方渠道下载才可商用、Remix 不可商用（2026-09-03，◐）](https://yokotashurin.com/etc/suno20260903.html)
- [Suno 无官方开发者 API 的记录（2026-05，◐）](https://raw.githubusercontent.com/api-evangelist/suno/refs/heads/main/apis.yml)
- [GoEnhance Suno 聚合 API 计价（2026-09-24，◐）](https://docs.goenhance.ai/api-reference/audio-generations/suno-overview)
- [Billboard：Suno/Udio 授权交易影响（2025-12-04）](https://www.billboard.com/pro/what-suno-udio-licensing-deals-mean-future-ai-music/)；[Udio-Merlin 授权、2026 换模型围墙花园（2026-01-19）](https://www.billboard.com/pro/udio-merlin-ai-music-licensing-deal/)
- [Mureka 官方 API FAQ（商用授权/并发/12 个月余额）](https://platform.mureka.ai/docs/en/faq.html)；[WaveSpeed：Mureka V9.5 API（2026-09-04，◐）](https://wavespeed.ai/blog/audio-and-voice-models/mureka-v9-5-music-api/)
- [ElevenLabs 官方 API 定价（Music $0.15/min、SFX $0.12/min、TTS v4 $0.08/1k）](https://elevenlabs.io/pricing/api)；[ElevenLabs Music v2（2026-05-25）](https://elevenlabs.io/blog/introducing-music-v2)
- [Gemini API：Lyria 音乐生成官方文档](https://ai.google.dev/gemini-api/docs/music-generation)（Clip 30s、Pro 可定制时长、MP3/WAV）；[Lyria 定价（2026-09-11，◐）](https://benchlm.ai/media-pricing/lyria)；[Lyria 3.5 上线（2026-09-06，◐）](https://www.sbbit.jp/article/cont1/186856)
- [Stability AI 官方定价（Stable Audio 3.0 ≤6min，8 credits）](https://platform.stability.ai/pricing)
- [Adobe Firefly 生成音频 GA（2026-08-19，◐）](https://llms.blog/posts/adobe-firefly-expands-generative-audio-tools-and-integrates-gemini-omni-flash)
- [MiniMax Music 3 聚合计价（2026-08，◐）](https://empiriolabs.ai/models/minimax-music-3)；[Replicate MiniMax-Music3（2026-08-14，◐）](https://replicate.com/bzikst/minimax-music3)
- [ACE-Step 1.5 MLX 8-bit（2026-09-25，◐）](https://huggingface.co/roman220220/ACE-Step1.5-sft-MLX-8bit)；[ACE-Step/Ace-Step1.5（MIT）](https://huggingface.co/ACE-Step/Ace-Step1.5)；[mlx-music（2026-02-08）](https://pypi.org/project/mlx-music/0.0.1/)

**TTS / 处理**
- [MiniMax 开放平台按量计费](https://platform.minimaxi.com/docs/guides/pricing)
- [火山引擎豆包语音计费说明（2026-09-28，◐）](https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21?lang=zh)
- [OpenAI GPT-4o Mini TTS 官方模型页](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)；[gpt-realtime-2 定价（2026-05，◐）](https://apidog.com/blog/gpt-realtime-2-api/)
- [OpenAI vs Google TTS 价格对比（2026，◐）](https://www.codesota.com/speech/openai-tts-vs-google-tts)；[Azure 中国区认知服务定价（2026-09-06，◐）](https://www.azure.cn/en-us/pricing/details/cognitive-services/index.html)
- [Fish Audio credits 规则](https://fishaudio.org/en/pricing/credits)；[Fish/MiniMax/ElevenLabs 刊例价拆解（2026-10-02，◐）](https://blog.csdn.net/2601_96838444/article/details/167039719)
- [CosyVoice3 / Fun-CosyVoice3（150ms 流式，2026-09，◐）](https://huggingface.co/IndexTeam/Index-Echo-S2ST-2B/blob/main/cosyvoice3/README.md)
- [Hume Octave 计费说明（2026-06，◐）](https://pypi.org/project/genblaze-hume/)
- [demucs（去人声/分轨）](https://github.com/facebookresearch/demucs)；[whisper.cpp（词级时间戳）](https://github.com/ggerganov/whisper.cpp)；[librosa（BPM/节拍）](https://librosa.org/)；[ffmpeg 音频滤镜（amix/afade/loudnorm/sidechaincompress）](https://ffmpeg.org/ffmpeg-filters.html)

**DSH 生态与本地依据**
- [dsh-audiogen：DSH 音频生成插件（2026-08-30）：本机 settings 存 key、loopback 代理、`generate_audio` tool、素材库](https://deepseekharness.io/plugins/dsh-audiogen/)
- [dsh-voco：DSH 语音对话插件（Edge TTS + SiliconFlow ASR，2026-08-31）](https://deepseekharness.io/plugins/dsh-voco/)
- 本仓库：`packages/video-engine-worker/src/composition.mjs`（**插件策略**禁 `audio/video/source/track` 与外部 URL，48/60KiB、40 元素）；`packages/video-engine-worker/src/registry.mjs`（`imageSignature` 仅 PNG/JPEG、8MiB/64MiB 上限）；`src/jobs.mjs`（`hyperframes render` + ffmpeg 元数据校验）；`host/snapshot.js`（自研 canvas-runtime 注入）；`host/asset-inbox.js`、`host/bridge.js`、`README.md`（Host 可信配置/路由/Tool 边界）。
- **本地复核证据（只读检查，2026-10-21）**：`artifacts/p2-b/staging-alpha10-1cceb96/engine-worker/node_modules/hyperframes`，`package.json` version=`0.8.167`；`dist/chunk-4U5FN6FY.js`（`extractAudioSegment` L15042、`generateSilence` L15088、`mixAudioTracks` L15130、`audioFailures` L4535 与 L15461 附近的 video 抽音轨）；`dist/chunk-Q2WGWWJ5.js` L897（mediaElements）；`dist/chunk-BSQ7XANM.js` L38/L46（`data-media-start`/`data-playback-rate`）；`dist/hyperframe-runtime.js`（media 同步/`data-fade-in|out`）；`README.md` L50–97（`audio`/`normalize-audio` 命令与 `audioFailures` 说明）。
- [HyperFrames 官方仓库（heygen-com/hyperframes，Apache-2.0）](https://github.com/heygen-com/hyperframes)
- [ffmpeg 音频混音/ducking 参考片段（2025-11，◐）](https://github.com/0xDarkMatter/claude-mods/blob/main/skills/ffmpeg-ops/references/audio.md)
