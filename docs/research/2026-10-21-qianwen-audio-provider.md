# 千问云（千问AI平台）音频 API 供应商调研与试点验证

> 信息日期：**2026-10-21**（Asia/Shanghai）。仓库基线：`codex/v1-plan` @ `1aabd6e`（origin/main，2026-10-21）。
> 可信度标注：✅ 官方文档/官方页面实测；◐ 官方文档但未逐条实测；△ 未验证/推断。
> 范围：只做调研、只读探测与最小验证，不改代码；唯一新增文件即本文。所有真实 key 仅从 `~/.dsh/dsh-video/secrets.env`（0600）读取，未写入本文、仓库、命令输出或消息；curl 示例统一用 `$QIANWEN_API_KEY` 占位。
> 上游：v1.0 音频产品方案见 `docs/research/2026-10-21-audio-generation-research.md`；本文交付 M0-07 / M4-05 所需的供应商事实。

## TL;DR（12 行）

1. 千问云 = **千问AI平台**（qianwenai.com，千问官方 MaaS 平台，阿里云实名账号体系）；模型网关 `https://maas.qianwenaiapi.com`，主区域 **cn-beijing**（DNS 指向阿里云北京 NLB，产物落在北京 OSS）。
2. 双协议：OpenAI 兼容 `…/compatible-mode/v1`（对话/模型列表）+ **DashScope 风格原生 API**（音频全部走原生端点，DashScope SDK 可直接换 base URL）。
3. 鉴权 `Authorization: Bearer <API Key>`；通用按量 key（`sk-ws-`）/ Token Plan 专属 key（`sk-sp-`）/ 临时 API Key；key 永久有效、按业务空间隔离、AES-256 存储。
4. 音频能力齐全：TTS（Qwen-Audio-TTS、CosyVoice、Qwen3-TTS、MiniMax）、实时 TTS、**统一 Audiogen**（qwen-audio-3.1-tts-next：人声+音效+环境音+音乐一次生成）、音乐（Fun-Music，**邀测**）、声音复刻/声音设计、ASR（同步+异步文件转写，含词级时间戳）。
5. 合成类接口都是**同步 HTTP**（返回 24h OSS URL），无 task_id；仅文件转写/长任务走 Task API（`/api/v1/tasks/{id}` 轮询）。
6. **逐字时间戳可用且已实测**：非实时 TTS 加 `X-DashScope-SSE: enable` + `word_timestamp_enabled: true`，SSE 的 `sentence-synthesis`/`sentence-end` 事件返回每个字 `begin_time/end_time`（ms）——可直接做字幕/旁白对齐。
7. 中文旁白首选 `qwen-audio-3.1-tts-flash`（token 计费，支持中文方言/多语种、指令控制与情感标签）；低价兜底 `qwen-audio-3.0-tts-flash`（1 元/万字符）。
8. 音效/环境音没有独立 API，走 `qwen-audio-3.1-tts-next`（`text_prompt`，≤3000 字符，单次 120s/播客 240s，支持最多 3 条参考音频）。
9. 音乐 `fun-music-v1` 也只是「邀测」：当前 key 实测 **403 AccessDenied**（未见单价），v1.0 不能把它当唯一 BGM 来源。
10. 实测：模型列表 200（178 个模型）；2 次极短 TTS 200（0.57/0.68s）；流式逐字时间戳 200；ASR 公共样例 200（1.47s，句子+词时间戳）；Audiogen 空参探测 400（端点可达、未计费；开通状态未完全证明）；总花费 < ¥0.01。
11. **价格口径有一处文档冲突**：Audiogen 计费说明写「按生成音频时长」，模型页价目是 token（6/12 元/M）；声音复刻创建「免费」vs 价目表 0.01 元/次——按账单为准，下文标注。
12. 接入建议：Host 侧 `AudioProvider` 适配层（key 只在 Host 内存）+ 异步 job + 产物入 asset 收件箱 → 受管素材 → composition `<audio>` → HyperFrames 原生混音；BGM 需备选（无 Fun-Music 权限时用户上传/本地 `say` 兜底）。

## 1. 平台与鉴权

### 1.1 平台是什么 ✅
- `qianwenai.com` 首页自述「千问官方 MaaS 平台」「企业级 AI 大模型服务平台」；控制台 `platform.qianwenai.com`（文档 `/docs`、API Key `/home/api-keys`、定价 `/pricing/api`、模型市场 `/models`）。
- 模型服务域名为 **`maas.qianwenaiapi.com`**（与 DashScope 同构的 `/api/v1/...` 原生端点）；另有 OpenAI 兼容 `/compatible-mode/v1`、Anthropic 兼容入口。
- 平台聚合自研 Qwen 系列与三方模型（MiniMax、DeepSeek、GLM、Kimi、阶跃等），音频侧含 Qwen-Audio、CosyVoice、Qwen3-TTS、MiniMax Speech。

### 1.2 Base URL 与区域 ✅/◐
| 用途 | URL |
|---|---|
| 原生 HTTP（音频/DashScope 风格） | `https://maas.qianwenaiapi.com/api/v1`（如 `/services/audio/tts/SpeechSynthesizer`） |
| WebSocket（实时 TTS / 实时对话） | `wss://maas.qianwenaiapi.com/api-ws/v1/inference`；Qwen3-TTS-Realtime 为 `…/api-ws/v1/realtime?model=qwen3-tts-flash-realtime` |
| OpenAI 兼容 | `https://maas.qianwenaiapi.com/compatible-mode/v1` |
| 异步任务查询 | `GET https://maas.qianwenaiapi.com/api/v1/tasks/{task_id}` |
- 区域：DNS 显示 `maas.qianwenaiapi.com → nlb-*.cn-beijing.nlb.aliyuncsslb.com`；实测 TTS 产物 URL 为 `dashscope-result-bj.oss-cn-beijing.aliyuncs.com`。→ **中国大陆北京区域**（△ 未见「区域选择」文档，暂视为单区域）。
- SDK：官方示例用 DashScope SDK，只需 `dashscope.base_http_api_url = "https://maas.qianwenaiapi.com/api/v1"`、`base_websocket_api_url = "wss://maas.qianwenaiapi.com/api-ws/v1/inference"`（✅ 文档示例即此写法）。

