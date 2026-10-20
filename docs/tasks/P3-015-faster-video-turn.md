# P3-015 视频创作 turn 提速（快路径提示 + frame 批量自检）

日期：2026-10-20（Asia/Shanghai）。状态：**代码/测试/固定 staging 完成，PR 待复审与合并；未安装、未发真实模型请求、未合并 main。**

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

### 未验证 / 不声称

- **未安装** alpha.8、未替换用户当前 alpha.7 安装、**未发真实模型请求**、未合并 main；真实 DSH 页面与真实模型闭环仍待用户授权后验收。
- 真实 DSH 的 `read_image` 按 workspace 相对路径读取 `.dsh-video-frames/latest.png` 已由本机工具实测支持相对路径，但未在真实视频会话里跑完整闭环。
- 模型对快路径的遵循度与真实耗时需真机 A/B；提示词收益依赖模型行为，不能由组件/门禁测试替代。
- 残余小风险：`frameImage` 目录若被 agent 预置为宽权限不会主动收紧（文件本身 0600、符号链接已被原子替换）；进程强杀可能残留 `.latest-*.tmp`；wait 超时后既允许 status 又与“不要轮询”提示存在轻微张力（自检 job 通常远小于 30s）。

## 下一步

1. PR 复审；
2. 用户授权后用受支持 Plugin Manager 替换安装 alpha.8（回滚：重新安装 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`），client 未变、通常无需重启；
3. 在真实 DSH 专用工程中做 ≤2 次真实模型请求，按同一“把球换成足球”类修改记录步数/耗时，与 536s/14 步基线对比；确认左侧自动更新与自检路径；
4. 验收通过后再由用户决定合并 main 与长期安装。
