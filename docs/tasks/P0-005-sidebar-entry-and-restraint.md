# P0-005：侧栏入口与克制的空工作区

执行：原 DSH 会话，继续 `dsh/p0-mode-shell` 与原 worktree。功能 base：`6f11ced`；开始前记录收到本指南的文档提交及实际 HEAD。主会话负责需求与验收，DSH 实现。先读 STATUS、DEVELOPMENT、PRODUCT、FRONTEND-DESIGN 的最新约束及 P0-004-review-01。

本轮授权：实现、本地检查、生成新固定包并提交交复审。**不替换已安装插件、不启停、不修改 profile、不重启、不 push/merge。** 不需要等待引擎线。

## 目标与位置

用户改为宿主左侧导航入口：在「上下文洞察」之后、「工作区」分组之前，显示 **Vedio Editor** + 精致细线条视频图标，拼写严格保留。原两处顶部「普通｜视频」胶囊全部移除。

1. 先按当前 Desktop 0.2.0-rc.2 的 skill/源码/只读 inspection 核实 `sidebar.panellist` 的 props、排序、图标、选中与卸载契约；确认能否准确落在指定区域。优先复用原生导航行、间距和颜色，图标使用受支持机制或小型 currentColor 线条 SVG。
2. 保留 `main` key `dsh-video` 和 `layout.selectPanel`；选中态唯一来自宿主。不添加「普通」侧栏项，不自动抢导航，不触碰会话/模型/权限。视频顶部保留轻量「返回对话」操作即可。
3. 不再依赖 `conversation.header.leading`。主面板和新入口保持可达、失败可回滚、停用安全回会话、等待声明与重声明可恢复；适配侧栏真实 list/key 契约，不能把旧 single 的占用规则原样套到整个列表上。其它导航条目必须共存。
4. 无法通过原生扩展点准确排序时，记录实际可实现位置和限制并交主会话决策；继续完成不依赖位置的精简准备。禁止 DOM/overlay 或改宿主来挪位置，也不默默退回顶部。

## 视觉与文案

- 主区无工程时只显示一句 **「尚无工程」**；不放开发阶段、接入说明、未来能力或重复小字。删除旧徽章、宣传式大标题、两段解释、未来开放提示和底部开发状态栏。
- 侧栏行跟随宿主导航样式；图标约 18–20px，以实际宿主尺度为准，轮廓简练。无夸张玻璃外框、叠层卡片或装饰动画。
- 顶栏减少 chrome，返回对话为轻量操作；已有简化效果偏好可放单个显示选项菜单，保留键盘与可访问名称。没有可用能力不出现创建/导出按钮。错误仍明确提示。
- 字号跟随宿主、浅深主题与窄宽可用，focus 清楚。过渡短、可中断，减少动效有效。删除只服务旧胶囊的 thumbOrigin/样式/文案与测试；不把已验证旧动画维护成新产品要求。

## 范围与验证

允许根插件 client/package/locale/icon、对应 scripts 测试、README、API 摘录、本任务记录及 `docs/research/P0-005-*`；不改引擎/worker、全局规则/产品决策或历史证据。

- 对新入口验证：main 与 sidebar 晚到、重复声明/折叠、注册失败/冲突、正常共存与幂等清理；无死入口/不可达面板，卸载在本面板时安全回会话，其它面板不被抢走。
- 更新旧胶囊断言为实际新契约；保持语法、manifest、locale、包白名单检查。仅为本次有风险行为增加有意义的回归，不用字符串匹配充当视觉验收。
- 版本 `0.1.2`，新提交目录产出 tarball，记录 SHA-256、包文件数与源文件一致性；保留 0.1.0/0.1.1 固定包。
- 真页面位置、图标/间距、明暗/窄窗/字号、键盘/返回、停用、草稿/引用/附件保持等在另行授权新包安装后验收。当前可交视觉结构说明；不制造假宿主截图。
- 按 DEVELOPMENT 的事故后规则禁止全局坐标/键盘/粘贴和个人剪贴板操作。只读调查也不隐含窗口聚焦、跨应用输入或修改用户设置授权。

## 交回主会话

