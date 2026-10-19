# BUG-001：管理模板 MP4 底部黑带 —— 根因与修复

日期：2026-10-18。执行：p1-engine 工作区；分支 `codex/p1-engine-spike-b4bf` / PR #2；开工 HEAD **`d926d10`**（R1–R2 修复 `74294e6`、两包 0.3.0 已验收）。协调记忆读取自 `origin/codex/project-foundation` @ **`098638b`**（P3-006-B 修复复审通过、BUG-001 任务下发）。实现提交 **`82f6219`**；两包升 **0.3.1**，JSONL 协议 v1、22 个方法与已审 layout/style/覆盖/合并语义不变。只改 `packages/video-engine-worker/**`（渲染 env + 回归）、`packages/video-engine-client/**` 版本/打包兼容检查、`spikes/editor-canvas/**` 的证据 runner/新证据目录、本任务与 research 记录；未改根 Host/插件/p0 树、未安装/启停/重启、未调模型、未 merge、未新 tree/PR、未修改 `node_modules` 交付内容。

## 结论

- **根因已定位**：HyperFrames 0.8.167 的 **static-frame dedup（静帧去重）验证流程会新开第二个浏览器页面**。验证页关闭后，主捕获页静默丢失 `page.setViewport(1280,720)` 的 device-metrics override：`page.viewport()` 仍报告 1280×720，但页面真实 `window.innerHeight` 从 720 掉到 **633**（headless 窗口的真实内容高度，720 外框减 87 浏览器 UI）。同时 renderer 在初始化时因“页面内容高度 720 适配捕获视口”把 **`captureBeyondViewport` 降为 false**。之后 CDP 的 `Page.captureScreenshot` 只绘制 633 行视口，底部 **87 行（y=633–719；旧证据按 86 行黑计为 634–719）成为黑边**。worker 的 `snapshot --at` 抽帧路径没有该验证页，所以一直完整。
- **修复**：在我们的可控适配层，对 **render job** 设置 **`HF_STATIC_DEDUP=false`**（frame/snapshot job 不变），避免第二个验证页；同一 revision/HTML 直接输出完整 720p 构图，不裁切、不拉伸、不补色。上游 `node_modules` 未改一行；该问题应向 HyperFrames 上游报告，待上游修复后移除此适配。
- **真实前后证据**（`spikes/editor-canvas/evidence/bug-001/`）：同一 revision 下，旧路径（CLI 默认 dedup）1.5s 帧底部黑 **86 行**；修复后 **0 行**，底部中心像素为场景背景色（与 `#1d4ed8` 距离 2），MP4 与同 revision worker frame 的差异约 **1.1%–1.4%**（阈值 24，编码/抗锯齿容差），人工布局工程的底部 logo 在 MP4 与 worker frame 的位置误差 ≤8px。baseline、人工布局、960×720（4:3）三种工程均验证；旧 P3-006-B 证据（含 86 行黑带 PNG/JSON）原样保留。
- **回归**：新增真实渲染测试 `packages/video-engine-worker/test/render-band.integration.mjs`，覆盖 baseline、人工布局（底部 logo 证明 y>560 内容存在）与 4:3 静态工程，各 0.5s/1.5s 两个时刻，解码 MP4 与同 revision worker frame 对照；旧实现会因底部黑行/背景不到底失败。

## 定位过程（证据化）

1. 用真实 worker `render` 复现：H.264/1280×720/30fps/150 帧/5s 全部通过，但 1.5s 解码帧 y≥633 黑；同 revision `frame` PNG 完整。
2. 直接运行 HyperFrames CLI `render --debug` 并检查捕获阶段：debug 复制件中第一张捕获（streaming）JPEG 实际是完整 720p；改为 `png-sequence` 后输出帧从 y=633 开始黑，说明**不是编码/封装**，而是捕获图片本身在后续帧开始缺底。
3. 对 CLI 捕获函数做**临时诊断插桩**（复制包到 `/tmp`，未进入交付树）：前 25 张 static-dedup 验证截图 `window.innerHeight=720` 且完整；验证页关闭后的正式捕获 `page.viewport()=1280×720` 但 `window.innerHeight=633`、`documentElement.scrollHeight=720`，从 y=633 起黑，正好等于视口高度。
4. 对照实验：`HF_STATIC_DEDUP=false`（不建验证页）→ 黑带消失（5s 单场景 render 约 10.6s，默认 dedup 约 9.3s）；`HF_STATIC_DEDUP_VERIFY=false`（去重但跳过验证页）→ 也消失，但这是未验证的静帧复用，正确性风险更高，不采用；临时强制 `captureBeyondViewport=true` → 也消失，但上游未暴露该开关，不属于可交付适配。
5. 排除项：ffprobe 元数据、H.264 编码尺寸/帧数、ffmpeg 组装、worker frame 路径、模板布局/颜色、layout/style 覆盖语义（bug 在 BUG-001 前已存在于 baseline，与 P3-006-B 无关）；legacy fixture 页面内容高于视口，`captureBeyondViewport` 保持 true，故一直无黑带，与根因一致。

