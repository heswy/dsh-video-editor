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

## 4. 预期收益

| 指标 | 修复前 | 目标 |
|---|---|---|
| 简单修改的模型步数 | 14 步 | 3–5 步，整轮 ≤6 步 |
| 一轮墙钟 | 约 536s | 约 2–3 分钟（取决于模型单步延迟） |
| 需自检时的工具往返 | 多轮 frame+status+多张 read_image+bash 找图 | 1 次 frame（times+wait）+ 1 次 read_image（frameImage） |

以上是设计目标与组件/真引擎证据；真实模型是否按快路径执行、真实耗时下降幅度必须在 DSH 真机验收中测量，不能由本文件替代。

## 5. 未验证、风险与下一步

- 未安装 alpha.8、未发真实模型请求、未合并 main；用户当前 alpha.7 安装与作品未改动。
- 未验证：真实 DSH `read_image` 相对路径闭环、真实模型快路径遵循度与耗时 A/B、安装后的 client/Host 热切换表现。
- 风险：模型可能仍选择额外验证步骤；prompt 收益依赖模型行为；`frameImage` 目录若被 Agent 预置为宽权限不会主动收紧（文件 0600、符号链接已防）；wait 超时后 status 可查与“不要轮询”提示有轻微张力；强杀可能残留 `.latest-*.tmp`。
- 建议真机验收（需用户当次授权）：Plugin Manager 替换安装 alpha.8 → 专用工程 ≤2 次真实模型请求（同类修改）→ 记录步数/耗时与左侧自动更新 → 对比 536s/14 步基线；回滚 alpha.7 staging 路径已记录在任务文件。
