# V1 M4：音频、千问云与轻量时间线

2026-10-22。用户明确指定当前会话完成 M4，提供千问云密钥用于试点，并要求轨道 UI 对齐成熟剪辑软件、轻盈简洁。基线 main `cf966b4`；独立分支 `codex/v1-m4-audio`，单写入树 `v1-m4-audio`。通用规则见 [DEVELOPMENT](../DEVELOPMENT.md)。沿用本会话的实现与判断合码授权；本轮供应商必要真实调用已获本次要求授权，不含安装、重启 DSH 或公开发布。

## 交付范围

- `1.0.0-alpha.5` / client+worker `0.7.0`。最多 3 条音频轨；用户音频导入、生成音频均进入工程素材库，再通过统一 timeline 操作上轨。与 UI/AI 共用 revision、原子 batch、撤销历史和引用删除保护。
- 音频支持切分/重排/trim/移动/复制/速度、clip 音量与淡入淡出、轨 gain/mute。切分保留两端淡化，短片段淡化自动限制到片段长度；不在接缝重复淡化。音频与视觉轨类型严格区分。视频原声保留，可通过片段音量或静音控制。
- 预览使用同一整数帧/源入点/速度，Web Audio gain 支持正增益和线性淡化；用户点击开启声音，浏览器限制时保留明确按钮。已开启的声音在 revision 快照切换后恢复；旧快照清理会暂停媒体、关闭 AudioContext。波形按源区间与速度裁切。
- 导出从不可变快照生成确定性 ffmpeg 音频图：源 trim → atempo → gain/fade → 位置延时 → stereo mix → 双遍响度测量/归一化 → AAC 48 kHz 双声道。视频流 copy 保持原始帧数；目标 -16 LUFS、TP -1.5 dBTP；混音/校验失败透出 `audioFailures` 并拒绝发布静音替代品。静音工程沿用原导出路径。
- `AudioService` 位于 Host，适配器按能力发现，统一 queued/running/downloading/terminal 状态；密钥不传 worker、模型或结果。`audio.providers/generate/status/cancel` 供 Tool 与 UI 使用；settings/configure/check 为 UI-only。生成成功返回受管 assetId，可由 UI 上轨或 AI timeline.apply 上轨。
- 千问云：TTS `qwen-audio-3.1-tts-flash`、SFX `qwen-audio-3.1-tts-next`、音乐 `fun-music-v1`。合成走同步 API，立即下载临时 URL。仅接受受限 HTTPS 供应商产物域名；当前供应商返回的指定 HTTP OSS 域名先升级 HTTPS，不向下载服务转发密钥。403 映射为未开通；音乐拒绝结果缓存并禁用重复生成，开通/换 key 后显式测试连接可重新尝试。
- macOS 本地 `say` 提供免 key 中文旁白，受限 argv、AIFF 转 AAC/m4a；其它平台显示不可用。BGM 未开通时明确提示导入音频，不引入第二家服务。
- key 设置为密码框，只保存到 `<dataRoot>/audio/audio-secrets.json`（0600）。兼容读取用户既有 `~/.dsh/dsh-video/secrets.env`（必须 0600）的 `QIANWEN_API_KEY`；清空本机设置会覆盖此回退。密钥不入仓库、提示词、日志、截图或 staging。
- 持久任务日志仅存请求摘要、归属、状态、产物引用和用量；同 operationId 重放不重复调用，改 payload 拒绝。重启后未完成任务标为 interrupted/uncertain，不自动重试计费请求。取消/超时可能仍被供应商计费；导入已跨原子提交点时以成功回执为准。
- 护栏：同时 1 个生成，2000 字符/次，云端 20 次/日，记录最多 1000 项，300 秒超时，下载 64 MiB 上限。显示输入规模估算及实际 usage；供应商价格存在口径不确定性，不承诺人民币上限；无静默自动重试。
- 能力表显式报告 voice-design/ASR 尚未提供本产品动作；可扩展适配器不把供应商所有模型列表当作已开通能力。逐字字幕对齐不在本次用户音频剪辑范围内。

## 轨道设计

工具栏收敛为撤销/重做、切分、删除与更多菜单，低对比线框图标；添加轨道/复制/重排/紧凑视图放入更多菜单。细标尺、窄轨头、低饱和视频蓝/音频绿、单像素播放头、片段内波形。选择后才出现单行精调；窄窗允许局部换行，轨道水平滚动不撑宽页面。沿用宿主字体与主题 token；保留触控目标、键盘、aria-label、可见焦点及数值编辑。

