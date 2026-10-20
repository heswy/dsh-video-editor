# P3-017 B：预览稳定性、文件/图片本地预览、产品态导出

日期：2026-10-20（Asia/Shanghai）。状态：**代码/测试/真实 Host+worker 导出实测完成；已 commit 并 push 分支，未安装、未重启、未合并、未发真实模型请求。**

- 分支：`codex/p3-017-preview-export`（base `origin/main` `ec9ad47`），隔离 worktree `dsh-video-editor-worktrees/p3-017-preview-export`
- 只实现本卡 B 部分（B1/B2/B3/B4）；A 的面板宽度、工程标题 rename、设置移除不在本分支，由 `codex/p3-016-panel-title` 另做；两分支在 `client.js` 顶栏/`docs`/`check.mjs` 有可预期合并冲突点
- 不改 `package.json` 版本（候选版本由 Lead 合并后统一处理）；不安装/重启/合并/发真实模型请求
- 真实导出用 /tmp 自建 Host+worker 快照（alpha.8 staging 的 reviewed `node_modules` 只读复用 + 本分支 worker/Host 源码），工程创建在 /tmp，未触碰任何用户作品

## 背景与根因（图 3 / 图 4 / 图 6）

1. **预览超时误报**：旧的单一 15s 计时从 `targetRevision` 变化即开始；`preview.snapshot` 尚未返回或 candidate iframe 尚未挂载也会计入，冷启动/慢快照直接显示“预览准备超时”。失败后只能手动重试，且没有 attempt 诊断；快照超时后晚到的 snapshot 也可能未 release。
2. **内嵌对话点击文件/图片报 `sidebarRight: no session surface is mounted`**：原生 chat 的 openFile → `ctx.sidebarRight.openResource` 需要 mounted session surface，插件内嵌对话没有；旧 `capturePreviewClick` 只覆盖 `a[href]`/`button[title]`/`[data-file-path]`，图片点击未拦截。
3. **产品态没有导出入口**：导出代码存在但被 `previewOnly ? null : ...` 隐藏；Host `render` `timeoutMs` 上限 120s，而 20s 工程实测约 111.7s 已贴上限；即使临时暴露也无法展示真实进度/取消/下载。

## 范围与实现

### B1. 预览状态机健壮性（`client.js` CanvasWorkspace）

- **独立预算**：`PREVIEW_SNAPSHOT_TIMEOUT_MS = 30000`（snapshot 请求自身）、`PREVIEW_READY_TIMEOUT_MS = 30000`（candidate 挂载后等待 runtime ready）。ready 计时只在 snapshot 返回且 candidate 挂载后才开始。
- **1s 稳定去抖**：产品态 revision 变化先立即更新 target 标记，`PREVIEW_DEBOUNCE_MS = 1000` 稳定后再请求；连续发布的多个 revision 只加载最后一个。首屏加载、project 切换、隐藏的手动路径（`previewOnly=false`）保持立即加载。
- **自动重试 1 次**：snapshot 失败/超时、candidate runtime error、ready 超时，均先丢弃并 release 当前 candidate，`PREVIEW_RETRY_DELAY_MS = 400` 后用新 snapshot 自动重试一次；仍失败才显示错误。已有 active 预览时旧画面保留并保持可播放，非阻塞显示“正在更新预览”。
- **无泄漏**：被新 revision 取代的 in-flight snapshot（含超时后晚到）、被丢弃的 candidate、ready 超时、卸载时的候选/active snapshot 都会 `preview.release`；卸载时同时清掉 retry/debounce 计时器。
- **有界诊断**：最近 6 次 attempt（`revision:attempt:snapshotMs:readyMs:errorCode`）通过 `data-preview-diagnostics`/`data-preview-attempt`/`data-preview-retrying` 暴露，并对每次失败 attempt 打一条有界 `console.warn`；不会随会话增长。

### B2. 文件/图片点击本地预览（`client.js`）

- `.dv-ai` 的 capture 先按旧路径（`button[title]`/`[data-file-path]`/`a[href]`）处理文件卡；新增 `img[src]` 兜底并一律 `preventDefault`/`stopPropagation`：
  - `data:image/*`、`blob:`、已加载的 http(s) 图片或 chat 同源图片路由：直接在插件自有 overlay 显示，不读 Host、不导航；
  - 本地路径（含 `.dsh-video-frames/latest.png`、`file://`、绝对/相对图片路径）：走既有 Host `preview` 受控路由（Session/project 归属、realpath 根、magic byte、字节上限）。
- 不调用/不猴补 `ctx.sidebarRight`；普通聊天点击（非文件/图片）不拦截。文件卡不支持类型仍显示准确本地文案。

### B3. 产品态导出（`client.js` VideoWorkspace + `host/bridge.js` + worker）

- 产品顶栏 `dv-export` 控件：空闲“导出 MP4” → 运行中显示真实阶段（queued/snapshot/engine/capture/validate/finished）+ 百分比（worker `Streaming frame n/N` → `progress`）+ 已用时间 + 取消 → 成功下载 artifact（`download` 文件名用现有客户端推导工程标题，非法字符清理，fallback `dsh-video.mp4`），并保留再次导出入口。
- **绑定点击时 revision**：`render` 请求、`data-export-revision`、status 校验都用点击时 inspected revision；导出期间 AI 发布新 revision 不改变当前导出，再次导出才绑定新 revision。
- **防重复点击**：同步 `exportInFlightRef` 门 + 渲染态互斥，同 tick 双点击只启动一次 render。
- 进度轮询：500ms、客户端安全网 16 分钟（Host 上限之上）、连续 5 次 status 失败才判失败；客户取消调 Host `cancel`，终态 cancelled 有明确文案。
- **Host/worker 时限**：`render` timeoutMs 上限/默认 900000ms（15 分钟），`frame` 仍为 120000ms；Host 与 worker 双向校验，`protocol.schema.json` 同步；取消/错误/artifact 语义不变（未成功不发布、取消回收 artifact）。
- 隐藏的手动导出（`previewOnly=false`）路径保持原样，check 仍验证其存在。

