# V1-M0 验证门报告（Go/No-Go）

日期：2026-10-21（Asia/Shanghai）。状态：**M0 完成；结论 GO（B-1，带条件）**。
工作树：`v1-m0-validation`（`codex/v1-m0-validation`，base 缓存 `origin/main` `1aabd6e`）。
任务卡与实验源码保留在 `codex/v1-m0-validation` @ `803205e`（该分支实验代码未随 M2 候选打包）。方案：[v1.0 提案](../research/2026-10-21-v1-major-version-proposal.md) · [V1.0-PLAN](../plans/V1.0-PLAN.md) §5。
实验目录：`experiments/v1-m0/{media,preview,pipeline,migration,audio,spike}/`。原始产物在 `/tmp/v1-m0/`，摘要证据 `artifacts/v1/evidence/`（均不入仓）。

---

## 0. 结论

**GO：按 B-1 架构进入 M1/M2/M3。**

- 时间线真相 → 生成受控 composition → HyperFrames 同时承担预览与导出（媒体元素 + 原生音频混流）——**媒体逐帧 seek、嵌套子 composition、音频混音、有声导出均实测可行**。
- 旧工程迁移（整篇 → 单个 start=0 scene clip）**视觉零差异（SSIM=1.000000）**，可作 M1 迁移路径。
- 真实 DSH 的 @ 引用已完成 **Phase A 真机验证**（用户截图：原生 Composer @ 菜单出现「片段/场景/素材/区间」分组，可选中并插入 chip）。
- 无 S0 阻塞；发现 4 个必须在实现中处理的约束（`muted` 无效、45s 空等、预览音频手势、大文件全量读取）与 3 个产品预期（长片导出时长、响度、音乐邀测）。

**条件（M1/M3/M4 必须落实）**：
1. 生成器禁止用 `muted` 静音音频元素（用 `data-volume=0` 或不生成元素）；root/子 composition 必须注册 `window.__timelines[id]`，否则每次 render 白等 45s。
2. 预览媒体走 sandbox iframe + 工程级 Range 路由；音频采用「muted 自动播放 + iframe 内点击开声」交互，真机 autoplayPolicy 在 M1 候选验收时复核。
3. 媒体资产读取改 stat+流式校验、快照不含媒体、渲染 job 用 hardlink；Host media 路由实现 Range/HEAD/416。
4. 导出前做增益分级 + 两遍 loudnorm（目标 −14 LUFS / TP −1.5），render 超时按公式自适应。
5. @ 引用剩余 Phase A 项（发送序列化、刷新草稿恢复）与 Host 路由 Phase B 在 M5/候选 staging 复验。

---

## 1. 环境

| 项 | 值 |
|---|---|
| 机器 | Apple M3 / 24 GiB / macOS（本机） |
| Node | v24.14.0（`/opt/homebrew/opt/node@24/bin/node`） |
| HyperFrames | 0.8.167（只读复用已安装 alpha.11 staging 依赖） |
| Chrome | `/Applications/Google Chrome.app`（软件 GPU，headless） |
| ffmpeg | 8.0.1 |
| 基线 | 插件 0.3.0-alpha.11 安装态；M0 不改产品代码、不安装、不重启 |

---

## 2. 实验逐项结果

### 2.1 Lead 冒烟（最小媒体+音频）

- 5s：`<video data-start=0 data-duration=5 data-media-start=0 muted>` + `<audio data-volume=0.6>` + GSAP 标题。
- **render 10s**；输出 h264 1280×720/30fps 150 帧 + AAC 48k stereo；t=2s 抽帧显示源视频内置时间码 `00:00:02.000`，BGM 实混（mean −23.6 dB / max −15.9 dB）。
- 证据：`artifacts/v1/evidence/lead-smoke-*`。

### 2.2 M0-01 媒体契约（✅）

| 项 | 实测 |
|---|---|
| `data-start/duration` | 帧级精确（快照 timecode 2.500/8.500/9.500s 命中） |
| `data-media-start`（源内 in 点） | 精确 |
| `data-playback-rate=2/0.5` | 画面映射精确；**音频经 atempo 不变调**（1kHz 仍 1kHz，仅时长变化） |
| `data-volume` / `data-fade-in` / 音量自动化 | 生效；多 audio 元素混音正常（AAC 48k 2ch） |
| **`muted`** | **render 混音侧忽略 `muted`（仍满幅混入）；必须用 `data-volume=0`** |
| 嵌套 `data-composition-src` | **可用**：GSAP 子 comp 在父 t=1 出现/t=3 卸载；子 comp 内 `<video>` 也能逐帧渲染（t=4.5 白闪命中） |
| `audioFailures` | 可解析 `@hf-diagnostic` JSON；失败时 render **exit=1 无输出**（不静默降级） |
| `window.__timelines` 注册 | root/子 comp 未注册时 render 白等 **45s**（warning `sub_timeline_readiness_timeout`）；生产 must 注册 main |

