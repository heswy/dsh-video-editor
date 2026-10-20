# P3-017 B：预览稳定性、文件/图片本地预览、产品态导出

日期：2026-10-20（Asia/Shanghai）。状态：**代码/测试/真实 Host+worker 导出实测、P3-012 真浏览器预览验收（按 B1 新契约更新脚本，real Chrome 161/161）完成；已 commit 并 push 分支，未安装、未重启、未合并、未发真实模型请求。**

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
| `node scripts/test-conversation-preview.mjs --staging /tmp/p3-017-hybrid`（real Chrome） | 44/68（verifier：旧 B1 预期，24 失败） | **161/161**（B1–B5 acceptance 全 true，见下节） |
| `node scripts/test-stage-version.mjs` | 7/10（base 既有失败：脚本仍固定 alpha.7，root 已是 alpha.8） | 7/10（失败集与基线一致；非本任务引入，未改动该脚本） |

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

### P3-012 真浏览器预览验收脚本更新（task-16 finding → task-17 收口）

verifier 的 B 验收发现旧 `scripts/test-conversation-preview.mjs` 仍按 P3-012 契约断言“单次注入 preview 失败就显示 retention notice”，与 B1“单次失败自动重试 1 次后恢复、仅连续失败才显示 notice”不一致（44/68，24 个旧预期失败；固定等待也未计入 1s revision 去抖与重试延迟）。本任务按新契约更新脚本/helper，未删弱任何原真实浏览器断言：

- **新增 R2-0（单次失败自动恢复，事件驱动）**：注入 1 次 `preview.snapshot` 失败 → 观察 target 标记 pending 期间旧 active iframe 仍挂载/可播放 → 自动重试（第 2 次请求真实成功）→ 新 revision 切换完成，全程 `sawNotice === false`；用 `observeAutoRetryRecovery`（40ms 轮询、≤40s）与 `waitForRevisionSnapshots`（轮询页面请求日志）替代固定 sleep，去抖/重试延迟自然覆盖。
- **retention notice 场景改为“连续两次失败”**：R2-1 next-revision snapshot、R2-3 candidate runtime error、R2-5 initial failure、R2F-A/B、R2 stress double-retry/unmount 的注入从 `times:1` 改为 `times:2`；notice/完整错误只在自动重试也失败后出现，并新增断言证明自动重试确实发生过（两次失败 attempt / injection hits===2）。
- **保留覆盖**：B1 首次自动预览与 publish 跟随、B2 连续两轮同工程更新、B3 真实播放/暂停/seek、R2 旧画面保留/可播放/markers/快照 route 保活/显式 retry 切换/旧快照 release、R2F 每实例几何与 duration、B5 无手动控件/手势零写入、network/console/teardown/staging 只读审计全部保留。
- **运行环境（/tmp hybrid staging，未安装/未改 staging）**：`/tmp/p3-017-hybrid` = reviewed alpha.8 staging（cf7e593）的只读 `node_modules`/config + 本分支 `b01b181` 的 bundle/client/host/worker 源码 overlay；仅对 /tmp 副本重新生成 INTEGRITY 供 `loadStagedHost` 校验（不是交付 staging，不动 `artifacts/`）。真实 Chrome 155 + 真实 Host/worker/fixed snapshot runtime；staging 只读审计 `same=true`（82 文件前后一致）；无外部网络请求、无生产写入、无用户工程。
- **结果**：`ok=true`、**161/161 checks 全过**（B1/B2/B3/B4/B5 acceptance 全 true）；其中 R2F 细项 92/92、B5 零写入、`network.external=0`。关键证据：R2-0 自动重试 2 attempts / 1558ms / 无 notice / pending 期间旧帧保留；连续失败 retention → notice → 显式 retry 切换并 release 旧快照；initial failure 两次失败后才出现完整错误、retry 51ms 恢复；R2F 3 case 几何隔离全过。证据目录：`/tmp/p3-017-preview-evidence/preview-2026-10-20T11-54-36-096Z/`（JSON + 截图，未入仓）。
- **旧失败 → 新断言映射**：旧脚本 24 个失败全部是“单次失败应出现 retention notice”（R2-1/R2-3/R2-5/R2F-A/B 及由其派生的 R2F 聚合、初始失败、截图/释放断言）。新脚本对应改为：单次失败 → 自动重试恢复（R2-0）；连续失败 → retention notice（上述场景 `times:2`）；固定等待 → 事件驱动等待。没有删除或放宽任何场景断言。

### 未验证 / 风险

- **真实浏览器验收已补**：P3-012 预览脚本在 real Chrome（/tmp hybrid staging）161/161 通过，覆盖 B1 自动重试/旧画面保留/retention/initial failure、B2 渲染帧差异、B3 播放/seek、R2F 几何隔离等；但**仍未在已安装 DSH 内嵌真实对话中做图片点击/顶栏导出按钮外观与真机安装验收**（按限制未安装/重启/不抢前台 UI），合并后仍需真机冒烟。
- B1 去抖的直接竞态用 fake Host 驱动 revision 轮询验证（旧快照晚到被 release、最新 revision 生效）；未在真实 DSH 里制造 3–4 连发 revision。
- 真实 120s 工程导出耗时 160s 发生在 /tmp 环境（机器/负载与用户真机不同）；产品上 20s 工程的用户真机历史实测约 111.7s，新上限 900s 有充足余量，但仍需真机确认长片导出体验。
- 真实 20s/120s 工程为 /tmp 内简单 composition；未复跑用户复杂作品（遵守不修改用户作品）。
- `test-stage-version.mjs` 在 base 上已失败（脚本固定 alpha.7 与 root alpha.8 不一致），本任务未修；需要 Lead 决定是否单独修正或由版本 bump 分支处理。
- 与 A 分支（P3-016）在 `client.js` 顶栏区域、`docs/check` 记录存在合并冲突风险；Lead 合并时需保留 A 的标题/面板改动与本卡导出控件。

## 下一步建议

1. Lead 审阅分支 diff 与测试计数，按需做独立验收（真实浏览器/竞态）。
2. 合并 A/B 两条分支时解决 `client.js` 顶栏冲突：A 的“返回→作品名→工程下拉”在左、B 的导出控件在右；`video.canvas.export*` 文案键沿用。
3. 合并后统一 bump 候选版本、重新跑门禁与真机安装冒烟（导出按钮、图片点击、连续 revision 预览）。