### 1.3 API Key 类型与作用域 ✅
- 创建：控制台「API Key」页；完整 key 只在创建时显示一次；**永久有效**，除非手动删除。
- 类型：**通用按量付费 key（`sk-ws-` 开头，早期 `sk-`）**、**Token Plan 专属 key（`sk-sp-`，按 Credits 订阅）**、临时 API Key（60 秒级临时鉴权）。实测本任务 key 为通用按量付费类型（只判定前缀，未记录 key 内容）。
- 作用域：key 不绑定单一模型；可按**业务空间**创建 key 并配置模型权限/自定义 RPM/TPM（文档 FAQ 明确「如何限制 API Key 仅用于 CosyVoice → 参见业务空间」）。→ 我们的 provider 只需存一个通用 key，权限收窄交给业务空间策略。
- 安全：平台宣称存储数据（API Key、账户信息）AES-256 加密；建议开发/生产分开 key、定期轮换、不硬编码。

### 1.4 错误码、重试与取消 ◐
- 统一错误体：`{"request_id":"…","code":"…","message":"…"}`；**保留 request_id 便于工单排查**。
- 关键错误码（官方错误信息页 + 音频 API 页有交叉）：`400 InvalidParameter / CLIENT_ERROR`（参数/长度/引用编号）、`400 DataInspectionFailed|data_inspection_failed`（内容审核）、`401 InvalidApiKey/invalid_api_key`、`403 AccessDenied`（含模型未开通/未购买）、`404 ModelNotFound|Model not exist.`、`429 Throttling.RateQuota / AllocationQuota / BurstRate / Concurrency / ServiceOverloaded`、`500 InternalError / ServiceUnavailable`。
- 重试：429 用指数退避；5xx 可重试；4xx 参数/审核错误**不要自动重试**。计费页明确「**调用失败不产生任何费用**」→ 参数错误与审核拦截重试无成本，但 5xx 若已生成产物仍有费用风险，重试需防重复计费（本次未验证服务端幂等）。
- 取消：**同步 HTTP TTS/音乐无取消语义**（只能客户端 Abort 断开）；实时 WebSocket 支持 `finish-task` + `directive=cancel`（Qwen-Audio-TTS 全系；CosyVoice v2+）。异步 Task API 仅 `PENDING` 状态可取消。

### 1.5 限流/并发 ◐
- 账户级 **RPM/TPM** 限制（所有业务空间、所有 key 共享），且按秒生效（RPS = RPM/60），突发流量可能触发保护；429 报错文案可区分 RPM/TPM/突增。
- 模型详情页显示的 RPM：TTS 系（qwen-audio-3.0/3.1、qwen3-tts、cosyvoice）**180 RPM**；ASR 系（qwen-audio-3.x-asr、fun-asr）**600 RPM**；`qwen-audio-3.1-realtime-plus` **60 RPM**。TPM 未在模型页展示（△ 音频模型 TPM 未知）。
- 临时提额仅列出文本类模型，**音频模型不在提额名单**（◐ 以工作台展示为准）。WebSocket 建议连接池复用，空闲 60s 自动断开，对象池 ≤ 账户 QPS。

## 2. 音频能力矩阵

### 2.1 TTS / 语音合成 ✅（文档 2026-10-21 可访问；发布日期见备注）
| 模型 | 系列/形态 | 流式 | 自定义音色 | 指令控制 | 中文音色 | 备注/发布日期 |
|---|---|---|---|---|---|---|
| `qwen-audio-3.0-tts-flash` | Qwen-Audio-TTS | ✓ | ✓（复刻） | ✓ | 系统音色 + 500+ 基础复刻音色 | 主力低成本；changelog 2026-07-14 上线 |
| `qwen-audio-3.0-tts-plus` | Qwen-Audio-TTS | ✓ | ✓ | ✓ | 精品中文 2 个 | changelog 2026-07-14 |
| `qwen-audio-3.1-tts-flash` | Qwen-Audio-TTS | ✓ | ✓ | ✓（free-style） | 4 个多语种/方言音色 + 20+ 普通话 + 20+ 角色/童声 + 15 英文 | 新一代，token 计费；发布日未见 changelog 单列（△） |
| `qwen-audio-3.1-tts-next` | **Audiogen（统一音频生成）** | ✓ | ✗（仅参考音频） | ✗ | 无系统音色，靠 prompt/reference | 音效/环境音/播客；见 §2.3 |
| `qwen3-tts-flash` | Qwen3-TTS | ✓ | — | — | 40+ 系统音色（Cherry/Ethan/Nofish…），10 语种 | 0.8 元/万字符，文本 ≤600 字符；发布日未知 |
| `qwen3-tts-flash-realtime` | Qwen3-TTS Realtime | ✓ | — | — | 17 个拟人音色 | `…/api-ws/v1/realtime`；1 元/万字符 |
| `cosyvoice-v3.5-plus/flash`、`v3-plus/flash`、`v2` | CosyVoice | ✓ | ✓ | ✓（方言/情感） | 音色库丰富（含方言音色、500+ 复刻） | v3.5 侧重复刻/设计质量 |
| `MiniMax/speech-2.8-hd|02-hd|2.8-turbo|02-turbo` | 三方 MiniMax | ✓ | ✓（另收费） | 情感/语速/音调 | 3.5/2 元/万字符；复刻解锁 9.9 元/次 |
- 语种：`language_hints` 支持 zh/en/fr/de/ja/ko/ru/pt/th/id/vi/es/it/ms/fil/ar 等；Qwen-Audio-TTS v3.1 支持上海/广东/东北/重庆/陕西/云南/宁波/甘肃等方言音色；复刻样本支持 21 种中文方言。
- 参数：`rate` 0.5–2.0、`pitch` 0.5–2.0、`volume` 0–100、`format` mp3/pcm/wav/opus、`sample_rate` 8000–48000（默认 22050，opus 受限）、`bit_rate` 6–510（opus）、`seed`、`hot_fix`（发音/替换）、`instruction`（方言/情感/角色）。
- 文本上限：Qwen3-TTS **600 字符**（千问-TTS 512 Token）；非实时 Qwen-Audio-TTS/CosyVoice 的 HTTP 单次文本上限**文档未给**（△）；WebSocket `continue-task` 单次 ≤20000 字符、累计 ≤200000 字符。长旁白建议分句调用或走 WS。
- 情感/富语言标签（`[sad]`/`[excited]`/`[laughing]`/`[sighing]` 等，Qwen-Audio-TTS 3.0+/3.1）仅支持**单向流式**（△ 文档注明「限制：仅支持单向流式模式」）。
- SSML/LaTeX：支持模型为 qwen-audio-3.1-tts-flash、qwen-audio-3.0-tts-flash/plus、cosyvoice-v3.5/v3/v2；需 `enable_ssml: true`，SSML 标签不计费字符。

