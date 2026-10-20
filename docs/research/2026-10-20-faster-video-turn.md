# 2026-10-20 视频创作 turn 提速记录（P3-015）

本文件记录“一轮续改约 10 分钟”的定位、修复与固定 staging 证据。它是开发/真引擎证据，不是 DSH 安装验收，也不是真实模型闭环。

## 1. 现象与实测分解

用户报告 alpha.7 下一轮“把球换成足球”耗时约十分钟；session log `session-97bc8f51…`（project `proj-mveprihs-86ab8473`）实测：

| 指标 | 值 |
|---|---|
| 单轮墙钟 | 约 **536s**，14 步 |
| 模型生成累计 | 约 **533s（99%）** |
| 工具执行累计 | 约 **3s** |
| 工具调用 | 40：`video_engine` 23、`bash` 6、`read_image` 10、`glob` 1 |
| 单步模型时间 | 30s、37s、54s、42s、59s、134s… |
| 左预览 | compose 后自动更新；模型仍在“自检→再 compose→再 frame” |

结论：慢在**模型串行步数**与自检回路，不是 worker 渲染或左侧预览。主要放大器：

1. 模型先在 `/tmp` 做本地 HTML/Chrome/ffmpeg 实验，再走正式工具链；
2. `frame` 异步 job 需要多轮 `status` 轮询，之后模型自行用 bash/glob 找 PNG，再 `read_image`；
3. compose→frame→读图→改→再 compose 的视觉自检没有预算；
4. 原 prompt 没有“快路径/禁止本地试验/步数目标”，facts 有 revision 时仍要求 inspect。

## 2. 修复设计

- **Prompt**（`host/sessions.js`）：revision 已知时跳过 inspect，`project.source` 一次 → `project.compose` 一次；禁止 status/close/history 轮询；简单修改不做视觉验证，确需时最多 1 次 frame + 1 次 read_image + 1 轮修正；禁止本地渲染/裁图/取色/探测 Chrome/ffmpeg/PIL/scratch HTML/翻插件源码；步数目标 3–5 次工具调用/整轮 ≤6；时长遵循用户指定。
- **frame 批量**（`host/bridge.js`、`host/tool.js`、worker `worker.mjs`/`jobs.mjs`/`protocol.schema.json`）：新增 `times`（1–4 个，去重/升序归一，与旧 `time` 二选一）与 Host 层 `wait`；worker 用**一次** HyperFrames `snapshot --at t1,t2,…` 抓多帧，ffmpeg `lanczos+hstack` 横向拼成一张 contact sheet（tile 宽 `min(480,width)`，sheet ≤1920 宽），只发布一张 PNG；单 time 路径逐字段保持旧行为。
- **frameImage**（`host/bridge.js`）：`wait:true` 成功后经 `readArtifact` 复核，将 PNG 以独占临时文件（`wx`/0600）+ `rename()` 原子替换到 `<sessionCwd>/<projectId>/.dsh-video-frames/latest.png`，结果返回固定 workspace 相对路径 `.dsh-video-frames/latest.png`；失败降级省略字段。模型可直接 `read_image` 相对路径，不再需要 glob/ls/bash 定位。预置符号链接不会被跟随，覆盖后权限重置为 0600。
- **兼容**：旧 `frame {time}` 请求/结果/metadata 不变；`render` 不变；`client.js` 与 alpha.7 字节相同；不改发布、revision/history、预览、手动编辑范围。

## 3. 证据

### 3.1 仓库门禁（worktree，最终代码 `cf7e593`）

- `scripts/check.mjs`：52/52
- `scripts/smoke-client.mjs`：78/78
- `scripts/check-host.mjs`：65/65（新增 times 拒绝矩阵/归一透传、wait 终态/超时/归属/预算/dispose、frameImage 形状/落盘/权限/符号链接/失败降级、legacy time/render 兼容、prompt 快路径与 frameImage 断言）
- `scripts/test-stage-version.mjs`：10/10
- worker `test/frame-times.test.mjs`：8/8

基线（`origin/main 1672a42`）：check 52/52、smoke 78/78、check-host 55/55、stage-version 10/10。

### 3.2 固定 staging 真引擎

- staging：`artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`
  - root=`engine`=`cf7e5931441bcde9c444bc21192112bed6429be2`、rootDirty=false
  - versions：bundle `0.3.0-alpha.8`、client/worker `0.4.0`
  - `INTEGRITY.json` sha256 `988302e9ad4173ab15919dd1e7db90123acb7f8f2b067acb27c1db6a4c716857`
  - client.js sha256 `5ae8c69d…`，与 alpha.7 staging 相同
