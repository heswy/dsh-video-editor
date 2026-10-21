# P3-017 B：预览稳定性、文件/图片本地预览、产品态导出

日期：2026-10-20（Asia/Shanghai）。状态：**代码/测试/真实 Host+worker 导出实测、P3-012 真浏览器预览验收完成；已合并新 main（含 P3-016 A）并统一 bump 到 alpha.9 候选（merge `55fbed7`、bump `795acaa`）；合并后全量门禁与 real Chrome 验收（164/164）全过；未构建 staging、未安装、未重启、未合并 PR #11、未发真实模型请求。**

- 分支：`codex/p3-017-preview-export`（base `origin/main` `ec9ad47`），隔离 worktree `dsh-video-editor-worktrees/p3-017-preview-export`
- 只实现本卡 B 部分（B1/B2/B3/B4）；A 的面板宽度、工程标题 rename、设置移除由 `codex/p3-016-panel-title` 完成并已合并 main（PR #10，`61c566e`）；本分支已合并新 main 并解决顶栏/样式/docs 冲突（见“P3-018 集成”节）
- 候选版本已由 P3-018 统一 bump 到 `0.3.0-alpha.9`（`package.json`/`check.mjs`/`test-stage-version`/README）；不安装/重启/合并/发真实模型请求
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
- `scripts/check.mjs`：本卡未改其断言（出口键沿用 `video.canvas.export*`，旧手动隐藏断言仍成立）；合并 A 后由 A 扩展为 **54/54**，版本断言在 alpha.9 bump 时同步。

## 验证

### 仓库门禁（本 worktree）

合并 main（含 A）并 bump alpha.9 后的最终门禁：

| 门禁 | 基线 `ec9ad47` | B 合并前 | **alpha.9 候选（合并 main 后）** |
|---|---|---|---|
| `node scripts/check.mjs` | 52/52 | 52/52 | **54/54**（含 A 的 rename/布局断言） |
| `node scripts/smoke-client.mjs` | 78/78 | 81/81 | **80/80**（A 基线 77 + B 的 3 个 P3-017 场景） |
| `node scripts/check-host.mjs` | 65/65 | 67/67 | **68/68**（+A 1 组 + B 2 组；连续 3 次稳定） |
| worker `node --test --test-concurrency=1 test/*.test.mjs` | — | 54/54 | **56/56**（A+B 合并后全量；`cf7e593` reviewed `node_modules` 只读载体 / /tmp 副本） |
| `node scripts/test-conversation-preview.mjs --staging /tmp/p3-017-hybrid`（real Chrome） | 44/68（verifier 旧预期） | 161/161 | **164/164**（B1–B5 全 true；含 3 个 A+B 顶栏/分隔条集成断言） |
| `node scripts/test-stage-version.mjs` | 7/10（base 继承失败） | 7/10 | **10/10（转绿；REVIEWED_BUNDLE_VERSION=alpha.9）** |

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
- **结果**：`ok=true`、**161/161 checks 全过**（B1/B2/B3/B4/B5 acceptance 全 true）；其中 R2F 细项 92/92、B5 零写入、`network.external=0`。关键证据：R2-0 自动重试 2 attempts / 1558ms / 无 notice / pending 期间旧帧保留；连续失败 retention → notice → 显式 retry 切换并 release 旧快照；initial failure 两次失败后才出现完整错误、retry 51ms 恢复；R2F 3 case 几何隔离全过。证据目录：`/tmp/p3-017-preview-evidence/preview-2026-10-20T11-54-36-096Z/`（JSON + 截图，未入仓）。合并 A 后同一脚本重跑为 **164/164**（新增 3 个 A+B 顶栏/分隔条集成断言），见“P3-018 集成”节。
- **旧失败 → 新断言映射**：旧脚本 24 个失败全部是“单次失败应出现 retention notice”（R2-1/R2-3/R2-5/R2F-A/B 及由其派生的 R2F 聚合、初始失败、截图/释放断言）。新脚本对应改为：单次失败 → 自动重试恢复（R2-0）；连续失败 → retention notice（上述场景 `times:2`）；固定等待 → 事件驱动等待。没有删除或放宽任何场景断言。

### P3-018 集成：合并新 main + alpha.9 候选