### 2.2 音乐生成 ✅（邀测）
- 模型：`fun-music-v1`（支持 prompt / lyrics 二选一、`gender` 男/女声、`is_instrumental=true` 纯音乐）、`fun-music-preview`（必须 prompt、无 gender）。
- 输入：`prompt` 描述风格/场景/乐器（非流式 1–2000 字符；流式 5–1000 汉字/英文词）；`lyrics` 自定义歌词（中文 5–350 字、英文 5–2000 词；支持 `[intro]/[verse]/[chorus]/[bridge]/[outro]` 结构标签；仅支持中文或英文）。
- 输出：MP3（默认）/WAV；示例响应 `extra_info.channels=2`、`sample_rate=48000`（立体声 48kHz）；`usage.duration` 秒数用于计费展示。
- 计费：**模型价格表未列 Fun-Music 单价**（△）；接口 `200` 示例 `usage.duration=200`。当前 key 实测 `403 AccessDenied`（未开通邀测），详见 §5。
- 单次时长上限：**文档未明确**（△）；示例 200s，需申请开通后到模型详情页确认。
- 合规：歌词原创、禁政治/暴力/色情等；`enable_aigc_watermark=true` 会在音频末尾追加摩尔斯「·— ··」AI 标识。

### 2.3 音效 / 环境音 / 统一 Audiogen ✅
- 没有独立「SFX API」；官方方案是 **`qwen-audio-3.1-tts-next`（Audiogen）**：一次调用生成人声 + 音效 + 环境音 + 背景音乐。
- `input.text_prompt`（≤3000 字符）用自然语言描述场景，例如「雨中告白广播剧…背景声：倾盆雨声、偶尔的雷鸣」；`input.references` 最多 3 条参考音频（每条 ≤30s、≤10MB、WAV/MP3/OGG Opus，不支持裸 PCM），prompt 里用 `@voice1`…`@voice3` 引用。
- 输出：`wav`（默认）/`mp3`/`pcm`，采样率 8000/16000/24000/44100/48000，`channels` 1/2，`enable_cbr`/`bit_rate`/`quality`/`volume`/`rate`/`seed`/`enable_aigc_tag`。
- 单次时长上限：播客 240s、其他场景 120s；模型页自述支持「文本、**时间戳**、参考音频」输入与「灵活的时间控制」，但 API 参考未给时间戳字段（△ 时间戳输入语法未验证）。
- 计费口径冲突：用户指南「按生成音频原始时长计费」，API 页 `usage.duration` 只作展示，模型页价目为 token（输入 6 元/M、输出 12 元/M）→ △ 以账单为准，接入前按 token 与按时长两种口径都做预算上限。

### 2.4 音频理解 / 转写（可选，可做字幕对齐）✅
- 同步 ASR：`qwen-audio-3.1-asr-flash`（URL 或 Base64，Base64 上限 10MB）、`qwen-audio-3.0-asr-flash`、`fun-asr`（支持歌曲识别）。
- 异步文件转写：Paraformer / qwen-audio-3.x-asr-flash-filetrans，单文件 ≤12 小时、≤2GB，格式 aac/amr/avi/flac/flv/m4a/mkv/mov/mp3/mp4/mpeg/ogg/opus/wav/webm/wma/wmv；开启说话人分离建议 ≤2 小时。
- 时间戳：同步返回 `output.sentence.words[]`（`begin_time/end_time` ms）；异步返回 `results[].transcription_url`，其中 `transcripts[].sentences[].words[]` 含词级时间戳；另有 `timestamp_alignment_enabled`（Paraformer）。
- 计费：qwen-audio-3.1-asr-flash 0.8/2.7 元/M tokens；3.0-asr/fun-asr 0.00022 元/秒；paraformer-v2 0.00008 元/秒；实时 0.00033 元/秒。仅对判定为语音内容的时长计费（Paraformer）。

### 2.5 声音复刻 / 声音设计 ✅（v1.0 不做，v1.1+）
- 同一接口 `POST /api/v1/services/audio/tts/customization`，`model=voice-enrollment`，`action=create_voice|list_voice|query_voice|delete_voice`。
- 复刻：`target_model` 必须与合成模型一致（不能跨模型）；样本推荐 10–20s、最长 60s、≤10MB、≥16kHz，需连续清晰朗读、无 BGM/他人声；平台不支持模仿特定人物（文档明确要求描述声音特质而非模仿名人）。
- 设计：`voice_prompt`（≤500 字符，中英）+ `preview_text`（15–200 字符），无需样本；创建后返回 `voice_id` 与预览音频。
- 配额：每账号自定义音色上限 **1000 个**（复刻+设计共用）；MiniMax 音色不受限。
- 计费冲突：价目表 `qwen-voice-enrollment` 0.01 元/次，官方指南写「创建音色免费」→ △ 未实测、以账单为准。

## 3. API 规格