- `scripts/test-host-engine.mjs --staging <alpha.8>`：真实 Host+worker 的 frame/render 等全通过（证据 `artifacts/p2-b/evidence/engine-run-*.json`）。
- 真实批量自检（staged Host + worker，managed demo 工程）：
  - `frame {times:[0.5,2.5,4.5], wait:true}` 一次调用成功；artifact 单张 PNG **1440×270**，metadata `tileWidth=480, tileHeight=270, sheetWidth=1440, sheetHeight=270`、times 保留；
  - `frameImage=.dsh-video-frames/latest.png` 落盘于 `<staging>/session-cwd/demo/.dsh-video-frames/latest.png`，74282 B、sha256 `c80047cc85219adb48e591b30a276d41277b197e6b2ec795ade7f2f2f2842969`，与 artifact hash/大小一致，mode 0600；
  - 旧 `frame {time:2.5, wait:true}` 仍返回 `metadata {width:1280,height:720,time:2.5,frame:75}`，并原子替换 frameImage；
  - 证据 JSON：`artifacts/p3-015/evidence/staging-frame-batch-*.json`；contact sheet：`artifacts/p3-015/evidence/contact-sheet-times-0.5-2.5-4.5.png`。
- `scripts/test-conversation-chain.mjs --staging <alpha.8>`：**261/261**（修复了 test 的 `videoEngineLine` 精确片段回归；证据在 `artifacts/p3-015/evidence/conversation-chain-final/`）。

## 4. 真实 DSH 真机验收（2 次真实模型请求，已执行）

安装：真实 Plugins 页从 alpha.7 卸载 → 添加固定 staging bundle → 启用，详情 **v0.3.0-alpha.8 / 1 of 1 运行中**（来源 `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593/bundle`，INTEGRITY `988302e9…`；client.js 与 alpha.7 同字节 `5ae8c69d…`）。用户原工程/旧 staging 未改写；测试用球工程字节副本（`proj-mveprihs-86ab8473`，index.html sha256 与原件一致 `e5691b24…`）。

模型：`deepseek-account / deepseek-flash / reasoningEffort=max`，与 536s 基线同一模型/推理等级；测试后已恢复用户默认 `opencode-go / deepseek-v4.1-flash / low`。

| 请求 | 内容 | 步数 | 墙钟（请求→完成） | tool 调用 | revision / duration |
|---|---|---|---|---|---|
| 1 | 把球换成足球 | **3** | **44.2s**（turn 42.5s；llm 42.2s / tool 0.09s） | 2：project.source → project.compose | `f60fa6c…` → `66e401f…` / 5s |
| 2 | 把时长改成 8 秒，并让球落地更有弹性 | **2** | **39.3s**（turn 37.4s；llm 37.1s / tool 0.16s） | 1：project.compose | `66e401f…` → `d73089e…` / 8s |

对比基线（同模型/同工程题材）：**536s / 14 步 / 40 次工具调用**（video_engine 23、bash 6、read_image 10、glob 1）→ **44.2s/39.3s、3/2 步、合计 3 次 video_engine、0 次 bash/read_image/glob/frame/status**。两轮均为 `completed`；第一轮 source→compose 的 2 次调用即完成发布，第二轮直接 compose（复用上下文中已有 HTML 与 revision）即完成 8s 改造。

左侧自动更新（真实 DSH Web GUI）：request 1 后 preview `data-canvas-phase=ready`、revision=`66e401f…`，播放到 `2.50 / 5.00` 显示足球；request 2 后 revision=`d73089e…`、seek 变为 `0.00 / 8.00`，播放到 `3.98 / 8.00` 显示 8 秒弹性动画。截图：`artifacts/p3-015/evidence/live1-soccer-ball-preview.png`、`live2-8s-preview.png`、`final-installed-state-preview.png`；汇总：`live-acceptance-2026-10-20.json`。

投递口径：请求通过 Host 原生 `sessionController.prompt`（`/api/session/prompt` RPC，与原生 Composer/codex-bridge 同一 Host 方法）发到已绑定视频 Session；外部 Web GUI 页面没有插件内嵌 native-conversation kit（`data-session=unavailable`），因此没有在右栏 Composer 自动键入。模型、prompt context、`video_engine` tool scope、worker 与左侧预览均为真实 DSH 路径。测试后插件已重新加载为干净状态（只保留 demo + 球工程副本），未使用的临时唯一工程已移除。

## 5. 剩余未验证、风险与下一步

- 未在插件右栏内嵌 Composer 自动输入（上述外部页面限制）；用户桌面窗口右栏走同一原生 Session 控制器，但本轮未由自动化实际键入。
- 两轮请求均为简单修改、未触发视觉自检，因此 `frame→frameImage→read_image` 未在真机模型轮次出现；该路径由固定 staging 真引擎/工具级测试覆盖，复杂修改时的模型行为需后续真实使用观察。
- 残余风险：模型仍可能选择额外验证步骤；`frameImage` 目录若被 Agent 预置为宽权限不会主动收紧（文件 0600、符号链接已防）；wait 超时后 status 可查与“不要轮询”提示有轻微张力；强杀可能残留 `.latest-*.tmp`。
- 下一步：按用户授权合并 PR #9；保持 alpha.8 安装启用供正常使用；回滚 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`。