## 验证与边界

开发证据目录：同级 worktrees 下 `artifacts/v1/evidence/m4-dev/`，保留 red/诊断与最终通过日志，固定候选回归另列。未触碰用户已有工程或已安装 alpha.11。

- 真实千问云：连通成功；短 TTS WAV、3 秒风铃 SFX WAV 生成/下载成功；音乐实测 403 未开通；本地 say/m4a 成功。仅短合成与权限验证，不是 DSH 原生对话模型验收。
- 音频测试片：21 秒/630 帧，含视频原声+BGM、AAC 48k stereo，0/5/10/20 秒四点 A/V 偏移 ≤1 帧。双遍归一化复测 -16.01 LUFS。最终固定候选需再次核对。
- 源码 Chrome 完整工作区：M3 手势/媒体库回归 + 音频生成、上轨、数值编辑、静音/撤销、波形、真实播放同步、revision 换片声音保持、340px 窄窗。
- 安全/失败：0600、密钥结果脱敏、任务归属、幂等重放、取消、超时、重启中断不重计费、未开通能力缓存、下载 URL fence；导入与工程写入边界沿用 M2/M3。

## 固定候选与交付记录

[PR #20](https://github.com/heswy/dsh-video-editor/pull/20)，选择合回 main。固定 runtime `81ffb1b104d6c781fabbe8d2f7ee668a5afe1acc`，root=engine、rootDirty=false；bundle alpha.5 / engine 0.7.0。候选为同级 worktrees 下 `artifacts/p2-b/staging-v1.0.0-alpha.5-81ffb1b`；INTEGRITY SHA256 `afbf1ac1d0314d8ec5fbade781cf56b1a918b4a7a1e2367daec88f0da7ce8eea`。初版 e332611 修复默认音色 ID 中小数点校验后替代，旧候选保留。

最终证据目录为同级 worktrees 下 `artifacts/v1/evidence/m4-alpha5-81ffb1b-20261022/`，`verification-summary.json` 汇总原始日志、截图、产物与边界。

- check 58/58、smoke 86/86、Host 71/71、worker 72/72、client 23/23、stage-version 10/10；新 provider 安全/失败/恢复测试和真实 Host 归属测试通过。音色小数点有 red→green 回归。
- 固定候选 Chrome 工作区 28 项：千问 TTS 真实生成、受管素材、音轨精调/静音/撤销、波形、实际播放与 seek、revision 换片自动保持声音、340px 窄窗、22s/660 帧 H.264 + AAC48k/stereo 导出。音频预览漂移 0.022s（小于 2 帧）。图片 `workspace-cloud/timeline-detail.png` 为真实组件截图。
- 固定候选独立测试片 21s/630 帧，视频原声+BGM 两源混音；实际黑白闪帧与 1kHz 脉冲在 0/5/10/20 秒的最大偏移 0.021313s（小于 1 帧）。响度 -16.01 LUFS，true peak -8.58 dBTP；`render/loudness.json` 的 input_i 是对最终文件的复测，output_i 为测量命令假设再次归一化的结果，不作最终响度。
- 固定候选 1 GiB 稀疏填充有效 1 秒媒体：流式上传、Range、重启、引用删除保护通过；snapshot worker RSS +49152 B、Host +65536 B，上传 +80216064 B。此为吞吐/快照内存验证，不代表长复杂素材解码实机压力测试。
- 固定候选真实引擎 frame/render/cancel、canvas-chain 通过；对话 261/261、预览 164/164，固定源码只读审计 same=true、91→91。
- 收尾发现并修复：默认供应商音色带版本小数点；音频 Tool 早返回必须先校验可信 Agent/project；短片段淡化必须约束到新长度；单遍响度对稀疏脉冲偏差过大改为双遍。浏览器脚本在缩放 iframe 内点击须映射坐标，数值更改须全选原值；保留诊断日志。旧 JSONL 并发测试改为断言恰好一个成功与一个冲突，不假设哪个并发请求先获锁。

真实 DSH 激活/用户音频与复杂原生对话、非 macOS 平台仍待实机窗口；本轮不安装或重启。
