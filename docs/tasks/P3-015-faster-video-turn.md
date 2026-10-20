# P3-015 视频创作 turn 提速（快路径提示 + frame 批量自检）

日期：2026-10-20（Asia/Shanghai）。状态：**代码/测试/固定 staging 完成；alpha.8 已通过真实 Plugins 页安装并启用；真实 DSH 原生会话 2 次模型请求验收通过（3 步/42.5s、2 步/37.4s，对比基线 14 步/536s）；PR #9 已获合并授权，待执行合并。**

- 分支：`codex/faster-video-turn`（base `origin/main` `1672a42`），隔离 worktree `dsh-video-editor-worktrees/faster-video-turn`
- 代码提交：`191274e`（实现+测试+alpha.8 bump）、`cf7e593`（恢复 conversation-chain 所需提示片段）；本文件所在 docs 提交为证据记录，不改变运行时文件
- 固定 staging：`artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（root=`engine`=`cf7e5931441bcde9c444bc21192112bed6429be2`、rootDirty=false、bundle `0.3.0-alpha.8`、client/worker `0.4.0`、INTEGRITY sha256 `988302e9ad4173ab15919dd1e7db90123acb7f8f2b067acb27c1db6a4c716857`）

## 背景与根因

用户在真实 DSH 里用 alpha.7 做一次“把球换成足球”的续改，单轮约 **536s、14 步**；其中模型生成约 **533s**，工具执行约 **3s**。40 次工具调用：`video_engine` 23、`bash` 6、`read_image` 10、`glob` 1。session log（`session-97bc8f51…`，project `proj-mveprihs-86ab8473`）显示慢在 Agent 串行步数，而非渲染/预览：

- 模型先在 `/tmp` 自建 HTML、找 Chrome、本地渲染、ffmpeg 裁剪/取色，再进入 `compose→frame→status→read_image` 的视觉自检循环；
- 原 prompt 没有快路径（即使 facts 已有 revision 仍要求 inspect）、没有禁止本地渲染/调试回路、没有验证预算与步数目标；
- `frame` 是异步 job，模型需要多次 `status` 轮询，再自行用 bash/glob 找 PNG，再 `read_image`；一次自检可占 4–8 步；
- 模型单步 30–130s，14 步串行放大为十分钟。

## 范围与实现

只做“减少一轮创作的模型步数与工具往返”，不改 composition 契约、发布语义、左侧预览、client.js、手动编辑范围，不引入新渲染后端。

### A. Prompt 快路径与边界（`host/sessions.js`）

- 有 `Last known project revision` 时跳过 inspect：`project.source` 一次取完整 HTML → `project.compose` 一次；只有无 revision 或需要 scene/element facts 时才 inspect。
- 正常修改不轮询 `status/close/history/undo/redo`；`publishedRevision` 即完成，左侧预览自动跟随。
- 视觉验证预算：颜色/材质/文字/布局/尺寸/时长等简单修改不做；确需自检时最多 1 次 `frame`（`wait:true`，一次最多 3 个 `times`）+ 1 次 `read_image` + 1 轮修正；不为边际润色反复 compose。
- 禁止本地渲染/调试回路（bash/glob/read_image 渲染、裁图、取色、找 Chrome/ffmpeg/PIL、写 scratch HTML、翻插件源码）；只通过 `video_engine`。
- 步数目标 3–5 次工具调用/整轮 ≤6；用户指定时长时 `data-duration` 与 timeline 总长必须一致（骨架中的 5 只是占位）。
- `wait` 成功结果含 `frameImage`（workspace 相对路径），模型直接把该路径交给 `read_image` 一次；不再用 glob/ls/bash 定位。
- prompt 上限保持 ≤4000 字符；实测最坏 real-id 3932 / demo-id 3856（demo composition facts），无绝对路径/tmp/home/file://。

### B. frame 批量 + 同步等待 + 单张 contact sheet（`host/tool.js`、`host/bridge.js`、worker）

- Host 参数：`frame` 接受旧 `time` 或新 `times`（1–4 个互不相同秒数，3 位小数去重、升序归一）二选一；`wait:boolean` 为 Host 层语义，不下发 worker；非法参数在 worker 启动前 `E_PARAMS`；`render` 不变。
- Worker：`times` 长度 1 时行为/结果与旧 `time` 完全一致；`>1` 时一次 HyperFrames `snapshot --at t1,t2,... --no-end --keep` 抓全部帧，逐个校验 PNG 头/尺寸，再用 ffmpeg lanczos+hstack 横向拼一张 sheet（tile 宽 `min(480, width)`、偶数等比高、sheet 宽 ≤1920），只发布一张 PNG；metadata 记录 times/tile/sheet 尺寸。取消/超时/清理/hash/bytes/job fencing 语义不变。
- Host `wait:true`：登记 job 后每 250ms 轮询 worker status，预算 `min(30s, timeoutMs)`；终态立即返回，超时返回当前视图（job 仍可 status/cancel）；wait 不改变 job 归属校验，closing/disposed 不长时间挂起。
- `frameImage`：wait 成功且有 artifact 时，经 `readArtifact` 复核 name/hash/bytes/realpath 后，把 PNG 以同目录独占临时文件（`wx`、0600）+ `rename()` 原子替换到 `<sessionCwd>/<projectId>/.dsh-video-frames/latest.png`，返回固定相对路径 `.dsh-video-frames/latest.png`；失败只记录并省略字段，不把成功 job 变失败；结果仍受 `TOOL_RESULT_BYTES` 与“无 Host 绝对路径”约束。该副本让 `read_image` 可按 workspace 相对路径直接读取。

### C. 兼容性

- 旧 `frame {time:2.5}` 的请求、job view、artifact metadata（`{width,height,time,frame}`）、错误码逐字段不变；`render` 路径不变。
- `frameImage` 仅出现在 `wait:true` 成功结果；非 wait、超时、失败、artifact 不可复核时省略。
- `client.js` 与 alpha.7 **字节相同**（`5ae8c69d…`），安装候选不需要因 client 缓存重启客户端；Host/worker 为新增量行为。
- 不改工程内容、revision/history 语义、preview snapshot/路由/播放、手动编辑延期范围。

## 验证

### 仓库门禁（本 worktree，最终代码 `cf7e593`）

| 门禁 | 基线 `1672a42` | 当前 |
|---|---|---|
| `scripts/check.mjs` | 52/52 | **52/52** |
| `scripts/smoke-client.mjs` | 78/78 | **78/78** |
| `scripts/check-host.mjs` | 55/55 | **65/65**（新增 times/wait/frameImage/符号链接与权限加固等断言） |
| `scripts/test-stage-version.mjs` | 10/10 | **10/10** |
| worker `test/frame-times.test.mjs` | — | **8/8** |

`check-host` 连续多次运行稳定；`scripts/check.mjs` 版本断言同步到 `0.3.0-alpha.8`。

### 固定 staging 真引擎

- `scripts/test-host-engine.mjs --staging <alpha.8>`：真实 Host + worker 的 open/inspect/edit/frame/render/cancel/close/dispose 全通过（证据 `artifacts/p2-b/evidence/engine-run-*.json`）。
- 专项真实批量自检（/tmp 复跑脚本 + fixed staging）：`times:[0.5,2.5,4.5]`、`wait:true` 一次调用成功；artifact 单张 PNG `1440×270`（tile 480×270×3、times 保留）；`frameImage` 落在 `<staging>/session-cwd/demo/.dsh-video-frames/latest.png`，字节与 artifact hash/大小一致（74282 B，sha256 `c80047cc…`），mode 0600；旧 `time:2.5` wait 结果 metadata 仍为 `{1280,720,time:2.5,frame:75}` 并原子替换 frameImage。
- `scripts/test-conversation-chain.mjs --staging <alpha.8>`：**261/261**（P3-012 真实链回归；修复了提示片段被压缩导致的 `videoEngineLine` 单点失败）。
- contact sheet 截图证据：`artifacts/p3-015/evidence/contact-sheet-times-0.5-2.5-4.5.png`（真实 HyperFrames 三帧横向拼接）。

### 真实 DSH 真机验收（2 次真实模型请求）

安装：通过真实 DSH Web GUI Plugins 页从 alpha.7 卸载后安装固定 staging `bundle` 并启用；插件详情为 **v0.3.0-alpha.8 / 1 of 1 运行中**，来源指向该 staging；回滚 alpha.7 staging 路径保留。client.js 与 alpha.7 字节相同。

测试工程：把用户球工程按字节复制到 alpha.8 staging（`proj-mveprihs-86ab8473`，index.html 与原件同 sha256 `e5691b24…`）；用户原工程/旧 staging 未改动。模型与基线一致：`deepseek-account / deepseek-flash / reasoningEffort=max`（测试后已恢复用户默认为 `opencode-go / deepseek-v4.1-flash / low`）。

| 请求 | 内容 | 模型步数 | 墙钟（请求→完成） | tool 调用 | revision |
|---|---|---|---|---|---|
| 1 | 把球换成足球 | **3** | **44.2s**（turn 42.5s，llm 42.2s / tool 0.09s） | 2：`project.source`、`project.compose` | `f60fa6c…` → `66e401f…` |
| 2 | 把时长改成 8 秒，并让球落地更有弹性 | **2** | **39.3s**（turn 37.4s，llm 37.1s / tool 0.16s） | 1：`project.compose` | `66e401f…` → `d73089e…`，duration 8 |

对比基线 session（同时刻、同模型、同工程题材）：**536s / 14 步 / 40 次工具调用（video_engine 23、bash 6、read_image 10、glob 1）** → 本次 **44.2s/39.3s、3/2 步、合计 3 次 video_engine、0 次 bash/read_image/glob/frame/status**。两轮均为 `completed`。

左侧预览自动跟随验证（真实 DSH Web GUI 面板）：request 1 后 `data-canvas-phase=ready`、`data-canvas-revision=66e401f…`，播放到 `2.50 / 5.00` 可见足球；request 2 后 revision=`d73089e…`、seek 范围变 `0.00 / 8.00`，播放到 `3.98 / 8.00` 可见 8 秒弹性动画。截图证据：`artifacts/p3-015/evidence/live1-soccer-ball-preview.png`、`live2-8s-preview.png`、`final-installed-state-preview.png`；汇总：`artifacts/p3-015/evidence/live-acceptance-2026-10-20.json`。

投递方式说明（诚实口径）：真机请求通过 Host 原生 `sessionController.prompt`（Web GUI 的 `/api/session/prompt` RPC，与原生 Composer/codex-bridge 使用同一 Host 方法）发送到已绑定的视频创作 Session。独立 Web GUI 外部页面没有插件所需的内嵌原生会话 kit（`data-session=unavailable`），所以没有在右栏 Composer 里自动输入；模型、prompt context、`video_engine` tool scope、worker、左侧预览均为真实 DSH 路径。测试后插件已重新加载为干净状态（仅保留 demo + 球工程副本），未使用的临时唯一工程已移除。

### 未验证 / 不声称

- 未在插件右栏内嵌原生 Composer 里自动输入（上述外部页面限制）；用户桌面窗口的正常右栏流程同用该原生 Session 控制器，但未由本轮自动化实际键入。
- 两轮真机请求都走了快路径、没有触发视觉自检，因此 `frame→frameImage→read_image` 的模型侧实跑未在这两轮出现；该路径的真引擎/工具级验证见上文，模型是否在复杂修改时使用需后续真实使用观察。
- 用户原作品/旧 staging 未改写；测试工程是 alpha.8 staging 内的字节副本，不是用户工程本身。
- 残余小风险：`frameImage` 目录若被 agent 预置为宽权限不会主动收紧（文件本身 0600、符号链接已被原子替换）；进程强杀可能残留 `.latest-*.tmp`；wait 超时后既允许 status 又与“不要轮询”提示存在轻微张力（自检 job 通常远小于 30s）。

## 下一步

1. 按用户授权合并 PR #9 到 main，并同步本地 main；
2. 保持 alpha.8 安装启用，用户正常在桌面窗口的 Vedio Editor 中继续实机使用；回滚入口为 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`；
3. 后续新问题从最新 main 建独立分支修复，不直接在 main 开发。