记录 base/提交、Slot 契约与精确位置证据、删减后的可见文案、测试及包摘要、未测项。提交后停在复审，不自行安装。

## 开发记录（DSH）

- 版本记录：功能 base `6f11ced`；收到本指南的文档提交与开工时实际 HEAD 均为 `bf0502b`。执行的 Host 为 Desktop `0.2.0-rc.2`。
- 原生位置契约（只读核实，未操作页面）：Client `Slots.listSubTree` 显示 `sidebar` 的子 Slot 顺序为 brand.mark → **`sidebar.panellist`（list/root）** → footer.action → toggle.badge → settings → **`sidebar.workspaces`** → brand.name；panellist 的注册轴为 `id/order/label`，现有 occupants `plugins order 0`、`schedules order 10`、`dsh-context order 20`；`sidebar.workspaces` 是 panel list 的后声明兄弟。宿主源码（`dsh-client-ui-sidebar/lib/client.js`）：panel list 渲染在「新建会话」与 regionArea 之间、按 order 升序；`PanelRow` 用 `usePanelInfo` 取 active、`onClick: selectPanel(id)`、icon 以 `renderSlot('sidebar.panellist', { size: wide?16:18, active }, { only:id })` 渲染，label 仅展开时可见、折叠时作为 tooltip/可访问名。**结论：注册 `{ id:'dsh-video', order:30, label:'Vedio Editor' }` 精确落在「上下文洞察」之后、「工作区」分组之前，无需 DOM/overlay/替换侧栏。**证据与源码摘录见 `docs/research/P0-005-sidebar-contract.md` §2。
- 实现：移除两处顶部「普通｜视频」胶囊与全部专属样式/thumbOrigin/introPlayed/解释文案；改为 `sidebar.panellist` 单入口 + `main` 面板原子对：main 先注册、sidebar 入口后注册，入口失败同步回滚面板，任一侧声明/注册失败或折叠时先撤入口再撤面板并安全回会话，声明恢复后自动重试；其它侧栏条目只读共存；选中态完全由宿主 row 提供，插件无本地模式布尔值。面板无工程时只渲染「尚无工程」一句，顶栏仅「返回对话」+ 单一「显示选项」菜单（`menuitemcheckbox`，含简化效果，持久化 `dsh-video.ui.v1`）；错误用 `role="alert"` 就近提示；图标为 16-unit `currentColor` 细线条（宿主请求 16/18px）；字号、顶栏 chrome clearance、focus ring 使用宿主变量/token；无创建/导出/时间线/预览假控件。`dsh.client.inject` 去除已不需要的 ui-conversation 激活依赖。
- 本地检查（本轮实跑）：`node --check client.js/index.js` 通过；`node scripts/check.mjs` **26/26**；`node scripts/smoke-client.mjs` **25/25**（晚到 main/sidebar、共存、id/key 冲突、注册失败回滚、enumeration 不可用、sidebar/main 折叠、重复声明、其它面板不被抢、卸载、空状态文案、显示菜单、持久化/损坏/存储异常、图标 owner props）。`npm pack --dry-run --offline` 9 files。
- 固定包：版本 `0.1.2`；实现提交 `09b2708`；新包 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/09b2708/dsh-video-0.1.2.tgz`；SHA-256 `f33804af5c3baa850dce99b6ffdecfbedda1fd24f82b845d18563bbf39d6952b`；14,359 bytes / 9 files；解包与工作树 9/9 逐字节一致。历史 0.1.0/0.1.1 包保留。详见 `docs/research/P0-005-sidebar-contract.md` §6。
- 未安装 / 未验证：当前 profile 仍安装 `0.1.0`，`0.1.2` 未安装、未启停、未重启、未改 profile、未 push。按事故后规则未使用全局坐标/键盘/粘贴/窗口聚焦；真实页面位置、图标/间距、主题、窄窗、字号、键盘 Tab/焦点/返回、真实启停与卸载回退、草稿/引用/附件、静态阅读位置、冷启动、console 均待授权安装新包后验收。
- 引擎线（P1-002）独立并行，本轮未触碰其文件或 worktree。