> **设计影响**：生成器契约必须写死「音频静音用 data-volume=0」「root/子 comp 注册 timeline」；媒体元素与嵌套子 comp 可作为 v1.0 渲染目标。

### 2.3 M0-02 渲染基准（✅）

生产参数（单 worker、`--no-browser-gpu`、软件 GPU）：

| 工程 | 帧数 | 生产等价耗时 | 原始耗时* | 每帧 | 输出校验 |
|---|---|---|---|---|---|
| 20s（4×5s media + 嵌套 GSAP overlay + BGM + 旁白 12s） | 600 | **42.4s** | 92.5s | ~71ms | h264 1280×720@30 600 帧 + AAC 48k 2ch 20.000s |
| 120s（同构） | 3600 | **255.2s** | 307.9s | ~71ms | 3600 帧 + AAC 48k 2ch 120.000s |

\* 原始耗时含 45s timeline 空等；生产路径不踩（scenes/生成器注册 `window.__timelines.main` 后即为「生产等价」）。测试期间 loadavg 8–21（其它实验并发），无失败/超时/丢帧；120s 两次输出 md5 一致 → **确定性**。

**音画偏移**：8 个白闪/1kHz 事件，白闪落点 = 预期帧（30/180/330/480/840/1500/2220）；音频 onset 系统性领先 **6–8ms（<0.25 帧）**，120s 内无漂移 → 逐帧 seek 可接受。

**超时建议**：`timeout = max(300s, 60s + 140ms × frames)`；现网 900s 对 120s 工程有 3.5× 余量，但只覆盖约 200s 工程；长片需自适应（M6 落实）。引擎在混音峰值接近 0 dBFS 时会自动「audio lowered by 3.6 dB to stay under −1 dBTP」——产品仍需主动做响度/增益管理。

### 2.4 M0-03 预览链路（✅，真机 autoplay 待复核）

- **sandbox iframe（`allow-scripts`，opaque origin）内 `<video>` 完全可用**：真 Chrome 加载 30s/1280×720 H.264，readyState=4、muted 播放 OK、seek 2/10/20s 误差 ≤2ms。
- **Range 是硬需求**：Chrome 真发 `Range: bytes=0-`、尾部 `bytes=10321920-`（moov）、seek 区间 range；服务器需 206 + Content-Range + Accept-Ranges，HEAD 200/206，非法 416。
- **自动播放（严格策略）**：unmuted audio 的脚本自启/postMessage/`allow="autoplay"` 全部 `NotAllowedError`；**muted `<audio>` 也被拒**（静音豁免仅 video）；muted video 可播；iframe 内一次点击后 postMessage 可播；**父页面手势不能替代 iframe 手势**。放宽策略（`--autoplay-policy=no-user-gesture-required`）下 unmuted 自动播放成功。
- **真实 DSH 策略复核（只读 asar）**：Electron 44.7.0 / Chromium 152；App 与 desktop-host 未设 autoplayPolicy/`--autoplay-policy`/mute；Electron 44 typings 默认 `no-user-gesture-required` → **Electron 主窗口预计允许自动播放**；外部浏览器（127.0.0.1）预计需用户手势；sandbox iframe 受 Permissions Policy `autoplay` 默认 `self` 限制预计被拒 → 需真机确认。
- **推荐**：媒体留在 sandbox iframe；CSP 显式 `media-src 'self'`（同源验证 5 档均可）；音频交互 = muted 自动播放 + iframe 内覆盖层「点击开启声音」；父页面 WebAudio/`<audio>` 仅兜底。
- 证据：`experiments/v1-m0/preview/{README.md,evidence/m0-03-results.json}`。

### 2.5 M0-04 大文件读取/快照（✅）

1 GiB 文件、Node 24.14：

| 场景 | 内存峰值 | 耗时 |
|---|---|---|
| 现状 `Projects.read()`（readFile+sha256） | **1067–1073 MiB** | 1.04–1.90s |
| 现状 `Projects.snapshot()` | **2076–2098 MiB**（源码 read 两次） | 3.54–6.45s |
| `Previews.create()` | 2084–2092 MiB（写盘后回读 + 2×hash） | 5.37–6.48s |
| 流式 sha256 | **138–163 MiB** | 1.17–1.64s |
| hardlink 快照 | 127–167 MiB | 1.1–2.5s（`fs.link` 0.75–3.7ms） |
| v2 stat-only 读取模型 | **47 MiB** | 0.9–1.2ms |
| HTTP Range 原型 | 138–151 MiB（1 GiB 流式） | 0.75–0.83s（206/HEAD/416 全通过） |
| 对照：每请求 readFile+hash（snapshot.js 现状） | 1.16–2.20 GiB 且 RSS 不回落 | 0.8–1.0s |

