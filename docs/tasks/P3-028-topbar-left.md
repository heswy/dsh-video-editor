# P3-028 修复：收起侧边栏后顶栏标题不居左（重复 leading 预留）

日期：2026-10-21（Asia/Shanghai）。状态：**修复与真 Chrome 组件回归完成；候选版本已收口为 0.3.0-alpha.11；未合并、未安装、未发模型；待 PR 合并、alpha.11 staging 构建/安装后真机验收。**

- 分支：`codex/p3-028-topbar-left`（base `origin/main` `9b0928e`），隔离 worktree `dsh-video-editor-worktrees/p3-028-topbar-left`
- 实现阶段只改 `client.js` 顶栏 CSS + `scripts/test-ui-polish.mjs` 回归，不改其它契约；候选版本收口（task-30）另统一 bump 到 **0.3.0-alpha.11**（package.json、check.mjs 版本断言、test-stage-version pin、README）；不安装/重启/合并/发模型

## 根因（DSH 当前 layout bundle 证据）

- darwin 折叠侧栏时宿主在 `html` 设置 `--dsh-frame-leading-clearance:160px`（给宿主自己的 title row 让出窗口控制区/seat），并设 `--dsh-frame-top-clearance:48px`；Window-chrome seat 绝对定位在 `top:11px; left:88px`。
- 插件 `.dv-topbar` 同时应用：
  1. `[data-platform="darwin"] .dv-topbar{padding-top:calc(8px + var(--dsh-frame-top-clearance,0px))}` —— 内容已垂直下移到窗口控制区下方；
  2. 通用规则 `padding-left:max(16px, var(--dsh-frame-leading-clearance,0px))` —— 又横向让出 160px。
- 结果内容被重复预留：用户真机截图返回/作品名被推到 x≈390px（不是左侧）。宿主自己的 title row 在 darwin 下只按 `leading-clearance - 20px` 处理，也印证插件不应叠加完整 leading。

## 修复（`client.js` CSS）

- `.dv-root` 新增 `--dv-topbar-leading:max(16px, var(--dsh-frame-leading-clearance, 0px));`，`.dv-topbar` 改为 `padding-left:var(--dv-topbar-leading)`。
- 新增 `[data-platform="darwin"] .dv-root{--dv-topbar-leading:16px;}`：darwin 下只保留 16px 正常内边距，不再吃宿主 leading；`[data-platform="darwin"] .dv-topbar` 的 `padding-top` 规则保持不变，继续避开顶部窗口控制区。
- 容器查询窄屏规则改为 `padding-left:max(12px, var(--dv-topbar-leading))`：darwin 窄屏取 16px，不再回填 160px；非 darwin 窄屏仍取 `max(12px, leading)`，与旧行为一致。
- 其它平台无 `data-platform=darwin` 时变量值不变（仍 `max(16px, leading)`），宿主安全预留保留；无窄容器/堆叠布局改动。

## 测试与证据

- **真 Chrome 组件 harness（`scripts/test-ui-polish.mjs`，新增 4 项）**：在真实组件页设置 `html[data-platform="darwin"]` + `--dsh-frame-leading-clearance:160px` + `--dsh-frame-top-clearance:48px`，断言：
  1. `.dv-topbar` computed `paddingLeft` ≤ 24px（实际 16px，不再被 160px 推走）；
  2. darwin 下 `paddingTop` ≥ 48px（顶部窗口控制区预留保留）；
  3. 返回/作品名 left 明显靠左（返回按钮 ≤24px、名称紧随其后）且 top ≥ 48px（不进入窗口控制区）；
  4. 清除 darwin 属性/变量后非 darwin 几何与基线一致（padding/名称位置不变）。
  同时保留原有 23 项（顶栏顺序、分隔条拖动/持久化/720px/双击/方向键/Home、内联重命名、长对话/窄屏/堆叠、portrait、播放/seek、reduced-motion、无异常）。
  实际几何：darwin `paddingLeft=16px`（旧规则会取 `max(16px,160px)=160px`）、`paddingTop=56px`（8+48）、返回按钮 `left=16/right=50/top=56`、作品名 `left=58/top=56`；恢复非 darwin 后与基线完全一致（`paddingLeft=16px / paddingTop=8px / nameLeft=58`）。截图证据：`artifacts/ui-polish/00-darwin-collapsed-sidebar.png`（忽略目录，未入仓）；证据 JSON `artifacts/ui-polish/evidence.json`。
- **仓库门禁**：`node scripts/check.mjs` **54/54**；`node scripts/smoke-client.mjs` **81/81**；`node scripts/check-host.mjs` **68/68**；`node scripts/test-ui-polish.mjs` **27/27**（计数以本次运行为准）。