### 3.1 非实时 TTS（Qwen-Audio-TTS / CosyVoice）✅
```bash
# 非流式（返回 24h OSS URL）
curl -X POST "https://maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer" \
  -H "Authorization: Bearer $QIANWEN_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen-audio-3.1-tts-flash","input":{"text":"你好，千问。","voice":"longanhuan_v3.1","format":"wav","sample_rate":24000}}'

# 流式 + 逐字时间戳（字幕对齐）
curl -N -X POST "https://maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer" \
  -H "Authorization: Bearer $QIANWEN_API_KEY" -H "Content-Type: application/json" \
  -H "X-DashScope-SSE: enable" \
  -d '{"model":"qwen-audio-3.0-tts-flash","input":{"text":"第一句话。","voice":"longanhuan_v3.6","format":"wav","sample_rate":24000,"word_timestamp_enabled":true}}'
```
- 非流式响应：`{request_id, output:{finish_reason:"stop", audio:{data:"",url,id,expires_at}}, usage:{characters | input_tokens/output_tokens/total_tokens}}`；URL 有效期 24h，需及时下载。
- SSE 帧格式：`id:N\nevent:result\n:HTTP_STATUS/200\ndata:{JSON}`（JSON 可跨多行 `data:`）；事件类型 `sentence-begin` → 多个 `sentence-synthesis`（`audio.data` 为**裸 base64 音频块**，无 `data:` 前缀）→ `sentence-end`（带 `usage`）→ 最终 `finish_reason:"stop"`。客户端需按顺序拼接音频块。
- 逐字时间戳字段：`output.sentence.words[]{text,begin_index,end_index,begin_time,end_time}`（ms）；实测在 `sentence-synthesis`/`sentence-end` 中返回。
- 端点不可混用：Qwen-Audio-TTS/CosyVoice 走 `SpeechSynthesizer`；Qwen3-TTS/MiniMax 走 `/services/aigc/multimodal-generation/generation`（体为 `{model, input:{text, voice, language_type?, instructions?}}`，Qwen3-TTS 响应同样含 `output.audio.url`）。

### 3.2 音频生成（Audiogen）✅
```bash
curl -X POST "https://maas.qianwenaiapi.com/api/v1/services/audio/tts/SpeechSynthesizer" \
  -H "Authorization: Bearer $QIANWEN_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen-audio-3.1-tts-next","input":{"text_prompt":"深夜咖啡馆，窗外细雨。旁白（温柔女声）：\"雨下得不大。\"","format":"wav","sample_rate":48000,"channels":2}}'
```
- 响应：`output.audio.url/id/expires_at/duration`、`usage.duration`（秒，四舍五入）。
- 无 `voice` 字段；参考音频走 `references[].audio_url` 或 `audio_data`（data URI，二者互斥）。

### 3.3 音乐（Fun-Music，邀测）✅
```bash
curl -X POST "https://maas.qianwenaiapi.com/api/v1/services/audio/music/generation" \
  -H "Authorization: Bearer $QIANWEN_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"fun-music-v1","input":{"prompt":"夏日清新民谣，木吉他与口琴，轻快","is_instrumental":true,"format":"mp3"}}'
```
- 响应：`output.audio{url,id,expires_at}`、`output.extra_info{channels,sample_rate,lyrics}`、`usage.duration`。流式同样 `X-DashScope-SSE: enable`。

### 3.4 语音识别（同步 / 异步）✅
```bash
# 同步：短音频（URL 或 data:audio/wav;base64,...）
curl -X POST "https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation" \
  -H "Authorization: Bearer $QIANWEN_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"qwen-audio-3.1-asr-flash","input":{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"https://example.com/a.wav"}}]}]},"parameters":{"format":"wav","sample_rate":"16000","speaker_diarization_enabled":false}}'
```
- 同步返回 `output.sentence{begin_time,end_time,text,words[]}`（开启说话人分离时返回 `output.sentences` 与 `speaker_id`）。
- 异步文件转写：`POST /api/v1/services/audio/asr/transcription` + `X-DashScope-Async: enable` → `output.task_id` → `GET /api/v1/tasks/{task_id}` → `results[].transcription_url` 再下载 JSON。

### 3.5 实时 TTS / 同步 vs 异步约束 ◐
- Qwen-Audio-TTS/CosyVoice：WS `run-task`（model/voice/format/sample_rate/word_timestamp_enabled…）→ 多个 `continue-task`（`payload.text`）→ `finish-task`；音频走 binary 通道；同一任务 `task_id` 必须一致；支持 cancel；连接复用、60s 空闲断开。
- Qwen3-TTS-Realtime：`wss://maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime`（session.* 事件，OpenAI Realtime 风格）。
- 超时：服务端 HTTP 超时未文档化；官方音频生成示例用 `--max-time 300`（△）。计费页称合成首包约 500ms、RTF < 1（FAQ），实测 6–10 字调用 0.57–0.68s。
- 输出格式：TTS mp3/pcm/wav/opus（默认 mp3，默认 22050Hz）；音乐 mp3/wav；Audiogen wav/mp3/pcm（默认 wav 48k 双声道）。TTS 输出为单声道（实测 24k mono 16-bit PCM WAV）。

## 4. 计价 / 限额 / 合规

