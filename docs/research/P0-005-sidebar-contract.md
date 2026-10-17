# P0-005 侧栏入口与克制空工作区：契约核实与实现记录

日期：2026-10-17（Asia/Shanghai）。
执行：原 DSH 会话，原 `dsh/p0-mode-shell` worktree。
版本记录：功能 base `6f11ced`；收到本指南的文档提交与开工时实际 HEAD 均为 `bf0502b`（`docs: hand off sidebar redesign and P0 lifecycle review`）。
授权：实现、本地检查、生成新固定包并提交复审。**不安装/不替换插件、不启停、不改 profile、不重启、不 push/merge。**
遵守 P0-004 事故后的真机操作边界：本轮**没有**使用全局坐标点击、全局键盘/粘贴事件、窗口聚焦、个人剪贴板或系统设置操作；契约核实全部来自只读 Slots inspection 与宿主包源码阅读。

结论：**用户指定的精确位置有原生支持**——`sidebar.panellist` 是 root list，按 `order` 升序渲染成宿主导航行，位于「新建会话」按钮之后、`sidebar.workspaces`（工作区/会话浏览区）之前；现有内置行为 order 0（插件）、10（自动化任务）、20（上下文洞察），本插件注册 `id: dsh-video, order: 30` 即精确落在「上下文洞察」之后、「工作区」分组之前。无需 DOM/overlay/侧栏替换。代码、正式合约测试与 `0.1.2` 固定包已产出，待主会话复审；当前安装的 `0.1.0` 未替换。

## 1. 本轮收到的最新约束

- 产品：左侧导航在「上下文洞察」之后、「工作区」之前单入口 **Vedio Editor**（拼写严格保留）+ 细线条视频图标；移除两处顶部胶囊；选中态来自宿主；不改变 Session/模型/权限/草稿（`PRODUCT.md` D011）。
- 设计 v0.2：侧栏行与宿主原生导航一致，图标 18–20px 建议、currentColor、无彩色贴纸/厚玻璃；无工程主区只保留「尚无工程」一句；返回对话放顶栏轻量操作；显示偏好收进单一可访问菜单；删除旧徽章/宣传标题/两段说明/未来提示/底部状态栏（`FRONTEND-DESIGN.md` §当前约束、D012）。
- 任务：先核实 `sidebar.panellist` props/排序/图标/选中/卸载契约；保持 `main` + `layout.selectPanel`；新入口与主面板组成可达、可回滚、可重试的生命周期；其它导航条目共存；无法准确排序时必须报告限制（`P0-005` §目标与位置）。

## 2. 原生导航位置契约（0.2.0-rc.2 只读核实）

### 2.1 活体 Slot 拓扑与轴

`cordis_inspect_query` Client `Slots.listSubTree`：

- `root=sidebar`（single/root，被 ui-sidebar 占用）声明的子 Slot 顺序为：
  `sidebar.brand.mark` → **`sidebar.panellist`（list/root）** → `sidebar.footer.action` → `sidebar.toggle.badge` → `sidebar.settings` → **`sidebar.workspaces`（single/root，工作区与会话浏览区）** → `sidebar.brand.name`。
- `root=sidebar.panellist`：
  - purpose：`Global panel icons.`
  - catalog：`Each list id addresses the matching main panel; the sidebar owns the button and resolves its label from list metadata.`
  - registration 轴：`id`（必填，string）、`order`（number，升序位置，默认 0）、`label`（string | () => string，展示文本/可访问名/折叠提示）。
  - ownerProps：`{ size: number; /** Requested square edge in pixels. */ active: boolean; /** Whether this panel is selected in the main column. */ }`。
  - 当前 occupants：`plugins order 0`、`schedules order 10`、`dsh-context order 20`（均 priority 0）。

### 2.2 宿主渲染源码证据（`@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`，只读 app.asar）

- 行组件 `PanelRow`：

```js
const active = usePanelInfo((info) => info.activePanelId === id);
<button className={clsx(panelRow, active && panelActive)}
        aria-label={label} aria-current={active ? "page" : undefined}
        onClick={() => selectPanel(id)}>
  <span className="panelGlyph" aria-hidden="true">
    {renderSlot("sidebar.panellist", { size: wide ? 16 : 18, active }, { only: id })}
  </span>
  {wide && <span className="panelTitle">{label}</span>}
</button>
```

- 列表位置：`panels.length > 0 && <nav className="panelList" aria-label={t("panels.label")}>…</nav>` 渲染在「新建会话」按钮与 `regionArea`（`renderSlot("sidebar.workspaces")`）之间；`panels` 来自 `entriesOfSlot("sidebar.panellist")`，按 `(order ?? 0)` 升序。
- 选中与导航：行内 `usePanelInfo` 只读宿主布局 store；点击调用 `ctx.layout.selectPanel(id)`，id 必须对应已注册的 `main` key。
- 行样式（原生规范）：展开态 `min-height:36px; gap:8px; padding:7px 8px; margin:0 2px; border-radius:var(--dsw-radius-md); color:var(--dsw-alias-label-primary)`；hover/active 背景 `--dsw-alias-interactive-bg-hover`；`focus-visible` 用宿主 focus ring token；折叠态行 36×36 图标-only + 宿主 tooltip（label）。
- 折叠/展开：`wide` 时图标请求尺寸 **16px**、折叠时 **18px**；label 只在展开时可见，折叠时作为可访问名与 tooltip。