## 未验证 / 风险

- **真机验收待 alpha.11 安装+重启**：已安装 DSH 内确认“收起侧边栏后返回/作品名在左侧、不进入窗口控制区”，并确认展开侧栏/非 darwin/窄窗无回归。
- 依赖 DSH 变量语义：若宿主未来改为在面板内部自行偏移或改 `--dsh-frame-leading-clearance` 含义，需要重新核对；当前按 layout bundle 证据与真机截图定位。
- 非 darwin 平台仍使用宿主 leading 作为安全预留（本次未在 Windows/Linux 真机验证）；窄屏 darwin 取 16px（旧逻辑为 `max(12px,160px)`，已修正）。
- 本任务未改 Host/worker；不含工具栏其它交互。

## 下一步

1. Lead 版本收口 alpha.11 → 构建 staging → 安装/重启；delivery-owner 真机验收：收起侧边栏顶栏居左、展开侧栏/窄窗/导出/rename/拖拽不回归。
2. 若宿主 DOM/变量再次变化，按真实证据更新 CSS 并同步本回归用例。

## 候选版本（2026-10-21，task-30）

- 统一 bump **0.3.0-alpha.11**：`package.json`、`scripts/check.mjs` 版本断言/标签、`scripts/test-stage-version.mjs` 的 `REVIEWED_BUNDLE_VERSION`、README 候选版本/安装说明；本任务卡与 handoff 版本改为 alpha.11。
- 门禁：`node scripts/check.mjs` **54/54**、`node scripts/test-stage-version.mjs` **10/10**；未改 CSS/客户端逻辑/测试断言。
- 等待 Lead 开 PR 合并、构建 alpha.11 fixed staging 并安装；重启后交付方真机验收收起侧栏顶栏居左及展开侧栏/窄窗/导出/rename/拖拽不回归。

## 合并 / 安装 / 收尾（2026-10-21）

- **合并**：PR #15 合并 main，merge `51b95dcb033f169bf6e80e663a76ef163b5b663c`（含修复 `7c8f9ae` + alpha.11 bump `ed2480e`）。**这是用户明确的“0.3.0 版本最后一次改动”**。
- **alpha.11 固定 staging**：`artifacts/p2-b/staging-alpha11-51b95dc`（root=`engine`=`51b95dc`、rootDirty=false；bundle `0.3.0-alpha.11`、client/worker `0.4.0`；INTEGRITY.json sha256 `fd080d27086fa80bea8f4b0623d823c497c6281b8974ee1e0d0a2ac89db682ab`；约 203 MB）。审计：绝对路径仅出现在 config/managed/patch/INTEGRITY（预期），bundle 运行时代码无泄漏；全部回归后 INTEGRITY sha 未变；alpha.10 staging 未动。
- **staging 回归**：`test-stage-version` **10/10**；`test-ui-polish`（仓库 client）**27/27**、以 staging client.js 字节再跑 **27/27**；`test-host-engine` **ok=true**（真实 Chrome/ffmpeg；frame PNG、demo 5s render MP4 150 帧、取消→`cancelled`；integrityVerified）；`test-conversation-chain` **261/261**；`test-conversation-preview`（real Chrome，fixed staging）**164/164**（B1–B5 全 true、staging 只读审计 same=true）；独立 verifier **PASS**。darwin 几何（staging client 字节，真 Chrome）：`paddingLeft=16px`（旧 160px）、`paddingTop=56px`、返回 `left=16/top=56`、作品名 `left=58/top=56`；清除变量后非 darwin 与基线一致。
- **安装**：真实 DSH Plugins 页安装/启用 **v0.3.0-alpha.11 / 1 of 1 运行中**；回滚保留 alpha.10 `artifacts/p2-b/staging-alpha10-1cceb96`、alpha.9 与 alpha.8 staging。
- **用户决定与未复核项**：用户明确指示“直接合码，这是 0.3.0 版本的最后一次改动”，因此 **未等待重启后的最终视觉复核即合并**；安装已成功，但“收起侧边栏后顶栏居左”的**真机视觉确认未复核**（组件/真 Chrome 几何回归已通过）。后续如用户实际使用中发现问题，从最新 main 建独立分支修复。
- **剩余观察**：非 darwin（Windows/Linux）窗口控制区/leading 行为未真机验证；宿主未来若改 `--dsh-frame-leading-clearance`/`--dsh-frame-top-clearance` 语义，需按真实证据重新核对本修复与回归用例。