### 4.1 计价 ✅（官方价格页 2026-10-21；单位人民币）
| 模型 | 计费维度 | 单价 |
|---|---|---|
| qwen-audio-3.0-tts-flash | 输入文本 | 1 元/万字符 |
| qwen-audio-3.0-tts-plus | 输入文本 | 1.4 元/万字符 |
| qwen-audio-3.1-tts-flash | 输入 + 输出 token | 1.5 / 12 元/M tokens |
| qwen-audio-3.1-tts-next（Audiogen） | 输入 + 输出 token（指南称按时长，△） | 6 / 12 元/M tokens |
| qwen3-tts-flash | 输入文本 | 0.8 元/万字符 |
| qwen3-tts-flash-realtime | 输入文本 | 1 元/万字符 |
| cosyvoice-v3.5-flash / v3.5-plus | 输入文本 | 0.8 / 1.5 元/万字符 |
| cosyvoice-v3-flash / v3-plus / v2 | 输入文本 | 1 / 2 / 2 元/万字符 |
| MiniMax speech-2.8-hd / 02-hd / turbo | 输入文本 | 3.5 / 3.5 / 2 元/万字符 |
| qwen-voice-enrollment（复刻/设计） | 次 | 0.01 元/次（指南称免费 △） |
| qwen-audio-3.1-asr-flash | 输入 + 输出 token | 0.8 / 2.7 元/M tokens |
| qwen-audio-3.0-asr-flash / fun-asr | 音频秒数 | 0.00022 元/秒 |
| paraformer-v2 | 音频秒数 | 0.00008 元/秒 |
| paraformer-realtime-v2 / fun-asr-realtime | 音频秒数 | 0.00024 / 0.00033 元/秒 |
| qwen-audio-3.1-realtime-plus（语音对话） | 音频入/文本入/文本出/音频出 | 40 / 5 / 40 / 150 元/M tokens |
- 字符计费规则：**汉字（含简繁/日文/韩文汉字）算 2 字符，其余算 1**；SSML 标签不计；实测 `"你好，千问。"` 计 10 字符、`"第一句话。第二句话。"` 计 18 字符（✅ 与规则一致）。
- 失败调用不收费、不消耗免费额度；AIGC 水印、参考音频不额外收费（未见条款）。

### 4.2 免费额度 ◐
- 新用户/新模型有独立免费额度（通常 100 万 Token/模型，有效期 90 天，按账号或模型发布日起算）；**语音模型是否在免费额度范围以「权益」页为准**（△ 本 key 未登录控制台核对）。
- 已认证用户额度耗尽后自动按量计费；未认证用户报 `AllocationQuota.FreeTierOnly`。Token Plan 专属 key 不消耗免费额度。

### 4.3 合规、隐私与商用 ✅/◐
- **内容审核**：所有请求自动审核输入/输出；TTS 审核输入文本与合成音频，ASR 审核输入音频与转写文本；命中返回 `400 data_inspection_failed`（勿把原始英文错误直接展示给终端用户）。
- **AIGC 标识**：TTS 支持 `enable_aigc_tag`（在 wav/mp3/opus 嵌入隐性标识，含 `ContentPropagator`/`PropagateID`）；音乐 `enable_aigc_watermark` 追加摩尔斯 AI 音频；平台公示算法备案（如「达摩院交互式多能型合成算法 网信算备330110507206401230035号」）与大模型备案（通义千问 `ZheJiang-TongYiQianWen-20230901`）。用户协议要求对非真实信息「以显著方式标识」——**产品侧需提供显式「AI 生成」标注选项**，不能只依赖隐性水印。
- **数据与隐私**：数据存储于中国境内；输入内容经去标识化后可能被抽样用于产品分析/模型评测/功能优化（隐私政策提供退出联系方式）；产品服务协议写明「不会在未获您明确授权的情况下使用您的对话数据训练我们的模型」；服务终止/欠费后仅在缓冲期内保留业务数据，届满删除；API Key 静态 AES-256。
- **商用**：用户对自己上传内容拥有合法知识产权时，合成内容知识产权归用户；不得转售服务/模型，不得用输出训练竞争模型；侵权风险由用户承担。声音复刻要求样本授权、不支持模仿名人。
- 音乐歌词仅中/英，禁止政治/暴力/色情/低俗/恐怖/毒品内容。

## 5. Key 验证结果（实测，2026-10-21 14:15–14:35 CST）

| # | 探测 | 结果 | 证据摘要（不含 key） |
|---|---|---|---|
| 1 | `GET /compatible-mode/v1/models` | ✅ 200 | 返回 178 个模型；key 有效；key 类型=通用按量（仅判前缀） |
| 2 | TTS `qwen-audio-3.0-tts-flash`，文本「你好，千问。」 | ✅ 200 / 0.57s | `finish_reason=stop`、`usage.characters=10`、URL 24h；下载后 `ffprobe`：wav / pcm_s16le / 24000Hz / mono / 0.96s |
| 3 | 流式 + `word_timestamp_enabled=true`，文本「第一句话。第二句话。」 | ✅ 200 / text/event-stream | 事件 `sentence-begin`→`sentence-synthesis`×4→`sentence-end`；`words[]` 每字 `begin_time/end_time`（80/320…1760ms）；拼块后 wav 有效 1.76s |
| 4 | TTS `qwen-audio-3.1-tts-flash`（非流式 6 字 / 流式 10 字） | ✅ 200 / 0.68s、0.61s | 非流式 `usage={input_tokens:6,output_tokens:14,total_tokens:20,characters:10}`；流式 `{10,25,35,18}`；逐字时间戳同样可用 |
| 5 | ASR `qwen-audio-3.1-asr-flash`（官方公开样例 wav） | ✅ 200 / 1.47s | 转写正确；返回句子 `begin_time=280,end_time=3280` + 逐词时间戳 |
| 6 | Audiogen 空参探测 `qwen-audio-3.1-tts-next` | ✅ 400（端点可达） | `InvalidParameter: text_prompt must not be empty.`；参数校验层通过、失败不计费；是否已开通未完全证明，**未做真实生成**（成本口径不明） |
| 7 | 音乐空参探测 `fun-music-v1` | ⛔ 403 | `{"code":"AccessDenied"}` → 该 key 未开通 Fun-Music 邀测；**音乐未验证** |
| 8 | 实时 TTS WebSocket / 声音复刻 / 免费额度 | △ 未验证 | 需 WS 客户端、创建音色（计费/配额冲突）、控制台权益页；按「控制成本」原则跳过 |
- 费用：仅 #2–#4 产生计费，按官方单价估算 **< ¥0.01**；未转存任何生成音频到仓库（仅 /tmp 用于 ffprobe 校验后未纳入交付）。
- 安全：全程 `set -a; source …secrets.env; set +a` 后以 `$QIANWEN_API_KEY` 引用；未 echo key、未写 key、未读宿主凭据文件。