**结论**：M1/M2 必须改 ① `read()` = stat + 一次性流式校验；② preview 快照只放入口+overlay，媒体不进快照；③ Host media 路由 = createReadStream + Range/HEAD/416 + 注册时 hash（ETag=sha）；④ render job 快照 hardlink + EXDEV fallback copyFile。
风险：hardlink 仅同盘且要求资产不可变/内容寻址；Windows/FAT 未测；冷缓存未测。

### 2.6 M0-05 旧工程迁移（✅）

- 工程：alpha.10 staging 的「DS 宣传片」（1280×720/15s/30fps，单文档 DOM+GSAP，无 media；alpha.11 staging 无该工程副本）。
- 迁移前/后 5 帧（0.5/3.5/6.5/9.5/12.5s）：**5/5 帧逐字节相同，SSIM=1.000000**；分辨率/SDK 时长一致；timeline durationFrames=450。
- v2 原型：1 个 `composition` clip（0/450 帧）+ 整篇 HTML 透传 + master 用嵌套 `data-composition-src` 挂载（根布局与 overlays 布局均可用）。
- 负控制有效：嵌套 `data-start=1s` 在 0.5s 处 SSIM 0.000002；`data-duration=5s` 在 6.5/12.5s 处 0.9545/0.8574。
- **关键发现**：嵌套 composition 的 `data-start/data-duration` 只控制可见窗口；**子文档内部 GSAP 时间轴按 master 绝对时间驱动，不随 data-start 重锚**（start=1s 时 3.5s 画面≈原 3.5s）。→ v0.3 整篇 → start=0 单 scene clip 迁移零风险；非零 startFrame 的 scene 重排需生成侧时间偏移或等 M0-01 正式机制。
- 迁移门禁建议：SSIM ≥0.999 或字节一致 + 时长/分辨率一致；失败保留 legacy。
- 未验证：mp4 级时长/帧数（归 M0-02，已由 m0-media 补测通过）；多 Scene 拆分/移动。

### 2.7 M0-06 @ 引用（✅ Phase A 真机通过；剩余项待复验）

- 适配层草案 + 离线 smoke 14/14、loader 5/5；spike 插件 `dsh-video-atspike`（独立、无持久化写入、只读路由）已在 `/tmp/v1-m0/spike-staging/bundle` 备好。
- **真实 DSH Phase A 通过（用户截图，2026-10-21）**：原生 Composer 输入 `@` 出现分组「片段 / 场景 / 素材 / 区间」，行内显示名称与时长/轨道；选中「开场镜头」插入 chip（`@ 开场镜头`）。证据：`artifacts/v1/evidence/m0-06-atspike-real-dsh.webp`。
- 剩余待确认：① 发送后文本是否序列化为 `@[kind](dshvideo:...)`；② 插入 chip 后刷新页面草稿是否恢复；③ 插件 Host 路由 fetch（Phase B）；④ 与官方 `@file/@session` 共存/`@"` 行为。
- 风险：`inputTriggers` 为内部 API、无 semver；`appearance` 仅 `session|file|folder`；chip 草稿兼容失败会静默丢草稿；停用插件后含 chip 草稿无法发送（需产品兜底）。

- **发送后模型行为（2026-10-21，补充，用户截图）**：spike 引用指向 fake 项目 `spike-demo`，模型调用 `video_engine` 得到 `E_PROJECT_NOT_FOUND`，随后用宿主原生 `ask_user_question` 卡片追问（长篇解释“你发来了两个引用…项目未注册…合成格式只支持内联 SVG/HTML/CSS…你想让我做什么”）。用户反馈：卡片丑、按钮点不到、看不懂。结论（M5 必须）：① 引用先 `timeline.resolve` 到真实项目/稳定 ID，再决定动作；② system prompt 说明 token 语义；③ 解析失败给**一行 typed 提示 + 重选入口**，不要长篇追问卡片；④ 在嵌入会话中验证 `ask_user_question` 卡片交互（按钮/选项可点），必要时用产品自有简洁确认 UI 替代；⑤ 不把内部实现约束倒给用户。证据：`artifacts/v1/evidence/m0-06-atspike-send-followup.webp`。
- **真实发送发现（2026-10-21，Phase A 补充）**：首次发送后用户消息 bubble 显示 `c-01)` / `a-bgm)`。根因是 spike 用 markdown-link 形态 `@[clip](dshvideo:...)` 作为序列化文本，命中宿主 `@file` userText 规则（`/(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu`），被当作文件路径、label 取最后一段。**产品 M5 约束**：序列化文本不得与宿主 @file 语法冲突（行内代码 token 或注册自定义 `userText` chip 规则）；spike v2 已修正，产品在 M5 候选复验。