### B4. 测试与文档

- `scripts/smoke-client.mjs`：新增 B1 去抖+旧快照 release+诊断、B2 data/blob/remote/相对路径图片点击、B3 导出状态机（双点击、阶段/百分比/已用时间、下载文件名、revision 绑定、取消、失败重试）测试；按新语义更新 preview 失败/超时/产品态导出相关旧断言。
- `scripts/check-host.mjs`：新增 render 900000 接受/900001 拒绝、frame 120001 拒绝、合法范围、status stage/progress 透传、无绝对路径断言。
- worker：`node --test --test-concurrency=1 test/*.test.mjs`（不含 `.integration.mjs`）在复用 reviewed `node_modules` 的 /tmp 副本运行。
- `scripts/check.mjs` 未改：出口键沿用 `video.canvas.export*`，旧手动隐藏断言仍成立（52/52）。

## 验证

### 仓库门禁（本 worktree）

| 门禁 | 基线 `ec9ad47` | 当前 |
|---|---|---|
| `node scripts/check.mjs` | 52/52 | **52/52** |
| `node scripts/smoke-client.mjs` | 78/78 | **81/81**（新增 3 个 P3-017 场景 + 更新 preview/export 旧断言） |
| `node scripts/check-host.mjs` | 65/65 | **67/67**（+2 P3-017 断言组） |
| worker `node --test --test-concurrency=1 test/*.test.mjs` | — | **54/54**（/tmp 副本，复用 alpha.8 reviewed `node_modules`） |
| `node scripts/test-stage-version.mjs` | 7/10（base 既有失败：脚本仍固定 alpha.7，root 已是 alpha.8） | 7/10（非本任务引入，未改动该脚本） |

### 真实 Host + worker 导出/取消/并发实测

环境：/tmp 自建快照（alpha.8 staging `bundle`/`engine-client`/reviewed `node_modules` 只读 + 本分支 `host/` 与 worker `src/`），真实 Node 24.14.0 / HyperFrames 0.8.167 / Chrome 155 / ffmpeg 8.0.1；Host 通过 `VideoBridge` 直接执行，工程全部在 /tmp 创建。证据：`/tmp/p3-017-real/evidence.json`（未入仓）。

| 场景 | 结果 | 耗时 | artifact |
|---|---|---|---|
| 5s 工程导出（`render` timeoutMs=900000） | succeeded；阶段 snapshot→engine→capture→finished，进度真实推进 | **13.1s** | 47,255 B MP4，150 帧 / 5.00s / 1280×720 / 30fps，hash 与读回字节一致 |
| 20s 工程导出 | succeeded；capture 进度到 100% | **28.2s** | 600,593 B MP4，600 帧 / 20.00s |
| 120s 工程导出（**超过旧 120s 上限**） | succeeded；capture 进度到 100%，随后 validate | **160.3s** | 2,547,442 B MP4，3600 帧 / 120.00s；旧 120s 上限下必然超时，端到端证明 900s 时限生效 |
| 导出中并发 `frame` + 2 个 `preview.snapshot` | frame succeeded（PNG，4.1s）；render 期间快照全部成功并可 release | 4.1s | 并发竞态无失败、无 Host warning |
| 运行中取消 render | ack `cancelling` → 终态 `cancelled`；artifact 已回收 | **1.7s** | 无 artifact |

Host warnings：0。

### 未验证 / 风险

- **未做真实浏览器/DOM 点击验收**：按任务限制没有打开会抢用户前台窗口的 UI，也没有安装/重启 DSH。B2 图片点击、B1 ready 超时/自动重试、B3 顶栏进度外观只用 Node DOM shim（smoke-client）验证；真实浏览器外观/焦点/键盘仍需 Lead 合并后的真机冒烟。
- B1 去抖的直接竞态用 fake Host 驱动 revision 轮询验证（旧快照晚到被 release、最新 revision 生效）；未在真实 DSH 里制造 3–4 连发 revision。
- 真实 120s 工程导出耗时 160s 发生在 /tmp 环境（机器/负载与用户真机不同）；产品上 20s 工程的用户真机历史实测约 111.7s，新上限 900s 有充足余量，但仍需真机确认长片导出体验。
- 真实 20s/120s 工程为 /tmp 内简单 composition；未复跑用户复杂作品（遵守不修改用户作品）。
- `test-stage-version.mjs` 在 base 上已失败（脚本固定 alpha.7 与 root alpha.8 不一致），本任务未修；需要 Lead 决定是否单独修正或由版本 bump 分支处理。
- 与 A 分支（P3-016）在 `client.js` 顶栏区域、`docs/check` 记录存在合并冲突风险；Lead 合并时需保留 A 的标题/面板改动与本卡导出控件。

## 下一步建议

1. Lead 审阅分支 diff 与测试计数，按需做独立验收（真实浏览器/竞态）。
2. 合并 A/B 两条分支时解决 `client.js` 顶栏冲突：A 的“返回→作品名→工程下拉”在左、B 的导出控件在右；`video.canvas.export*` 文案键沿用。
3. 合并后统一 bump 候选版本、重新跑门禁与真机安装冒烟（导出按钮、图片点击、连续 revision 预览）。
