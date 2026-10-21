# P3-028 修复：收起侧边栏后顶栏标题不居左（重复 leading 预留）

日期：2026-10-21（Asia/Shanghai）。状态：**修复与真 Chrome 组件回归完成（待 alpha.11 构建/安装后真机验收）；未合并、未安装、未发模型。**

- 分支：`codex/p3-028-topbar-left`（base `origin/main` `9b0928e`），隔离 worktree `dsh-video-editor-worktrees/p3-028-topbar-left`
- 只改 `client.js` 顶栏 CSS + `scripts/test-ui-polish.mjs` 回归；不改 Host/worker/版本/pin；不安装/重启/合并/发模型

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
