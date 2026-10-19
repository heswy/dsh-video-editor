# P0-006 真机验证记录：0.1.3 侧栏入口与极简工作区

日期：2026-10-17（Asia/Shanghai）。
执行：原 DSH 会话，原 `dsh/p0-mode-shell` worktree。
版本记录：收到并开工的指南文档提交 `0767d8d`；功能基线 `51c82a9`、交付记录 `f5eed41`、复审 `P0-005-review-02`。
授权：用户明确授权按本指南用 `0.1.3` 替换当前 `0.1.0` 并验证；明确不重启应用、不使用全局坐标/键盘/个人剪贴板；无法安全验证的项目如实记录。用户随后明确允许把 DSH 窗口切到前台（仅用于本验证）。
Host：实际运行 **Desktop `0.2.1-rc.1`**（应用实例 PID 61333 启动于 15:46:33，早于本次安装；应用侧已从上一轮记录的 0.2.0-rc.2 升级，非本轮重启；安装日志 `operation-jYIGtB` 时间 15:56:22）。

## 1. 安装与加载

| 项 | 安装前 | 安装后 |
|---|---|---|
| profile 依赖 | `…/artifacts/p0-mode-shell/a31ee51/dsh-video-0.1.0.tgz` | `…/artifacts/p0-mode-shell/51c82a9/dsh-video-0.1.3.tgz` |
| 已安装版本 | 0.1.0 | 0.1.3 |
| 已安装 client.js SHA-256 | `07f1ff2a…c2c46b` | `6ecbc5092f6cd1caab58a41bbe14db97418e046b156cb2a3a5152224b6adcffe` |

- 安装路径：`plugin_manager install_bundle`，target 为复审固定包 `…/artifacts/p0-mode-shell/51c82a9/dsh-video-0.1.3.tgz`（SHA-256 `82def6de6129333179e015b9e841d967517ccc0def92cc48f677f0082a77f897`，15,074 bytes）。
- 结果：`stage: "enable"`、`enabled: true`、`application: "applied"`、`warnings: []`、bundle `dsh-video` `version: 0.1.3`；pnpm 更新 `dsh-video 0.1.0 → 0.1.3`，退出码 0。**未要求 restart，未重启应用。**
- 文件一致性：安装目录 9/9 文件（client.js/index.js/cordis.patch.yml/icon.svg/locale×2/README/package.json/LICENSE）与固定包解包逐字节一致。
- 插件行：`plugin_manager list_plugins` 中 `include:dsh-video` `enabled: true`、`fiberPhase: active`；旧 0.1.0 固定包仍在 artifacts 目录保留，可回滚。

## 2. 真实页面：入口与工作区

只读 `cordis_inspect_query` Client `Slots` 与宿主真实窗口截图（窗口位于 (0,33) 1470×923）：

- `sidebar.panellist` occupants：`plugins order 0`、`schedules order 10`、`dsh-context order 20`、**`dsh-video order 30 active`**；`sidebar` 子 Slot 顺序仍为 brand.mark → panellist → footer.action → toggle.badge → settings → **workspaces** → brand.name（0.2.1-rc.1 未改变 P0-005 核实的拓扑）。
- `main` occupants 含 `dsh-video` active；`conversation.header.leading` occupants 为**空**（旧顶部胶囊不再注册）。
- AX 真实几何：`上下文洞察` pos=(14,267) 252×36，**Vedio Editor** pos=(14,307) 252×36，工作区搜索/新建按钮在同列 y≈357；即入口在「上下文洞察」之后、「工作区」之前，与规格一致。行 title/desc 为 `Vedio Editor`（拼写一致），图标为细线条视频符号，选中时显示宿主原生高亮（见证据 02）。
- 会话顶部 header 截图无「普通｜视频」胶囊（证据 06）。
- 进入视频面板后：顶栏只有左侧轻量「返回对话」（返回箭头+文字）与右侧「显示选项」图标按钮；主区只有居中「尚无工程」；无徽章、宣传标题、解释段落、未来提示、底部状态栏或创建/导出/时间线/预览按钮（证据 03）。
- 入口选中时 AX 行高亮、点击后窗口标题从会话名变为产品名 `DeepSeek Harness`，返回后恢复会话名；两个真实 enter→return 往返未出现空白/卡死。

**操作通道说明**：本轮使用用户授权的窗口前台切换 + **绑定 DSH 的定向可访问性动作**（AXPress 侧栏行/会话行/侧栏折叠按钮、AX 只读几何/焦点查询）+ 窗口截图；**没有**使用全局坐标点击、全局键盘/粘贴、个人剪贴板或系统设置修改。

## 3. 已实测结果

| 项 | 方法 | 结果 |
|---|---|---|
| 入口位置/文字/图标/原生选中 | 真实截图 + AX 几何 | PASS（证据 01/02；order 30，紧接 dsh-context 后、工作区前） |
| 旧顶部胶囊移除 | 会话 header 截图 + Slots | PASS（leading occupants 空；证据 06） |
| 极简空工作区 | 面板截图 | PASS（只有「返回对话」「显示选项」「尚无工程」，证据 03） |
| 进入视频工作区 | 定向 AXPress `Vedio Editor` | PASS（真实页面切换，窗口标题变产品名） |
| 返回对话 | 定向 AXPress 当前会话行 | PASS（会话恢复；两轮往返无空白） |
| 侧栏折叠/展开 | 定向 AXPress 收起/打开侧边栏 | PASS（macOS 折叠时整列隐藏，行在 AX 中变为 36×36；展开后恢复 252×36） |
| 视频面板中停用 | `plugin_manager set_bundle false` | PASS：`application: applied`，页面自动回到对话、无崩溃；sidebar/main 注册消失，行消失（证据 04） |
| 重新启用 | `plugin_manager set_bundle true` | PASS：`application: applied`，行与 main 恢复、插件行 active；入口可再次进入面板（证据 05） |
| 版本/文件/激活 | profile 依赖、文件 SHA、plugin_manager、Slots | PASS（0.1.3、9/9、applied、active） |