## 6. 适配层设计与接入建议

### 6.1 `AudioProvider` 接口草案（TypeScript 语义，供 M4-04 实现）
```ts
export type AudioCapability = 'tts' | 'music' | 'sfx' | 'voiceDesign' | 'asr';

export interface AudioProviderInfo {
  id: 'qianwen'; label: '千问云'; region: 'cn-beijing';
  baseUrl: string; capabilities: AudioCapability[];
}
export interface AudioVoice {
  id: string; label: string; gender?: 'female' | 'male'; languages: string[]; dialects?: string[];
  supports: { ssml?: boolean; instruction?: boolean; timestamps?: boolean };
}
export interface AudioJobRequest {
  projectId: string; capability: AudioCapability;
  model?: string;                       // 默认按能力映射，可被设置页覆盖
  text?: string; prompt?: string; lyrics?: string;
  voiceId?: string; instruction?: string;
  languageHints?: string[]; instrumental?: boolean;
  format?: 'wav' | 'mp3' | 'pcm' | 'opus'; sampleRate?: number;
  rate?: number; volume?: number; wantWordTimestamps?: boolean; aigcTag?: boolean;
  references?: Array<{ url: string } | { dataUri: string }>;
  budget?: { maxEstimatedCny?: number };
}
export interface WordTiming { text: string; beginMs: number; endMs: number }
export interface AudioUsage { characters?: number; inputTokens?: number; outputTokens?: number; durationSec?: number }
export interface AudioProvider {
  info(): AudioProviderInfo;
  checkKey(): Promise<{ ok: boolean; keyType?: 'general' | 'token-plan'; error?: AudioProviderError }>;
  listVoices(): Promise<AudioVoice[]>;                 // 文档静态目录 + customization list_voice
  estimate(req: AudioJobRequest): { cny: number; basis: 'characters' | 'tokens' | 'seconds'; detail: string };
  submit(req: AudioJobRequest, ctx: { signal: AbortSignal; timeoutMs: number }): Promise<{ providerJobId: string }>;
  poll(providerJobId: string, ctx: { signal: AbortSignal }): Promise<{ state: 'running' | 'succeeded' | 'failed' | 'cancelled'; progress?: number; error?: AudioProviderError }>;
  cancel(providerJobId: string): Promise<void>;
  fetchResult(providerJobId: string, ctx: { signal: AbortSignal }): Promise<{ bytes: Uint8Array; mime: string; usage: AudioUsage; words?: WordTiming[] }>;
  mapError(error: unknown): AudioProviderError;
}
```
- 千问合成接口是同步的，`submit()` 内部即发起 HTTP（AbortController 超时），把返回的 24h URL + usage 挂在内存 job 上；`poll()` 只是状态查询；`fetchResult()` 下载 URL 后**立刻**写入 asset 收件箱（>24h 链接失效，需重生成）。
- BGM `music`、SFX `sfx`、voiceDesign 用同一接口族，只是 `capability` 决定端点/模型/参数字段（见 §3）；能力发现以静态 capability 表 + `checkKey()` 探测为准，**不要用 OpenAI `/models` 列表推断音频能力**（该列表不含多数 TTS 模型）。

### 6.2 job 状态机与素材入库流程（建议）
- 状态：`queued → running → downloading → succeeded | failed | cancelled`；`failed` 保留 `providerCode/requestId/retryable`；下载失败但已计费时标记 `uncertain`（避免静默重复生成）。
- 归属：**音频生成 job 放 Host 进程**（key 只在 Host 内存；worker env 白名单已禁 `DSH_*` 且不应传 key；Host 已有 job 表、路由、脱敏日志与 `assetInboxRoot`），worker 只做 `asset.import` / ffprobe / 时长探测 / 混音相关操作。
- 流程：Host provider 调用 → 下载 bytes 到 `assetInboxRoot`（唯一文件名，0600 目录）→ 现有 asset 收件箱/import 流程登记为受管素材（音频需扩展类型嗅探与体积上限）→ `project.asset` 引用 → 用户/AI 上音轨（composition `<audio>`）→ 失败不写工程。
- 超时/取消：HTTP 超时建议 180–300s（音乐/Audiogen 更长）；取消 = AbortController + 丢弃内存结果；不自动重试写操作（本仓库 DEVELOPMENT 规则），仅网络错误/429/5xx 且未产生产物时允许一次显式重试。
- 重试与幂等：TTS 每次调用都可能计费，重试前展示「将再次产生费用」；失败调用官方不收费（可安全重试 4xx 修参后）。

### 6.3 错误映射（provider code → 本仓库 `E_*`）
| 千问返回 | 映射 | 处理 |
|---|---|---|
| 401 `InvalidApiKey` | `E_AUDIO_AUTH` | 设置页提示重新配置 key，不自动重试 |
| 403 `AccessDenied`（含未开通 Fun-Music） | `E_AUDIO_ENTITLEMENT` | 提示「模型/邀测未开通」，引导申请或换 provider |
| 400 `InvalidParameter`/`CLIENT_ERROR` | `E_AUDIO_PARAMS` | 修参数/长度；不重试 |
| 400 `DataInspectionFailed` | `E_AUDIO_CONTENT` | 提示修改文案，不展示原始英文错误 |
| 404 `Model not exist.` | `E_AUDIO_MODEL` | 模型名/权限问题 |
| 429 `Throttling.*` | `E_AUDIO_RATE_LIMIT`（retryable） | 指数退避 + UI 重试按钮 |
| 500/503 `InternalError`/`ServiceUnavailable` | `E_AUDIO_PROVIDER`（retryable，可能 uncertain） | 保留 request_id，最多 1 次显式重试 |
| AbortError / 超时 | `E_AUDIO_TIMEOUT` / `E_AUDIO_CANCELLED` | 区分用户取消与超时 |
| URL 过期（下载 403/404） | `E_AUDIO_ARTIFACT_EXPIRED` | 重生成（需用户确认费用） |
| 预算护栏命中 | `E_AUDIO_BUDGET` | 二次确认，不发起调用 |