### 2.8 M0-07 音频链路（✅）

- 千问云 TTS `qwen-audio-3.1-tts-flash`：12.64s 旁白，非流式总 2.07s（请求 1.68 + 下载 0.39），SSE 1.28s（首字节 400ms）；费用 ≈¥0.002；输出 WAV 24k mono；**SSE 逐字时间戳 56 tokens（160–12320ms）**，两种方式音频字节一致。
- 本地 `say`（Tingting）：13.46s，生成 1.17s + 转 m4a 0.29s，零成本。
- render 混音：`data-start=4` tone onset 4.000042s（误差 0.04ms）；`data-volume=0.25` = −12.0 dB；fade-in/out 生效；旁白 `data-start=2` 从 2.09s 起可闻；视频原声 + 旁白双路混入（audioCount=2）；`audioFailures`=0；输出 AAC 48k stereo，时长精确。
- **音画偏移**：白闪 vs 1kHz onset ≤1 帧（33ms）。
- 响度：E（视频原声+旁白）−16.7 LUFS / TP −1.5 dBFS；loudnorm 单遍只到 −14.79 → **建议两遍或增益分级**；峰值余量薄。
- 风险：长文本需分句/WS；SSE 不返回 usage；BGM（Fun-Music）当前 key 403，v1.0 用上传兜底（不做第二家，已定）。

---

## 3. 对 v1.0 实现的影响（M1–M6）

| 领域 | 结论/要求 |
|---|---|
| 渲染管线 | **B-1 保留**：timeline → 生成 composition → HyperFrames 预览/导出；无需 ffmpeg 时间线渲染器（E2 兜底可留作 M6 风险预案） |
| 生成器契约 | 禁止 `muted` 静音音频；root/子 comp 注册 `window.__timelines`；媒体资产必须声明；嵌套 `data-composition-src` 可用；非零 start 的 scene 需生成侧时间偏移（M3 设计） |
| 预览 | sandbox iframe + 工程级 Range 路由；CSP `media-src 'self'`；音频「muted 自动播放 + 点击开声」；真机 autoplayPolicy 在 alpha.1 候选复核；父页面 WebAudio 兜底 |
| 资产/存储 | stat+流式读取、快照排除媒体、hardlink（EXDEV fallback）、Range/HEAD/416、注册时 hash；1 GiB 现状不可用已证明 |
| 迁移 | 整篇 → start=0 单 scene clip；`.dsh-video/legacy/` 备份；SSIM≥0.999 门禁；非零 startFrame 后续再开 |
| 音频 | Host 侧 provider + 同步下载入库（24h URL）；TTS/时间戳可用；BGM 上传兜底；两遍 loudnorm；A/V 验收 ≤1 帧 |
| @ 引用 | Phase A 真机已通；M5 完成序列化/刷新/Host 路由/共存全量；内部 API 薄适配 + 降级 |
| 发布 | 120s 工程导出约 4–5 分钟（负载下 2.1×实时）→ 发布说明写清；超时公式自适应 |

---

## 4. 未验证清单

- 真实 DSH sandbox iframe 内媒体/音频自动播放与可听性（需 M1 候选真机）。
- @ 引用发送序列化、刷新草稿恢复、Host 路由 Phase B/C、停用插件后 chip 行为；嵌入会话内 `ask_user_question` 卡片按钮可点性（用户反馈疑似不可点，需真机复现）。
- 多 Scene 工程拆分/移动、非零 startFrame scene 的时间偏移方案。
- 2–8 GiB 工程、cold cache、Windows/exFAT/FAT、GPU 加速、并发渲染。
- 千问 Fun-Music（邀测 403）、长旁白分段、内容审核/失败重试的真实表现。
- 120s 以上长片（>300s）导出耗时与超时。

---

## 5. Go/No-Go 记录

- **Go**：进入 M1（存储/工程生命周期）与 M2（素材库/媒体管线），按 PLAN §5 任务卡推进。
- 条件：本报告 §0 的 5 条；M1/M3 实现必须覆盖 §3 的生成器/预览/资产/超时约束。
- 决策记录：建议将本报告结论补入 `docs/DECISIONS.md`（M0 Go/B-1 保留、E2 仅兜底）。
- 用户过目：**待用户确认**；确认后 Lead 创建 `v1-m1-storage` 工作树并下发 M1 任务卡。