## 为什么选择禁用 dedup（而不是裁切/补色/改第三方包）

- 任务要求保留原始工程构图，不能用裁切、拉伸、放大、事后补色掩盖；禁用 dedup 只是跳过一项上游性能优化，输出像素来自同一 DOM 的完整 720p 截图，构图/时序/颜色均不变。
- 不改 `node_modules` 充当固定包；不静默升级上游；不依赖未验证的静帧复用（`..._VERIFY=false`）。
- 代价：长静帧工程的渲染失去去重收益，捕获帧数增加。5s 单场景实测默认 dedup 约 9.3s、关闭约 10.6s（同一 `/tmp` 诊断 demo）；交付证据里的 worker render 墙钟受快照/队列/负载影响更大，不做严格性能承诺。默认 `timeoutMs=120000` 的既有 render/取消/超时链在 12/12 真实测试中通过。若后续上游修复验证页生命周期，可移除该 env。

## 验证（自述，待独立复审）

| 项 | 命令 | 结果 |
|---|---|---|
| worker 单元/契约 | `npm test --prefix packages/video-engine-worker` | **40/40**（约 32.5s） |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **12/12**（约 223.3s；含新增 render-band 回归 72s） |
| client | `npm test --prefix packages/video-engine-client` | **20 项：19 pass + 1 opt-in skip**（0.3.1 打包测试通过） |
| 前后证据 | `node spikes/editor-canvas/scripts/render-band-evidence.mjs` | `evidence/bug-001/render-band-evidence.json`：baseline/edited/ratio before 黑 86 行、after 0 行；after 底部场景色距离 2；MP4 vs worker changedPct 1.14%–1.42% |

`render-band.integration.mjs` 断言：MP4 H.264/30fps/帧数=时长×30；底部黑行=0；底部中心为场景背景色（±14）；整帧与底部 90px 带与 worker frame 差异 ≤2%（阈值 24）；人工布局的底部 logo 在 MP4/worker 均存在且 bbox 误差 ≤8px。旧实现（dedup 默认）在该断言下失败，新实现通过；旧 `evidence/p3-006b` 的 86 行黑带证据未覆盖。

## 兼容性与固定包

- 两包 **0.3.1**；JSONL v1、22 方法不变；layout/style/覆盖标记/字段级合并语义与 0.3.0 验收行为一致；旧工程与 P2 legacy fixture 可继续打开/渲染；render/cancel/timeout/cleanup/快照生命周期回归通过。
- 固定包（`artifacts/engine/82f6219/`，ignored artifacts，保留旧 `4c087ef/`、`74294e6/`、`df4b74f/`）：

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.3.1.tgz | 3 | 7408 | `dcb939b023e351b4299e3789e8fbf2528083f726e74164da1c6f2fe42ce7e92b` |
| dsh-video-engine-worker-0.3.1.tgz | 14 | 55568 | `31c2ed850d445e588d8063cc95a1e57cde1a994cd732c4912bc6c4e9481be8a7` |

`package-verify.json`：每文件与 `82f6219` 逐字节一致、重复 pack 一致、`git archive 82f6219` 干净检出重新 pack 一致；未安装、未发布。

## 未测项 / 风险

- 未在非 macOS 平台验证；未验证有音频/视频、任意 HTML/JS、跨平台 GPU 路径；未改上游包，若 HyperFrames 后续版本改变 dedup/页面生命周期，需重新回归或移除适配。
- 禁用 dedup 会增加长视频/高静帧工程的渲染耗时与资源占用；未做长时间大工程性能与内存实测，render 默认 120s 超时/取消仍按既有链工作。
- 上游验证页导致主页面丢失 viewport override 的缺陷只是被绕过，不是上游根因修复；后续若恢复 dedup 需先确认上游已修复，并让回归继续保护。
- 4:3 工程由静态 fixture 提供（worker 真实 render/frame 路径），未扩展 `project.create` 画布比例 API；本轮不新增该能力。
- 验收状态：BUG-001 的关闭由总调度复审固定提交后确认；本文与证据为开发自述，不冒充独立验收。