### 6.4 设置页字段（建议）
- 供应商：千问云开关 / 状态（未配置、已配置、连通失败）/ 「测试连接」（`GET /compatible-mode/v1/models`）/ 清除 key。
- Key：密码框输入；保存到本机 0600 文件（现有 `~/.dsh/dsh-video/secrets.env` 模式）或 DSH 插件设置；UI 只显示掩码与「已配置」；说明「key 不进入模型上下文/日志」。
- 默认模型：TTS `qwen-audio-3.1-tts-flash`（可选 3.0-flash / qwen3-tts-flash / cosyvoice-v3.5-flash）；音乐 `fun-music-v1`（标「邀测/未开通时禁用」）；音效 `qwen-audio-3.1-tts-next`；字幕 ASR `qwen-audio-3.1-asr-flash`。
- 默认音色（中文旁白）：`longanhuan_v3.1`（女，稳重）/ `xunanchuan_v3.1`（男）/ `longanlingxin_v3.1`；语速 0.5–2.0、音量、指令文本框。
- 输出：wav 24000（编辑母带）/ mp3 48000（省体积）；旁白默认单声道。
- 合规：AIGC 隐性标识默认开启；显式「AI 生成」标注选项；内容审核提示与用户协议/隐私政策链接。
- 预算：单次/每日上限（元），超限二次确认；显示本次 `usage` 与估算费用。

### 6.5 推荐调用方式
- **中文旁白**：`qwen-audio-3.1-tts-flash` + `format=wav`/`sample_rate=24000`，非流式取 URL；需要字幕时加 SSE + `word_timestamp_enabled=true`，从 `sentence-synthesis/end` 的 `words[]` 生成字级时间戳（可再聚合成句子级）。长文本按句/段切分顺序请求后拼接（**已实测**：同一请求的 base64 音频块按顺序拼接得到的 WAV 可被 ffprobe 正常解析）；单段建议 ≤1000–2000 汉字并留重试。
- **低成本兜底**：`qwen-audio-3.0-tts-flash`（1 元/万字符，500+ 基础音色）；`qwen3-tts-flash` 最低 0.8 元/万字符但文本 ≤600 字符、音色较少。
- **BGM**：`fun-music-v1` + `is_instrumental=true`（纯音乐）+ 具体 prompt（风格/乐器/节奏/情绪）+ `format=mp3`；**当前 key 403，v1.0 必须准备用户上传/本地 `say` 或第二家 provider 兜底**，并先申请邀测。
- **SFX/环境音**：`qwen-audio-3.1-tts-next`，一句场景描述（含「背景声：雨声/海浪/脚步」等），单次 ≤120s；需要人声时直接在 prompt 写台词与说话人描述；一次生成即带完整声景，适合片头/转场。
- **字幕/对齐**：`qwen-audio-3.1-asr-flash` 同步（短音频）或 filetrans（长音频）拿词级时间戳；与 TTS 返回的 `words[]` 互为校验。BPM/节拍分析无音频 API，用 HyperFrames `audio`/`beats` 或本地 librosa。
- **声音设计/复刻**：v1.0 不做（方案已定）；v1.1 再评估 1000 音色配额、`target_model` 绑定与计费冲突。

### 6.6 与 HyperFrames 音频链路衔接
- 产物是**资产文件**：生成音频先落受管素材（asset），再进入 composition：`<audio src="…已声明资产路径…" data-start data-duration data-media-start data-volume data-fade-in data-fade-out>`；HyperFrames 0.8.167 渲染时自动截取/混音为 AAC 192k 并输出 `audioFailures` 诊断（详见 `2026-10-21-audio-generation-research.md` §4.6）。
- 插件侧当前限制（需 M4 放开）：`packages/video-engine-worker/src/composition.mjs` 的 `FORBIDDEN_TAGS` 含 `audio/video/source/track`；`registry.mjs#imageSignature` 仅 PNG/JPEG、`MAX_ASSET_BYTES=8MiB`；预览路由无 Range/媒体 MIME。
- 建议：生成产物统一 wav 24k 单声道母带（旁白）或 mp3 48k（BGM），导入时 ffprobe 记录时长/采样率/声道；渲染前用 `-14 LUFS / TP -1.5 dBTP` 归一；导出校验增加 `a:0`（aac/48kHz/时长≈composition）与 `audioFailures` 透传。

### 6.7 成本预估（按实测 token 比例外推，△ 未逐项长测）
- 30s 中文旁白（约 100 汉字）：qwen-audio-3.1-tts-flash ≈ 输出 425 token×12/M + 输入 100 token×1.5/M ≈ **¥0.005**；qwen-audio-3.0-tts-flash ≈ 200 计费字符×1 元/万 ≈ **¥0.02**。
- 60s 旁白（约 200 汉字）：3.1-flash ≈ **¥0.011**；3.0-flash ≈ **¥0.04**。
- 5s 音效（Audiogen）：按 token 口径约 **¥0.001**；按时长口径未知（△）→ 接入前设 `maxEstimatedCny` 护栏。
- 音乐：单价未知（邀测）→ 开通后按模型详情页补价。
- 字幕 ASR：60s ≈ 0.0132 元（0.00022 元/秒）或按 3.1 token 计（极低）。

## 7. 风险与未验证项