- **合并**：`git merge origin/main`（main HEAD `61c566e`，含 P3-016 A）→ merge commit `55fbed7`；未 rebase、未强推、未删测试/放宽断言。
- **冲突解决**：
  - `client.js` 顶栏 JSX：保留 A 的“返回 → 左对齐作品名（内联 rename）→ 工程箭头/工程菜单”，在右侧保留 B 的 `exportControl()`；A 已删除的显示设置菜单（`menuOpen`/`onToggleSimplified`/`DisplayOptionsIcon`/`.dv-display`）保持删除。
  - `client.js` 样式：同时保留 A 的 `.dv-splitter`/`data-resizing` 样式与 B 的 `.dv-export*` 样式。
  - `docs/handoffs/README.md`：合并为“P3-016 已合并 main / P3-017 alpha.9 候选（未安装未合并 PR）”两条记录。
  - 其余文件（worker.mjs/jobs.mjs/protocol.schema.json、host/bridge.js、check-host.mjs、smoke-client.mjs、check.mjs、worker projects/registry、react-dom-lite、test-ui-polish）由 git 自动合并；合并后未发现语义回归。
- **版本/文档**：`795acaa` 统一 **0.3.0-alpha.9**（package.json、check.mjs 断言、test-stage-version pin、README），并更新 `docs/design/FRONTEND-DESIGN.md`（AI 栏 42%/320–720px/左保底 360px、窄屏堆叠；顶栏左侧作品名/箭头 + 右侧导出、无显示设置）、`docs/STATUS.md`、`docs/tasks/P3-016/P3-017`、`docs/handoffs/README.md`；不虚报安装（当前安装仍 alpha.8）。
- **合并后复验**：门禁见上表；`test-conversation-preview` 重跑 **164/164**（`ok=true`、B1–B5 acceptance 全 true、staging 只读审计 same=true、external=0、writeRequests=0）；新增 3 个集成断言证明 real Chrome 中 A 左侧作品名/箭头/分隔条与 B 右侧导出控件共存、无显示设置菜单、AI 栏宽度在 320–720px clamp 内（实测 588px）。
- **证据**：`/tmp/p3-019-preview-evidence/preview-2026-10-20T12-30-33-409Z/`（hybrid staging `/tmp/p3-017-hybrid` = reviewed alpha.8 只读 deps + 本候选源码；仅 /tmp 重建 INTEGRITY，未改 `artifacts/`）。
- **未做**：未构建 alpha.9 staging、未安装/重启、未合并 PR #11、未跑真实 DSH/模型；等 verifier 合并后整体复验 + Lead 构建/安装 alpha.9 后的真机验收。

### 未验证 / 风险

- **真实浏览器验收已补**：P3-012 预览脚本在 real Chrome（/tmp hybrid staging）合并 A 后 **164/164** 通过，覆盖 B1 自动重试/旧画面保留/retention/initial failure、B2 渲染帧差异、B3 播放/seek、R2F 几何隔离，以及 A+B 顶栏/分隔条共存；但**仍未在已安装 DSH 内嵌真实对话中做图片点击/顶栏导出按钮/rename 拖拽外观与真机安装验收**（按限制未安装/重启/不抢前台 UI），待 Lead 安装 alpha.9 后真机冒烟。
- B1 去抖的直接竞态用 fake Host 驱动 revision 轮询验证（旧快照晚到被 release、最新 revision 生效）；未在真实 DSH 里制造 3–4 连发 revision。
- 真实 120s 工程导出耗时 160s 发生在 /tmp 环境（机器/负载与用户真机不同）；产品上 20s 工程的用户真机历史实测约 111.7s，新上限 900s 有充足余量，但仍需真机确认长片导出体验。
- 真实 20s/120s 工程为 /tmp 内简单 composition；未复跑用户复杂作品（遵守不修改用户作品）。
- `test-stage-version.mjs` 在 base 上已失败（脚本固定 alpha.7 与 root alpha.8 不一致），本任务未修；需要 Lead 决定是否单独修正或由版本 bump 分支处理。
- A/B 合并冲突已在 `55fbed7` 解决（A 左侧作品名/箭头/rename + B 右侧导出；显示设置保持删除），real Chrome 164/164 覆盖共存；若 Lead 重新 rebase/改 main 仍需保留该组合。