### 2.3 Slot 注册语义（`@deepseek-ai/dsh-client-ui-slots/lib/index.js`）

- list 注册必须有 `id`；同一 id 同一 priority 冲突抛错；不同 id 共存；注册 disposer 从 ledger 移除并释放。
- ledger 条目按 priority/order 维护；`entriesOfSlot(key)` 返回每个 id 的 winner；`entries(key)` 为原始 ledger（用于冲突诊断）。侧栏投影只使用 `entriesOfSlot`。
- 声明生命周期由 `ctx.slots.inject(key, callback)` 绑定：声明存在时立即运行、未声明时等待、折叠时 dispose、再声明时重跑。

### 2.4 位置结论

| 内容 | 宿主顺序依据 | 结果 |
|---|---|---|
| 工作区 / 会话浏览区 | `sidebar.workspaces` 是 `sidebar.panellist` 的**后声明兄弟**，整个面板列表渲染后才渲染 regionArea | 任何 panel row 都在「工作区」分组之前 |
| 插件 / 自动化任务 / 上下文洞察 | 现有 list order 0 / 10 / 20 | 本插件 `order: 30` 精确排在其后 |
| 精确边界 | `Vedio Editor` 行之后紧接 regionArea 中的「工作区」分组头 | 满足「上下文洞察之后、工作区之前」 |

限制与说明：

- 行间距、颜色、hover/selected/focus 全部由宿主 row 渲染，插件不另建样式；图标由宿主按展开/折叠请求 16/18px（设计建议 18–20px 是视觉参考，本机契约以宿主请求尺寸为准，插件尊重 ownerProps 并提供 16-unit `currentColor` 线条 symbol）。
- label 来自插件 locale thunk，宿主自行投影；折叠时显示为 tooltip/可访问名，插件不自行绘制第二个侧栏或 HTML 文本。
- 若未来宿主改变 list 与 workspaces 的兄弟顺序，位置需重新核实；本记录是 0.2.0-rc.2 的事实。

## 3. 移除的旧顶部方案

- 不再注册 `conversation.header.leading`；删除 `ModeSwitch`/`LeadingModeSwitch`、胶囊 style、`thumbOrigin` 一次性滑动提示、`introPlayed`、`dv-stage` 卡片、品牌行、底部状态栏以及全部解释性/未来能力文案。
- `dsh.client.inject` 中不再需要 `@deepseek-ai/dsh-client-ui-conversation`（旧胶囊所在会话头的激活顺序依赖），已改为空数组；插件仍通过 `ctx.slots.inject` 等待声明。
- 新的入场动效仅为面板 160ms 轻微淡入；简化效果或 `prefers-reduced-motion` 时直切。侧栏行本身没有额外动效，选中反馈由宿主提供。

## 4. 实现摘要

### 4.1 注册与原子生命周期（`client.js`）

- `ctx.slots.inject('main', registerPanelAndEntry)`：`main` 声明生命周期创建链。
- 链内 `ctx.slots.inject('sidebar.panellist', acquirePair)`：每个侧栏声明生命周期尝试获取一对：
  1. 查 `sidebar.panellist` 的 `entries`：枚举不可用 → 诊断并放弃；若已存在同 id 条目 → `sidebar-entry-conflict` 并放弃；
  2. 复查 `main` key 占用；
  3. **先注册视频面板** `{ name:'main', key:'dsh-video', locale, inject:navigation }`；
  4. **再注册侧栏入口** `{ name:'sidebar.panellist', id:'dsh-video', order:30, label: sidebarLabel, locale }`；失败同步回滚面板并报告；
  5. 记录本对 disposer；侧栏声明折叠时 **先撤入口、再撤面板**（避免留下可点击但 selectPanel 会抛错的行），并在宿主仍选中本面板时兜底 `selectPanel(null)`；`main` 声明折叠时关闭整链；声明恢复后自动重试。
- 其它侧栏条目只读共存：除同 id 冲突外不检查、不替换、不排序其他条目；面板/入口 disposer 只移除自己。
- label 使用 `ctx.locale.bind(NS)` 的 thunk（`nav.label`），英文/中文均严格为 **Vedio Editor**；locale 变化时宿主重读。
- 选中态完全由宿主：侧栏行 `usePanelInfo` 与点击 `selectPanel(id)` 是宿主代码；插件面板内不保存模式布尔值。

### 4.2 面板视觉结构（无工程）