| 风险/未验证 | 影响 | 处理建议 |
|---|---|---|
| Fun-Music 邀测未开通（实测 403） | BGM 生成不可用 | v1.0 引第二 provider 或用户上传/本地兜底；先申请开通并补价 |
| Audiogen 计费口径冲突（token vs 时长） | 预算不可控 | 以账单校准；设单次预算上限；先用小请求验证 usage 字段 |
| 非实时 TTS HTTP 文本上限未文档化 | 长旁白可能 400 | 分句调用（≤1000–2000 字）或走 WS（20k/200k 字符）；失败不收费可重试 |
| 声音复刻「免费 vs 0.01 元/次」冲突 | 计费不准 | 先不启用（v1.0 不做克隆）；v1.1 实测一次确认 |
| 音频模型 TPM/并发细节未公开 | 高并发被 429 | RPM 180 按 TTS 规划并发 ≤2–3；429 退避；连接池复用 |
| 生成结果 URL 24h 过期；无 server-side task 持久化 | 任务中断丢结果 | 生成后立即下载入受管素材；job 记录 provider request_id |
| 内容审核拦截/敏感词 | 生成失败 | 透传 `E_AUDIO_CONTENT`；不绕过审核；UI 引导改文案 |
| AIGC 标识合规（显式+隐性） | 国内发布合规 | 默认隐性水印 + 产品侧显式「AI 生成」标注开关 |
| 数据用于模型优化（隐私政策抽样条款） | 用户文案外发顾虑 | 设置页知情提示/条款链接；企业感场景提示可联系退出 |
| key 泄露/越权 | 额度损失 | key 只在 Host 内存；日志脱敏；业务空间可限制模型；0600 存储 |
| 单区域北京、无 SLA 承诺（免费/公测期条款） | 可用性 | 超时/重试/降级 + 本地 `say` 保底 |
| 未验证：实时 WS、声音设计、音乐质量/时长上限、免费额度、账单单价、TPM | — | M0-07 可补一次 WS + 音乐（开通后）；真实费用以账单为准 |

## 8. 来源（均为 2026-10-21 访问；官方域名 platform.qianwenai.com）

- 平台首页/模型市场：https://www.qianwenai.com/ ；https://www.qianwenai.com/models
- 语音合成模型选型：https://platform.qianwenai.com/docs/developer-guides/speech/tts-models
- 非实时语音合成指南：https://platform.qianwenai.com/docs/developer-guides/speech/tts
- 实时语音合成指南（WS/连接/取消/限流）：https://platform.qianwenai.com/docs/developer-guides/speech/realtime-streaming
- 音频生成（Audiogen）指南：https://platform.qianwenai.com/docs/developer-guides/speech/audio-generation
- 音频生成 API 参考：https://platform.qianwenai.com/docs/api-reference/audio-generation
- 音乐生成指南：https://platform.qianwenai.com/docs/developer-guides/speech/music-generation
- 音乐生成 API（Fun-Music）：https://platform.qianwenai.com/docs/api-reference/music-generation/fun-music
- 声音复刻指南：https://platform.qianwenai.com/docs/developer-guides/speech/voice-cloning
- 声音设计指南：https://platform.qianwenai.com/docs/developer-guides/speech/voice-design
- 声音复刻 HTTP API：https://platform.qianwenai.com/docs/api-reference/speech-synthesis/voice-cloning/http-api
- SSML 与 LaTeX（使用限制）：https://platform.qianwenai.com/docs/developer-guides/speech/ssml
- Qwen-Audio-TTS HTTP API：https://platform.qianwenai.com/docs/api-reference/speech-synthesis/qwen-audio-tts/http-api
- Qwen-Audio-TTS WS 接入：https://platform.qianwenai.com/docs/api-reference/speech-synthesis/qwen-audio-tts/websocket-api
- Qwen-Audio-TTS 客户端事件（文本上限/参数）：https://platform.qianwenai.com/docs/api-reference/speech-synthesis/qwen-audio-tts/client-events
- Qwen3-TTS API：https://platform.qianwenai.com/docs/api-reference/speech-synthesis/qwen-tts
- 音色列表 Qwen-Audio-TTS：https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts
- 音色列表 Qwen3-TTS：https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-tts
- ASR 指南（音频规格/12h/2GB）：https://platform.qianwenai.com/docs/developer-guides/speech/asr
- ASR 同步 HTTP API：https://platform.qianwenai.com/docs/api-reference/speech-recognition/fun-asr-flash/http-api
- ASR 文件转写 HTTP API（时间戳）：https://platform.qianwenai.com/docs/api-reference/speech-recognition/paraformer-asr-file/api-reference
- API Key / 错误码：https://platform.qianwenai.com/docs/api-reference/preparation/api-key ；https://platform.qianwenai.com/docs/api-reference/preparation/error-messages
- 计费说明 / 模型价格表：https://platform.qianwenai.com/docs/developer-guides/getting-started/pricing ；https://platform.qianwenai.com/docs/developer-guides/getting-started/model-prices
- 限流：https://platform.qianwenai.com/docs/developer-guides/administration/rate-limits
- 免费额度：https://platform.qianwenai.com/docs/resources/free-quota
- 异步任务管理：https://platform.qianwenai.com/docs/developer-guides/run-and-scale/async-task-management
- 安全（内容审核）：https://platform.qianwenai.com/docs/developer-guides/run-and-scale/safety
- 数据安全与隐私：https://platform.qianwenai.com/docs/developer-guides/security-compliance/data-security
- 模型备案信息：https://platform.qianwenai.com/docs/developer-guides/security-compliance/model-filing
- 更新日志（模型发布时间）：https://platform.qianwenai.com/docs/changelog/models
- 模型详情（价目/RPM 示例）：https://www.qianwenai.com/models/qwen-audio-3.1-tts-next ；/qwen-audio-3.0-tts-flash ；/qwen-audio-3.1-tts-flash ；/qwen3-tts-flash ；/cosyvoice-v3.5-flash ；/qwen-audio-3.1-asr-flash ；/qwen-audio-3.1-realtime-plus
- 用户协议：https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20260423144831521/20260423144831521.html
- 产品服务协议（标识/数据/IP 条款）：https://terms.alicdn.com/legal-agreement/terms/common_platform_service/20260423145804812/20260423145804812.html
- 法律声明及隐私权政策：https://terms.alicdn.com/legal-agreement/terms/common_product_agreement/20260423150805928/20260423150805928.html