## 下一步建议

1. verifier 对合并后的 B 分支（PR #11）做整体复验：diff/边界、门禁复跑、real Chrome 预览、A+B UI 共存。
2. Lead 合并 PR #11 → 从合并提交构建 alpha.9 固定 staging（root/engine 摘要记录）→ 按授权安装并做真机验收（导出按钮/进度/取消/下载、图片点击、连续 revision 预览、A 的 rename/拖拽手感）。
3. 保留 alpha.8 staging 与用户工程作为回滚入口；不 reset/clean/强推。

## 合并 / 安装 / 真机验收（2026-10-20）

- **合并**：PR #11 → main `573352e`（候选 merge `55fbed7`、bump `795acaa`）；顶栏冲突按“A 左侧作品名/箭头/内联 rename + B 右侧导出；显示设置保持删除”解决。
- **固定 staging（task-21）**：`artifacts/p2-b/staging-alpha9-573352e`（新建，约 204 MB；root=`engine`=`573352e`，rootDirty=false；bundle `0.3.0-alpha.9`、client/worker `0.4.0`；INTEGRITY.json sha256 `28f319b91583ae008c577f1caef9f6d89c2a7679bd710aca0a958141cfe53b9e`）。绝对路径仅出现在 staging 内 config/managed/patch/INTEGRITY（预期），bundle 运行时代码无泄漏；全部回归后 INTEGRITY sha 未变；alpha.8 旧 staging INTEGRITY `988302e9…6857` 未动。
- **staging 回归（真实环境，未安装/未发模型阶段）**：`test-stage-version` **10/10**；`test-host-engine` **ok=true**（frame PNG 273,055 B / hash `38fdf0f5…`；demo 5s render MP4 137,707 B / 150 帧 / 5.00s / 30fps / hash `c00c2fff…`；第二次 render 取消→`cancelled`；integrityVerified）；`test-conversation-chain` **261/261 ok=true**；`test-conversation-preview`（real Chrome，fixed staging）**164/164 ok=true**（B1–B5 全 true、staging 只读审计 same=true）。证据：`artifacts/p2-b/evidence/engine-run-2026-10-20T14-35-53-694Z.json`；chain/preview 运行产物在 `/tmp/p3-021-alpha9/`（未入仓）。
- **安装**：真实 Plugins 页安装/启用 alpha.9，插件页 **v0.3.0-alpha.9 / 1 of 1 运行中**；重启 DSH 后加载新 client bundle；回滚保留 alpha.8 staging。
- **真机 UI 验收（Lead）**：顶栏右侧导出按钮对 5s 工程真实导出约 **10s** 并出现下载链接；顶栏同时保留 A 左侧作品名/箭头/rename，无显示设置/简化效果。
- **剩余未验证（需用户实际操作确认）**：
  - **已安装 DSH 内嵌原生对话中的图片/文件点击**：外部 Web 页没有 native conversation kit，P3-012 real Chrome 脚本使用 inert harness faces；需在已安装 DSH 的内嵌会话中实际点击图片/文件卡，确认打开插件 overlay 且不再出现 `sidebarRight` 报错。
  - **真实模型连续修改**：alpha.9 未发真实模型请求；多轮对话修改→左侧自动更新/retention 行为待真实模型操作确认（alpha.8 已验 2 轮简单修改）。
  - **长片导出**：真机仅验 5s 工程（约 10s）；20s/120s 长片（合并前 /tmp 同源代码实测约 28s/160s）、取消/失败路径与下载耗时需用户实际作品确认；`frame` 120s / `render` 900s 拆分的长片路径真机未验。
  - 真实 DSH 中 3–4 连发 revision 的预览去抖/自动重试未制造；导出期间继续编辑的 revision 绑定只在自动化中覆盖。

## 用户最终验收（2026-10-21）

alpha.10 安装后用户最终 6 项验收全部通过：预览超时自动恢复、`read_image` fileLink 点击不再弹 sidebarRight（由 P3-022 修复）、产品态导出按钮可用；用户反馈“非常好，现在我觉得没什么问题了”。真实 20s/120s 长片导出的耗时/取消/失败路径与真实模型复杂多轮修改仍属长期观察项。