## 4. 无法安全验证 / 未测（如实保留）

**主因**：该 Host 中 `main` 面板内容未暴露给辅助功能树（AX hit-test 返回无子节点的 AXGroup，AX 窗口树仍只有会话/侧栏内容），且任务禁止全局坐标/键盘；因此面板内控件与焦点无法用定向通道操作。以下项目**未测**，不以本地组件测试或截图冒充真机通过：

1. **插件「返回对话」按钮**：无法定向 AXPress；本轮用宿主会话行返回验证了状态恢复，但按钮本身未真机点击。人工步骤：进入视频面板后点击左上「返回对话」，确认回会话、Session/草稿不变。
2. **显示菜单打开/移焦/Escape 回焦/Tab/Shift+Tab/勾选持久化**：面板内控件不可定向访问。人工步骤：点右侧显示选项 → 焦点应到「简化界面效果」；Escape 回焦按钮；Tab 第一次关闭并回焦按钮、再 Tab 正常离开；勾选后关闭/重开面板确认持久化。
3. **浅色/深色主题、字号**：侧栏底部设置/账号控件未出现在可定向 AX 树中；未改设置。人工步骤：设置→通用→外观/字号切换，确认入口与面板可读、字号跟随，测试后恢复。
4. **窄窗**：尝试 AX 设置窗口尺寸时用户切换到其它应用，resize 未生效（窗口仍为 0,33,1470×923）；期间一张区域截图拍到其它应用内容，已立即删除、未读取/未入库。**未测**。人工步骤：收窄窗口至约 1000px，确认入口/面板不溢出、return/display 仍可用。
5. **草稿/引用/附件保持**：无安全定向文本输入通道（禁止个人剪贴板/全局键盘）。未测；需专用静态会话人工补测。
6. **静态阅读位置**：本地无「有历史且无新输出」的专用静态会话，未用活跃任务会话凑证据。未测；人工步骤：打开有历史的静态会话，滚动后往返，确认锚点恢复。
7. **冷启动/首次加载**：未重启、未刷新页面，未测；console 通道不可用；系统 reduced-motion 未改；no-drag 拖动需指针输入，未测。
8. **真机 console**：无通道；可见页面在多次 enter/return、折叠、停用/重启用后保持完整可交互，无可见白屏/组件缺失，但不能据此宣称 console 无错误。

## 5. 恢复与最终状态

- 插件：**已安装、已启用 0.1.3**（用户授权替换）；旧 0.1.0 固定包保留可回滚；未手改 profile。
- 应用：**未重启**（PID 61333，启动 15:46:33，安装 15:56:22）；窗口位置/尺寸保持 (0,33) 1470×923；侧栏展开；当前为普通会话，面板未激活。
- 设置：未改主题/字号/系统 reduced-motion；未改任何系统设置。
- 内容：未创建草稿/引用/附件，未发送模型请求，未使用个人剪贴板；未改会话内容。
- 代码/仓库：未改功能代码；仅新增本记录、任务记录与去标识证据；未 push。
- 事故边界：窄窗尝试时前台被用户切到其它应用，resize 失败无副作用；一张含第三方的区域截图已立即删除，未读取/未入库。

## 6. 证据

入库（去标识裁剪，侧栏只保留导航区、不含工作区会话名；`docs/research/evidence/P0-006/`）：

- `01-sidebar-entry.png`：入口位于「上下文洞察」之后、「工作区」之前，文字 Vedio Editor + 细线条图标（未选中）。
- `02-sidebar-entry-selected.png`：同一入口的原生选中高亮。
- `03-video-panel-empty.png`：视频面板仅「返回对话」「显示选项」+「尚无工程」。
- `04-after-disable-sidebar.png`：视频面板中停用后侧栏行消失、页面回会话。
- `05-after-reenable-sidebar.png`：重新启用后入口恢复。
- `06-conversation-header-no-capsule.png`：会话顶部无旧「普通｜视频」胶囊。

本地原始截图（含会话内容，未入库）：`/tmp/p006-live-normal.png`、`/tmp/p006-video-1/2.png`、`/tmp/p006-return-1/2.png`、`/tmp/p006-focuspress.png`、`/tmp/p006-collapsed.png`、`/tmp/p006-after-disable.png`、`/tmp/p006-after-reenable.png`、`/tmp/p006-final-conversation.png` 等。

## 7. 结论

0.1.3 已在真实 Host `0.2.1-rc.1` 上安装并激活；侧栏入口的位置/文字/图标/原生选中、旧胶囊移除、极简空工作区、真实进入/返回、侧栏折叠、视频面板中停用自动回会话与重新启用恢复均通过。显示菜单焦点、插件返回按钮、主题/字号/窄窗、草稿/引用/附件、静态阅读位置、冷启动与 console 因安全定向通道限制未测，附人工步骤。功能代码未改；交主会话验收。
