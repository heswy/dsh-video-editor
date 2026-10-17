> 历史交接：当前接手请读协调分支 [工作区索引](README.md)。本文件保留当时路径、称呼和任务状态，不作为当前开工指令。

# 交接：程序员 2 → P2-005

日期：2026-10-17。真机验收发现「插件内无法播放」后的下一任务。用户把下方提示粘贴给程序员 2 即可。

## 给程序员 2 的提示

> 0.2.0 已真机安装并通过首轮验收（入口/真实工程/画面/Tool doctor-open-frame-status 都通过，见 docs/research/P2-004-live-acceptance.md）。用户反馈：插件里没有播放器，只能导出后播放。用户定优先级：**先做 B 小改（画面时间点抽帧预览），同时排 A spike（插件内真播放的隔离可行性）**。
>
> 你的工作目录不变：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p0-mode-shell`，分支 `dsh/p0-mode-shell`，开工 HEAD 应为 `afd2a29`。先读 AGENTS.md、docs/STATUS.md、docs/DEVELOPMENT.md，然后执行 P2-005。任务指南从协调分支取（先 `git fetch origin`，不切换分支）：
> ```
> git show origin/codex/project-foundation:docs/tasks/P2-005-preview-time-and-player-spike.md > docs/tasks/P2-005-preview-time-and-player-spike.md
> ```
> 把指南存档进本分支并填开发记录。
>
> **Phase 1（生产代码）**：根插件加「画面时间」输入（0–duration，默认沿用 2.5s/上次），「更新画面」按所选时间调用现有 `frame` 拿真实 PNG；越界明确拒绝/夹取，不静默换时刻；面板切换/重挂载恢复时间点与画面；不新增 Host/worker 方法、不加假播放/时间线/自动轮播。根版本升 0.2.1。`npm run check` 全通过（现有 92 + 新增回归），出新固定包 `../artifacts/p2-b/<新提交短SHA>/dsh-video-0.2.1.tgz` 和新 staging（引擎仍 `54f4671`），跑真实链；commit + push 更新 PR #3。不要动已安装链接的 `staging-54f4671-fa7b0e2-clean`。
>
> **Phase 2（spike，不落生产）**：验证插件内隔离预览播放的可行性——候选 A1 sandbox iframe + 工程快照/静态预览文档、A2 复用 HyperFrames Player/Studio、A3 抽帧升级；回答工程快照如何只读提供（受控 projectId+revision，不允许任意 path/URL）、iframe sandbox/CSP/断网/不可信 HTML 边界、本地字体与 Player runtime 离线可用、播放与 frame/render 一致性、推荐方案与实现拆分。只写 `docs/research/P2-005-preview-spike.md` + dev-only 原型 `experiments/preview/**`（固定 hyperframes 0.8.167，--ignore-scripts，node_modules 不入库），给真实 Chrome 断网播放/seek 证据。不改 `packages/video-engine-*`、`spikes/**`、Host 协议；不改 profile、不安装/启停/重启、不 merge。
>
> **追加必修 R1（随 B/0.2.1 一起交付）**：真机深色模式下主按钮「更新画面」白底白字看不清。已核源码：`client.js` 的主按钮用了宿主不存在的 `--dsw-alias-label-on-brand`（fallback #fff），深色主题 `--dsw-alias-brand-primary` 是近白色。请改用宿主真实存在且配对正确的 token（如 `--dsw-alias-label-primary-inverted` / `--dsw-alias-brand-primary-invert`，以实际 inspection 为准），并检查其它引用不存在 token 的同类用法；浅色/深色、hover/focus-visible/disabled 都要可读。本地静态断言 + 开发记录根因/改动/验证；真实主题截图在 0.2.1 重装后由用户看、总调度记录。
>
> 交回：B 的 commit、检查结果、0.2.1 包摘要、新 staging 路径、真实链证据；A 的结论、原型证据、推荐拆分与风险；未测项。安装等总调度复审后由用户重新授权操作。
