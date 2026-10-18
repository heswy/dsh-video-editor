# P1-001：HyperFrames 本机单场景实测

日期：2026-10-17。开发会话的实测交付，待主会话独立复审；不修改 STATUS 或已接受决策。

## 范围与基线

唯一工作树 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`，分支 `codex/p1-engine-spike-b4bf`；任务初始 base `831a64df399215ca2074874a6ac904bdca587329`，本轮开工 HEAD `89eabb8`。全部实现位于 `spikes/hyperframes/`，另外只更新本文和任务开发记录。未改根插件代码，未安装 DSH，未 push/PR/merge 或联系其他会话。

目标是本机引擎可行性：自有 5 秒、1280×720、30fps 单场景，以 HTML 为内容真相，7 个显式稳定 `data-hf-id`；中文标题、本地字体、基础圆形/线段和 seekable GSAP 动画，无随机性、远端素材或音乐。没有另造截图渲染引擎。

## 精确版本与可追溯来源

| 项目 | 实测 |
|---|---|
| Node / npm | v24.14.0 / 11.9.0；CLI package.json 要求 Node >=22 |
| npm hyperframes / @hyperframes/sdk | 均 0.8.167；本轮 registry 查询发布版本，固定根版本及完整锁文件 |
| SDK 传递 core / parsers | 0.8.167 / 0.8.167 |
| GSAP | 3.15.0；core 与 MotionPathPlugin 本地文件 |
| puppeteer-core（浏览器验收） | 25.14.0；与 CLI 锁定解析版本相同 |
| Chrome | Google Chrome 155.0.8059.79；现有 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |
| FFmpeg / ffprobe | 8.0.1；现有 `/opt/homebrew/bin/ffmpeg` 与 ffprobe |
| 字体 | `/System/Library/Fonts/STHeiti Medium.ttc`，SHA-256 `f8fa4a63e2cf500e98e64d4c73260daaba049306cf85dec9e3729bc285b7d645` |
| 宿主目标 | DSH Desktop 0.2.0-rc.2；本轮不启动或安装宿主集成 |

官方来源：[SDK quickstart](https://hyperframes.heygen.com/sdk/quickstart)、[SDK 包](https://hyperframes.heygen.com/packages/sdk)、[timing](https://hyperframes.heygen.com/sdk/guides/timing-and-animation)、[engine](https://hyperframes.heygen.com/packages/engine)、[官方源码](https://github.com/heygen-com/hyperframes)、npm 精确包元数据（evidence 下 npm JSON）。官方网页用于确认能力方向；本轮 ABI 以实际 npm 包的 dist/*.js / *.d.ts 和运行结果为准。

安装只在本树 spike 包中进行：`npm install --ignore-scripts --no-audit --no-fund --prefix spikes/hyperframes`；后续固定版本增加 GSAP 和 puppeteer-core，已入锁。先查根依赖 scripts，再以忽略脚本方式解析全部依赖；锁中唯一 hasInstallScript 是 esbuild 0.25.12，未运行 postinstall。平台可选二进制足够运行本轮 Studio。字体仅复制到忽略的 artifacts，未再分发。没有全局安装、宿主依赖变更或系统配置修改。初次 npm 命令使用默认包管理器缓存；最终复现命令显式将 npm cache 放到 spike/.cache/npm，后续复现按 README 执行。

## 实现与验证事实

执行命令完整顺序见 spike README。脚本从仓库根运行，所有产物均位于 spike artifacts；工具临时目录、字体缓存、状态目录和浏览器配置落在本工作树。没有浏览器下载。

1. `npm test --prefix spikes/hyperframes`：3 个真实行为测试，跨进程保存重开，以及 cancel / timeout 清理 detached 子代、保留无关 sentinel。先运行缺失实现的失败测试；增强 detached 用例也先复现了只杀进程组的遗漏，再修复。
2. `prepare-scene` / `edit` / `reopen`：通过官方 `openComposition`、`find({text})` 定位 `hf-title`，`batch` 中执行 `setText` 与 `setTiming({start:1,duration:3})`，`createFsAdapter({root})` + `persistPath:'index.html'` + `flush()`，监听 persist:error，并读取磁盘与 `serialize()` 完全比对。修改标题「让创意成为影像」→「每一帧，都可编辑」。关闭进程后另起进程重新读取原生 HTML，7 个稳定 ID 不变，start=1、data-duration=3 保留；测试不依赖前进程内存。
3. `frame before/ordered/shuffled`：使用官方 `hyperframes snapshot`，非自行实现 capture。基准时间 `[0, 0.5, 1, 2.5, 3.5, 4, 4.5, 149/30]`，乱序 `[4.5, 0.5, 3.5, 1, 2.5, 0, 4, 149/30]`，两个独立 Chromium 进程，每次在同一页面顺序执行这些 seek。8 张对应 PNG 字节完全一致；修改前后 2.5 秒帧不同。末帧 CLI 文件名按毫秒标为 4.967s。
4. 真实官方 Studio：`preview --foreground --no-open --no-proxy --no-browser-gpu`，本地 4567。浏览器检查等待 iframe 官方 runtime ready，调用 `__player.renderSeek(t,{exact:true})` 及 seek completion barrier；0.5/4.5 秒 hidden，1/2.5 秒 visible，中文字形可见，字体加载成功，标题文字范围 x=88、y=260、w=576、h=72，落在画布内。播放 450ms 后形状 transform 推进、暂停后复位到 2.5 秒；最终页面 errors=[]、blockedRequests=[]，见证据 JSON。截图来自真实 HyperFrames Studio，不是 DSH UI。
5. `render`：官方 CLI 自带 producer/engine 路径，单 worker、software GPU、screenshot capture，H.264 MP4。没有自己复刻 Playwright capture；不把引擎文档的 BeginFrame 概述冒充本轮捕获模式。CLI 实测最终一次 16.5 秒完成（与机器负载相关，不是性能承诺）。
6. `verify`：ffprobe `-count_frames` 检查 codec、尺寸、r_frame_rate、avg_frame_rate、nb_frames、nb_read_frames 和 format.duration。结果 H.264、1280×720、30/1、150/150、5.000000 秒；时长容差 <=1/30 秒，实测误差 0 秒。同时从真正 MP4 解码 2.5 秒帧，目视核对中文与形状。
7. `node --test spikes/hyperframes/test/render-lifecycle.integration.mjs`：实际 upstream streaming frame 开始后 cancel；timeout 用 SDK 修改私有副本根时长为 60 秒，20 秒 deadline 在真实 capture 中触发。两种情况检查自身 CLI、Chromium/helper、FFmpeg 的进程身份不再存活，临时 partial MP4 与目录删除。主交付工程仍为 5 秒。每个 job 的 ownedPids 和 survivors 存 JSON，非仅查看 Promise 状态。

## 实测发现与限制

- **SDK duration 快照差异**：`@hyperframes/sdk/dist/document.js` 通过 data-end − data-start 计算 `getElement().duration`；`engine/mutate.js` 的 handleSetTiming 使用核心 readClipTiming/writeClipTiming，实际写 data-duration。本例 SDK duration 为 null，但原生 data-duration 正确且 Player、渲染均遵守 1–4 秒。没有改 node_modules；适配时读取显式属性并记录快照差异，不能把 null 当作保存失败或零长度。
- **Studio 的额外 GSAP 请求**：初次阻断外网的页面报 MotionPathPlugin CDN 加载失败。对照上游 preview 注入代码（chunk-AURMZPQ4.js）后，为 fixture 显式提供同版本本地 MotionPathPlugin；重跑结果见 preview-check。样例核心动画只使用 GSAP x/rotation/scale，无远端素材。外网被阻断后的正常播放才是通过依据。
- **工程历史锁**：Studio 打开期间 CLI snapshot 曾警告 history 被该 Studio PID 占用，虽可捕获但不记录 artifact history。后续 Host 必须串行管理写者或对渲染使用独立快照；本轮 PNG SHA 与独立 verification 不依赖这份上游历史记录。
- **取消不能只杀一个进程组**：Puppeteer/Chromium 可 detached。修复为跟踪自启动根的子代与私有 tmp 标识，终止前再核对 PID + 启动时间 + 命令，TERM 后 1.4 秒宽限再 KILL，确认清零才删 tmp。只在 POSIX 本机受控工程测试；采样式跟踪不是恶意进程遏制方案。
- 字体来自本机授权系统字体，Git 不包含字体；跨机器需显式提供字体并重跑。没有音视频素材、音轨、多 Scene、WebGL/Canvas、跨平台/GPU 一致性、长片吞吐或 DSH 依赖解析验证。
- `owned()` 只是本 spike 的误操作保护，非安全沙箱；任意 Agent HTML/JS、网络、文件访问、符号链接、逃逸进程必须在后续独立威胁模型与隔离任务中处理。未宣称不可信代码可安全运行。
- 当前脚本是验收工具，无通用工程注册、并发写入队列、原子多文件 revision、恢复/重试服务。SDK fs adapter 的错误通过事件上报，flush 本身不足以宣称持久化成功，必须监听并做读回。

## 建议的最小 Host 契约（待评审）

建议独立 Node worker / 子进程负责 HyperFrames SDK 与官方 CLI，使 Node >=22、ESM、DOM parser、浏览器和 FFmpeg 依赖不进入 DSH 插件依赖解析图。DSH Host 掌握工程注册、授权、修订与任务状态，通过受支持的 Host 通道转发业务请求；UI 与 Agent Tool 使用同一个入口。此方案只得到独立进程可运行的实测支持，未验证 DSH 0.2.0-rc.2 的 worker 启动、RPC、打包与卸载生命周期。

| 操作 | 输入 | 输出 / 语义 |
|---|---|---|
| open | Host 注册的 projectId、工程根；不接受 UI 任意绝对路径 | sessionId、entry=index.html、dimensions/fps/duration、revision；源文件及资产清单 |
| inspect | sessionId、expectedRevision、可选 stableId | 结构化文本/样式/原生 timing/capabilities；带 revision；禁止把 duration 快照 null 误当零 |
| edit | sessionId、expectedRevision、operationId、actor、显式 targetIds、typed ops | 单写者队列；先校验 revision 和支持能力，SDK batch，捕获 persist:error、flush、磁盘读回成功才发布新 revision + patches；冲突不写入 |
| frame | projectId、revision、time 或 frameIndex | 固定文件快照的真实 PNG、实际采样时间、内容哈希、环境版本；不得预览另一 revision |
| render | projectId、revision、fps/format、operationId | jobId、snapshotRevision；queued→running→succeeded/failed/cancelled/timed_out，只有验证通过的完整 MP4 才发布 |
| cancel | jobId（Host 核对拥有者） | 幂等 cancellation acknowledgement；先 cancelling，待 CLI、浏览器、编码器退出并清理后 cancelled；不使用全局进程名 kill |

工程路径：原生 `project/index.html` + `assets/` 为权威，Host 工程索引不是内容第二真相。建议 revision 为入口及所有本地依赖字节/路径的清单哈希；本 spike 输出的单 HTML SHA 只证明本场景入口写回。外部文件 watcher + 操作前内容重读防止 AI 文件编辑覆盖人工变更；渲染拷贝固定 revision 与相对资产至私有目录，完成后再发布。不能靠 SDK patch 自动解决外部代码编辑冲突。

建议错误：E_PROJECT_NOT_FOUND、E_REVISION_CONFLICT、E_UNSUPPORTED_EDIT、E_PERSIST、E_ASSET_MISSING、E_RUNTIME、E_DEPENDENCY、E_RENDER、E_CANCELLED、E_TIMEOUT；结构含 operationId/jobId、stage、message、可重试性及脱敏日志位置。未完成结果不得标 succeeded。项目关闭/插件卸载取消拥有任务、排空写队列再 dispose；上游 Studio history 与 Host revision 的唯一写者安排待接入任务验证。

## 真实产物与复审入口

绝对根目录：`/Users/orange/.codex/worktrees/b4bf/dsh-video-editor/spikes/hyperframes/artifacts/`。

- `project/index.html` 与 assets：保存后原生工程。
- `before/at-2.5s.png`、`ordered/at-2.5s.png`：SDK 编辑前后。
- `ordered/`、`shuffled/`：全部真实关键帧。
- `studio-preview.png`、`preview-check.json`：真实 Studio、Player seek 与播放验收。
- `edited.mp4`、`mp4-at-2.5s.png`：实际导出与解码帧。
- `doctor.json`、`verification.json`、`render-result.json`、`render-{cancel,timeout}.json` 和日志：版本、哈希与生命周期证据。

可提交的 evidence 元数据副本位于 spike/evidence；视频/帧/字体/node_modules/tmp 均被局部 .gitignore 排除。结果 commit 见任务开发记录及交接消息（避免在同一个提交内部伪造自身 SHA）。