- 根：`div.dv-root`（`data-simplified`、`data-panel`），容器查询 `dsh-video`，字号 `var(--dsh-content-font-size)`。
- 顶栏：52px 高，`data-window-drag`，左侧轻量「返回对话」（chevron + 文本，`aria-label`/`title`），右侧一个 32×32「显示选项」按钮（`aria-haspopup="menu"`、`aria-expanded`、`aria-controls`、可访问名）打开单一菜单；菜单项 `role="menuitemcheckbox"` + `aria-checked`，Escape 关闭；macOS 下按 `--dsh-frame-top-clearance` 避让窗口 chrome，侧栏折叠时按 `--dsh-frame-leading-clearance` 避让 shell 控件。
- 主区：flex 居中，仅一句 `<p>尚无工程</p>`（次要文本色）；返回失败时在其上方显示 `role="alert"` 的就近错误（无失败不显示）。
- 无工程时不出现徽章、宣传式标题、解释段、未来提示、底部状态栏、创建/导出/时间线/预览按钮；无玻璃卡片、渐变光晕或装饰动画。

### 4.3 可见文案（唯一来源：`client.js` 字典）

| key | zh | en |
|---|---|---|
| `nav.label` | Vedio Editor | Vedio Editor |
| `video.back` | 返回对话 | Back to conversation |
| `video.empty` | 尚无工程 | No project yet |
| `video.display.label` | 显示选项 | Display options |
| `video.display.simplified` | 简化界面效果 | Reduce UI effects |
| `video.error.back` | 返回对话失败，请重试。 | Could not return to the conversation. Try again. |

侧栏行可见文本由宿主渲染 `nav.label`；面板内不重复显示入口名。

## 5. 本地验证（本轮实跑）

```
node --check client.js / index.js        → ok
node scripts/check.mjs                   → 26 passed, 0 failed
node scripts/smoke-client.mjs            → 25 passed, 0 failed
npm pack --dry-run --offline             → dsh-video-0.1.2.tgz, 9 files
```

smoke 覆盖（真实声明生命周期语义的 fake runtime，未通过改桩规避真实等待）：

- 侧栏晚到 / main 晚到：二者成对出现，之前零注册；
- 与内置 3 行共存，`order 30` 不被覆盖、不替换其它条目；
- 侧栏 id 冲突 / main key 冲突：整对拒绝并报告；
- 侧栏注册失败：面板同步回滚；main 注册失败：不出现入口；
- slot 枚举不可用：不抛错、零注册、报告；
- 侧栏折叠（视频选中）：整对释放并回会话；main 折叠：整对释放；重复声明恢复；
- 其它面板选中时不抢占；3 轮折叠/重声明无重复、无 cleanup 错误；
- 卸载（视频选中/其它面板选中）：只清自己的注册，按条件回退；
- 面板内容与空状态文案、显示菜单 `menuitemcheckbox`/`aria-*`/Escape/持久化、损坏偏好回退、存储异常容错、侧栏图标 owner props/currentColor/16-unit。

**真实页面未验**：当前安装的 `0.1.0` 仍是旧顶部胶囊版本；`0.1.2` 未安装。按事故后规则，本轮没有用全局坐标/键盘/窗口聚焦去操作页面；侧栏行的真实像素位置、图标观感、展开/折叠、主题、窄窗、字号、键盘 Tab/焦点、启停与卸载回退等，需在用户授权安装 `0.1.2` 后用安全定向通道验收。不以契约或 mock 截图替代真机验收。

## 6. 固定包与状态

- 实现/测试/文档提交：`09b2708`（`feat: move video workspace entry to native sidebar and trim empty state`）；本记录与包摘要随后为本地文档提交（未 push）。
- 包版本：`0.1.2`；tarball：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/09b2708/dsh-video-0.1.2.tgz`；SHA-256：`f33804af5c3baa850dce99b6ffdecfbedda1fd24f82b845d18563bbf39d6952b`；大小 14,359 bytes；9 files；解包后 9/9 文件与 `09b2708` 工作树逐字节一致（含 `client.js`、`package.json`、locale、README、LICENSE）。
- 保留历史固定包 `a31ee51/dsh-video-0.1.0.tgz`、`ab4bc68/dsh-video-0.1.1.tgz` 与旧目录归档；当前 profile 安装依赖仍指向 `a31ee51/dsh-video-0.1.0.tgz`；本轮未安装/替换/启停/重启、未改 profile、未 push。
- 引擎线（P1-002）独立并行，本轮未触碰其文件或 worktree。

## 7. 未测 / 后续（需另行授权安装新包后）

- 侧栏行真实位置/间距/图标/展开折叠/选中与 focus；与其它导航行共存的实际视觉；
- 浅/深主题、窄窗口、宿主字号放大下的面板与菜单；
- 键盘 Tab/焦点/菜单 Escape/返回；按钮可点击与 no-drag 拖动；
- 真实启停、卸载回退、main/侧栏声明重建的活体验证；
- 草稿/引用/附件保持、静态阅读位置、冷启动、console。

## 8. 状态边界

本轮遵守 DEVELOPMENT「真机操作边界（P0-004 事故后）」：未使用全局坐标、全局键盘/粘贴、个人剪贴板、窗口聚焦或系统设置修改；只读 inspection 与源码阅读不隐含这些授权。测试文件与用户目录均未写入。
