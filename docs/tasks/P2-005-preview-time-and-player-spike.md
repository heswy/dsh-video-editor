# P2-005：画面时间点预览（B 小改）+ 插件内播放隔离可行性 spike（A）

> 2026-10-17 总调度下发。用户确认优先级：**先做 B 小改（时间点抽帧预览），同时排 A spike（隔离预览面真播放）**。来源：真机验收发现「插件内无法播放」，见 [P2-004 真机验收记录](../research/P2-004-live-acceptance.md)。用户已授权正常 feature push/草稿 PR（D016）；安装/启停/重启/merge 仍不授权。

执行：**程序员 2**；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`。开工 HEAD 应为 `afd2a29`（已安装 0.2.0 的来源）；若已变化先报告实际 HEAD，不 reset、不覆盖。

## 0. 开工顺序

1. 读 AGENTS.md、`docs/STATUS.md`、`docs/DEVELOPMENT.md`、本指南、[P2-004 复审](../reviews/P2-004-review-01.md)、[真机验收记录](../research/P2-004-live-acceptance.md)。
2. 确认工作树干净、分支正确、HEAD 与基线一致；把本指南存档为本分支 `docs/tasks/P2-005-preview-time-and-player-spike.md` 并填开发记录。
3. 指导文件从协调分支取（`git fetch origin` 后 `git show origin/codex/project-foundation:docs/tasks/P2-005-preview-time-and-player-spike.md`），不切换分支。

## 1. 边界

- 允许修改：根 `client.js`、`locale/*.json`、`package.json`（版本/自身脚本）、`README.md`、`scripts/**`、相关检查、本任务记录、`docs/research/P2-005-preview-spike.md`、dev-only 原型目录 `experiments/preview/**`。
- 不要修改：`packages/video-engine-*`、`spikes/**`、`host/**` 的协议语义（B 不需要新 Host 方法；若 A 需要新 Host 能力，只写提案）、全局规则/STATUS/决策、其它 worktree；不改 profile；不安装/启停/重启；不 merge。
- 已安装的 0.2.0 链接的是 `staging-54f4671-fa7b0e2-clean`，**不要动它**；新改动走新 staging。
- 根版本升到 **0.2.1**（区别于已安装的 0.2.0）。

## 2. Phase 1（B 小改，生产代码）：画面时间点预览

目标：用户可以在插件里预览工程**任意时刻**的真实帧，不再只有固定 2.5s；不做假播放。

要求：

- 主画面工具区增加克制的「画面时间」输入（秒，范围 `0 … duration`，步进 1/30 或 0.1，label 走 locale，中英文）。
- 「更新画面」按当前画面时间调用现有 `frame`（`{projectId, revision, time}`）；成功后显示该 revision 的真实 PNG；失败/取消保留可读错误，不覆盖旧帧冒充新 revision。
- 时间越界必须拒绝或明确夹到范围内并在 UI 说明；不允许静默改成别的时刻。
- 打开工程默认时间沿用 2.5s（或上次选择），面板切换/重挂载恢复时间点与画面（现有 view memory 扩展）。
- 不新增 Host 方法、不改 worker、不加时间线/轨道/假播放按钮/自动轮播；不把 PNG 当视频。
- 回归：smoke-client 新增「frame 请求带所选 time」「越界拒绝/夹取」「重挂载恢复时间点」；check.mjs 静态断言无假播放/时间线；既有 92 项全部保持通过。
- 交付：`npm run check` 全通过（报告分项）；新固定包 `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.1.tgz`（新目录、记录大小/文件数/SHA-256）；新 staging `../artifacts/p2-b/staging-54f4671-<新提交短SHA>`（引擎仍固定 `54f4671`）；真实链证据；commit + push 更新 PR #3。

## 3. Phase 2（A spike，不落生产）：插件内播放隔离可行性

目标：回答「能否在插件内嵌入一个隔离预览面，支持播放/暂停/seek」，给后续实现任务提供可执行方案。**只出证据与提案，不改生产代码。**

必须回答：

1. **候选方案对比**：A1 sandbox iframe + 工程快照/静态预览文档；A2 复用 HyperFrames Player/Studio 的只读预览；A3 抽帧序列升级（非真播放）。比较播放/seek 能力、加载延迟、与导出画面一致性、实现复杂度。
2. **工程内容如何到预览面**：Host 只读提供工程快照（受控 `projectId`+`revision`）需要什么新能力？是否可以避免给预览面任意路径/URL；engine 是否需要新方法（如 snapshot/preview）——只写提案。
3. **隔离与安全**：iframe `sandbox` 属性、CSP、禁止网络、禁止宿主 API、不可信工程 HTML/JS 的边界；预览面不得继承插件/宿主权限；明确哪些是实测、哪些仍未知。
4. **资源**：本地字体/GSAP/Player runtime 来源（不得依赖 CDN）、离线可运行、大小与首帧延迟。
5. **一致性**：播放画面与 `frame`/`render` 是否同一内容（revision 固定、时间基准一致）。
6. **结论**：推荐方案、风险、工作量级、建议拆成哪些实现任务；未验证项如实列出。

证据要求：可用 dev-only 原型（`experiments/preview/**`，可安装固定版本 hyperframes 0.8.167 到该目录，`--ignore-scripts`，锁文件入库、node_modules 不入库），在真实 Chrome 本地打开、断网运行，截取 0.5s/2.5s/4.5s 画面或日志；证明 seek/播放与无网络。若 A1/A2 不可行，也必须有失败证据并给 A3 或替代建议。

## 4. 交付与验收

1. B 先完成：commit、`npm run check` 结果、0.2.1 固定包摘要、新 staging、真实链证据；交回后总调度复审，用户再重装验收。
2. A 再完成：`docs/research/P2-005-preview-spike.md`（结论先行、已验证/提案分开）、原型证据路径、推荐拆分。
3. 交回：两个 commit（B 生产改动、A 文档/原型）、检查结果、包/staging 路径与摘要、A 结论与风险、未测项。
4. 本轮不安装、不改 profile、不 merge、不发布；安装由用户重新授权操作。

## 开发记录（程序员 2）

- 起始：分支 `dsh/p0-mode-shell`，开工 HEAD `afd2a29`（工作树干净；无切换分支）。本指南从 `origin/codex/project-foundation` 存档到本分支。
- **Phase 1 / B 提交**：`da8a22b feat(ui): add bounded frame-time preview`（根版本 `0.2.1`）。`client.js` 增加受控「画面时间」输入、`parseFrameTime` 拒绝越界/空值、`defaultFrameTime` 打开默认 2.5s 或上次选择、`requestFrame` 按所选 time、frame 结果/view memory 恢复时间与画面；无新 Host/worker 方法，无假播放/时间线/轮播。静态检查/README/`package.json` 同步。
- B 检查：`npm run check` 全通过——静态 **34/34**、Client smoke **42/42**、Host 契约 **20/20**，合计 **96/96**。新增 smoke：默认 2.5s/请求带 time、越界/空值明确拒绝且不丢旧帧、所选 4.2s 真正进入 frame 请求、重挂载恢复 4.00s 与画面；静态断言有 frame-time 绑定、无播放/时间线/暂停/seek/自动轮播。
- **B 固定包**：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/da8a22b/dsh-video-0.2.1.tgz`，39,678 B / 17 files，SHA-256 `bb8e56339d4a633a82605c7f2f665392042905e0a10d53e3f9cbf64feccf9f3a`；runtime 文件与 `da8a22b` 逐字节一致。
- **B staging**：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-54f4671-da8a22b`；root `da8a22b07fde0f20d3d3fcacad4992161e5a444f`，engine `54f467147ae2f61e118099c4947f55e8da877500`，bundle/client/worker `0.2.1/0.1.1/0.1.1`；INTEGRITY SHA-256 `8d6eea45b338bfc8852a47ee9994f77054447407f57cd45446e81075861e6d48`；staged bridge SHA `07442c86…`，config SHA `856ea63a…`，patch SHA `5754edd8…`；bundle 16/client 12/worker 15 源文件；`npm ci --ignore-scripts`、`esbuildAvailable:true`，无 pendingBuilds。真实链证据 `artifacts/p2-b/evidence/engine-run-2026-10-17T09-23-47-072Z.json`：staging 内 Host 执行，doctor Node v24.21.0/Chrome 155.0.8059.79/FFmpeg 8.0.1；edit hf-title revision `135a529…`→`f714e71…`；PNG 279,463 B/hash `875b48c6…`；成功 H.264 MP4 135,855 B/hash `fae2687e…`（1280×720、30/1、150 帧、5s，ffprobe 独立一致）；第二次 render cancel `cancelling`→`cancelled`；close/dispose 完成。跑完后恢复受控 demo，标题回到 `让创意成为影像`，无 `· Host`。
- **Phase 2 / A**：`docs/research/P2-005-preview-spike.md` + `experiments/preview/**`（dev-only，固定 `@hyperframes/core` 0.8.167、puppeteer-core 25.14.0，锁入库、node_modules 忽略）。A1 sandbox iframe + 快照 + runtime 在真实 Chrome 离线证据通过：ready ~1.44s、seek 0.5/2.5/4.5s 约 406–440ms、state 时间一致、play 推进、pause 生效、external request 0、父页面无法读取 iframe、`navigator.onLine=false`；截图/JSON 在 `experiments/preview/evidence/`。A2 Studio/Player 源码核对认为需完整 Studio server/6.1MB UI，**不推荐作为第一版**；A3 每帧约 5.0–5.5s，不满足真播放。与 worker frame 对比 MAE≈0.78/255、95.5% 像素一致但非逐字节；推荐 engine snapshot/preview → Host 精确 snapshot route → Client iframe 的拆分，未改生产协议。
- 未安装/未启停/未改 profile/未 merge；B/A 只交复审，用户授权后安装。0.2.0 已安装保持，0.1.3 回滚包仍在。未测：真实 DSH 内 A1 CSP/iframe/焦点/主题/卸载、A2 实际嵌入、不可信代码隔离、跨平台/用户素材/音轨。
