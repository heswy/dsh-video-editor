# P0-003 受控安装与真实页面验证记录

日期：2026-10-17（Asia/Shanghai）。
执行：原 DSH 会话（P0 worktree，分支 `dsh/p0-mode-shell`）。
授权：用户在 DSH 会话明确授权通过 DSH 支持的插件管理方式安装/启用 `P0-002-review-02.md` 指定的固定 tarball，并执行真实页面验证；随后在本轮补充授予屏幕录制与辅助功能权限。
结论：**固定包安装并启用成功；真实窗口上的核心验收项已实测通过**（模式切换往返、快速反向、玻璃胶囊真实样式、220ms 底片滑动动效、停用/重新启用、视频模式内停用安全回退、草稿文本+图片附件保留、宿主字号放大、深色主题、窄窗布局、键盘激活）。仍有个别项未测/未确证（见 §4），review-02 指出的「晚到 leading 注册失败留下不可达视频面板」边界缺陷（D-P0-003-1）仍由主会话安排修复，本轮未改动固定包与功能代码。

## 1. 安装对象与前置校验

| 项 | 值 |
|---|---|
| 固定包 | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/a31ee51/dsh-video-0.1.0.tgz` |
| SHA-256（安装前实算） | `c0257548cad4f6f737d90eee3eb7b73ac823a946732d37710ff58cbb4490bbc4`，与 `P0-002-review-02.md` 记录一致 |
| Host | DeepSeek Harness Desktop `0.2.0-rc.2`（Info.plist；app.asar sha256 仍为 `18d5036b…30f9e`） |
| Profile | `desktop`（`DSH_PROFILE_DIR=~/.dsh/profiles/desktop`） |
| 安装方式 | `plugin_manager install_bundle`（DSH 支持路径，未手改 profile 文件） |
| 安装结果 | `stage: "enable"`，`changed: true`，`application: "applied"`，`warnings: []`；pnpm 安装 `dsh-video file:…/dsh-video-0.1.0.tgz` 成功（operation log：`~/.dsh/profiles/desktop/.plugin-manager/logs/operation-aOYBjM/pnpm.log`） |

安装后 `~/.dsh/profiles/desktop/package.json` 由 Plugin Manager 写入：
`dependencies.dsh-video = "file:…/a31ee51/dsh-video-0.1.0.tgz"`，`dsh.profile.bundles` 末尾加入 `dsh-video`。未手工编辑该文件或 `cordis.patch.yml`。

安装包完整性：tarball 解包 9 个文件与 `~/.dsh/profiles/desktop/node_modules/dsh-video/` 对应文件**逐字节一致**（9/9，含 `client.js` sha256 `07f1ff2a…c2c46b`）。

## 2. 验证环境、权限与工具

- 应用未重启：本轮自始至终使用同一应用实例窗口；AX 读取到的应用 PID 3142（启动于 12:31:23），同应用另有主进程 3630（启动于 12:31:26），验证期间均未重启。窗口 bounds `(0, 33) 1470×862`（截图区域与之对应）。
- 用户在该轮逐步授予两项 macOS 权限：
  - **屏幕录制**：`screencapture -x -l <windowID>` 与 `screencapture -x -R 0,33,1470,862` 均成功；短录屏 `screencapture -v -V 6 -R 0,33,1470,862` 成功（60fps）。
  - **辅助功能**：`System Events` UI scripting 可读取窗口几何；CGEvent 事件投递返回 `EVENT_POST_WORKS`；随后可用真实鼠标点击/键盘输入/滚轮操作 DSH 窗口。
- 验证通道（全部为真实页面，未使用 DOM/React 模拟，也未引入新依赖）：
  - 真实窗口截图与屏幕录制（`screencapture`）；
  - 自建只读/操作型 Swift 工具经 AXUIElement API 读取 `role/title/description/value/position/size`、执行 `AXPress`/`AXFocus`，用于读取胶囊按钮、视频工作区控件与文本框状态；
  - CGEvent 真实点击、按键（含 Cmd+A/Cmd+V/Space/方向键）与滚轮；
  - `plugin_manager set_bundle` 做真实启停；`cordis_inspect_query` Client `Slots` 复核注册；
  - 窗口标题探针：普通模式标题为 `读取交接执行 P0-A 调查 — DeepSeek Harness`，视频模式为产品标题 `DeepSeek Harness`（宿主 `DocumentTitle` 在非会话面板时显示产品名，可作 activePanel 的旁证）。
- 仍未获得的通道：浏览器 console / renderer 日志不可见；未做页面 reload（插件在页面生命周期内启用）。

## 3. 安装与激活证据（活体）

- `plugin_manager list_plugins`：`include:dsh-video`，`moduleName: dsh-video`，`enabled: true`，`fiberPhase: active`。
- `plugin_manager list_bundles`：bundle `dsh-video` `version: 0.1.0`，`installed: true`，`enabled: true`，行 `{rowId: "dsh-video", entryId: "include:dsh-video"}`。
- Host `Config.listConfigs`：存在 `include:dsh-video` 条目，`status: "absent"`（本插件未导出 Config schema，不是激活失败）。
- **Client live Slots（`cordis_inspect_query` Client `Slots.listSubTree`）**：
  - `main`（keyed/root）occupants 含 `{ key: "dsh-video", priority: 0, active: true }`。
  - `conversation.header.leading`（single/root）occupants 含 `{ priority: 0, active: true }`；该 occupant 只在 bundle 启用时出现、停用时消失（停用/启用矩阵见 §4），因此判定为本插件的普通模式胶囊。注意其 `registrant` 诊断字段会随注册上下文在 `mf`/`dsh-video` 间变化，不能作为稳定身份，归属以启用相关性 + 真实页面渲染双重判定。
- 无 `restart-required` 或 warning。

## 4. 真实页面验证矩阵

判定口径：**PASS** = 真实窗口上观察到预期行为并有截图/录屏或 AX 状态证据；**部分** = 主路径通过但存在附加子项未覆盖；**未测** = 本轮未执行，不作为通过。

| # | 项目 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| 1 | 普通模式胶囊真实渲染 | 真实窗口截图；AX 读取胶囊 button | PASS：胶囊出现在主内容区顶部左侧、会话标题之前；浅色玻璃胶囊，选中底片在「普通」；AX 两个分段 `89×31`、`90×31`，位于 (306,48)/(395,48)，与侧栏/标题无重叠 | `evidence/P0-003/01-normal-capsule-light.png` |
| 2 | 普通 → 视频 → 普通 | 真实点击胶囊（视频段约 (446,65)、普通段约 (354,65)）；标题探针 + AX 控件 | PASS：进入视频空工作区（标题变产品名；AX 出现 `简化界面效果` 开关、`返回普通模式` 按钮、视频顶栏同款胶囊）；返回后标题恢复会话名、会话与草稿原样 | `evidence/P0-003/02-video-workspace-light.png` |
| 3 | 220ms 底片滑动动效 | 真实屏幕录制 6s@60fps，抽帧测白色底片中心 x | PASS：普通→视频，底片中心 x 从约 700.5 px 经 832 → 860.5 → 871.5 → 876.5 → 878 → 879.5（约 6 帧 ≈ 200ms）快速起步后缓出；视频→普通反向同样有中间帧（886 → 782.5 → 733.5 → 715.5 → 707.5，趋向 703.5）；新页首帧底片仍处于起点再滑动，未见「直接闪到目标位」 | 录屏 `/tmp/anim-roundtrip.mov`；抽帧 `/tmp/animf/`；入库单帧 `evidence/P0-003/06-mode-slide-frame.png` |
| 4 | 快速反向连点 | 连续「视频→普通→视频→普通」各 0.12–0.16s | PASS：最终停在普通；标题与会话正常；无空白面板、无死按钮、AX 树可继续交互 | `/tmp/stepG-2-rapid-final.png` |
| 5 | 普通模式停用 | `plugin_manager set_bundle false` ×3 轮 | PASS：胶囊与视频面板消失，会话布局/内容健康；重新启用恢复，无重复注册 | 早期窗口截图 `/tmp/dsh-disabled-live.png`、`/tmp/dsh-enabled-live.png` |
| 6 | **视频模式内停用** | 先进入视频模式，再 `set_bundle false` | PASS：页面自动回到会话（标题恢复会话名、视频控件全部消失），无需重启、无 crash；当前草稿仍在。重新启用后胶囊恢复、草稿未丢 | `evidence/P0-003/07-disable-in-video-returned-header.png`、`08-disable-in-video-draft-preserved.png` |
| 7 | 草稿保留：多行中文 + 图片附件 | 输入框粘贴 3 行中文（含标点/日期）+ 本地生成的 64×64 PNG 图片，不发送；普通→视频→普通 | PASS：往返前后输入区裁剪图 sha256 完全一致（`8ddb80c8…`）；文字、换行、图片附件 chip 原样保留 | `/tmp/stepD-2-draft-before.png`、`/tmp/stepD-4-draft-after.png` |
| 8 | 宿主字号放大 | Settings → 通用设置 → 字号大小 14 → 20（真实点击 spinner） | PASS：AX 胶囊分段由 `89×31`/`90×31` 放大为 `119×46`/`119×46`（触发上限 clamp），视频页文字同步放大且不溢出；测试后已恢复 14（尺寸回 `89×31`） | `evidence/P0-003/04-font20-capsule.png`；`/tmp/stepI-2-font20-video.png` |
| 9 | 深色主题 | Settings → 外观 → 深色 | PASS：胶囊、视频空工作区、返回按钮、状态栏在深色下可读，无样式破面；测试后已恢复浅色 | `evidence/P0-003/03-video-workspace-dark.png` |
| 10 | 窄窗 | AX 设置窗口为 1000×760 | PASS（1000×760）：侧栏折叠为 rail，宿主 leading 控件出现，胶囊按 frame clearance 右移（约 162pt 起），不遮挡红绿灯/侧栏按钮；视频模式可进入、空状态与顶栏不溢出 | `evidence/P0-003/05-narrow-video-1000x760.png` |
| 11 | 键盘激活 | AX 聚焦「视频」分段后按 Space | PASS：真实切到视频模式（标题变产品名）。**部分**：焦点环视觉未确证（程序化 AX 聚焦不必然触发 `:focus-visible`）；Tab 顺序未逐项验证 | 操作记录 + `/tmp/stepG-3-keyboard-video.png` |
| 12 | 阅读位置恢复 | 会话内滚轮上滚后往返视频 | 未确证：本会话是**正在流式产生新内容的 Agent 会话**，测试期间内容持续追加，滚动锚点被新内容推动，前后截图位置不可比。需在静态会话（有历史、无新输出）复测 | `/tmp/stepG-4-scrolled.png`、`/tmp/stepG-5-scroll-restored.png` |
| 13 | 引用 chip（@ 文件引用） | — | 未测：自动化输入 `@文件名` 未能可靠触发 mention 菜单；继续用 Enter 选择时误将草稿排入发送队列（已立即删除、未发送，见 §5 说明），为避免误发停止该项 | — |
| 14 | 减少动态效果（prefers-reduced-motion） | — | 未测：本轮未改系统「减少动态效果」设置 | — |
| 15 | 冷启动/首次挂载首帧 | — | 未测：未 reload 页面或重启应用；本轮都是在页面生命周期内启停与切换 | — |
| 16 | no-drag 拖动行为 | — | 部分：真实点击胶囊可命中并切换（说明控件可交互），但拖动标题/胶囊移动窗口的行为未测（会改变用户窗口位置） | — |
| 17 | console Slot crash / renderer 日志 | — | 未测：本会话无浏览器 console 通道。旁证：多轮切换/启停后 AX 树与页面持续可交互，未出现可见白屏或组件缺失 | — |
| 18 | 切换期间后台任务 | — | 未专门验证：本会话头部始终显示「1 个后台任务运行中」，切换/停用/启用期间未主动中断该任务，也未见 UI 报错 | — |

补充观察（非缺陷）：视频空工作区页面在同一窗口宽度下与普通模式胶囊位置/尺寸一致；启用 `plugin_manager` 停用后页面自动回退到会话，说明宿主 `retainMainPanels`/panel fallback 与插件 unload 回退路径按预期工作。

## 5. 自动化测试中的一次误操作（已清理，未发送）

用 CGEvent 自动输入 `@README` 后按 Enter 试图选中 mention 菜单时，mention 菜单未打开，Enter 把当时输入框里的测试草稿（3 行中文 + 测试图片）排入「排队发送」区。发现后立即用真实点击队列行垃圾桶丢弃该排队项，并用截图确认队列区为空；随后清空输入框。**没有任何消息被发送、没有触发真实模型请求，也没有改动会话历史**。最终输入框为空（见 §7 恢复状态）。这也说明「引用 chip」自动化路径不可靠，故该项未测。

另：尝试用 AXPress「新建会话」创建专用测试会话时，按钮 AXPress 返回成功但页面未切换（仍停留在当前会话，侧栏未出现新会话），因此草稿保留测试是在当前任务会话的**输入框草稿**中完成、全程未发送、结束后清空；没有使用或改动其它私人会话。

## 6. 缺陷与边界（交主会话）

**D-P0-003-1（来自 review-02 的边界，本轮本地复现，非当前安装触发）**：`leading` 座位在 `main` 面板就绪之后才被晚到声明（或独立重声明），且声明时该 single 座位已被其它条目占用 / 本插件注册失败时，插件保持视频主面板已注册而普通模式胶囊缺席 → 产生「不可达的视频面板」；界面没有可点击死按钮，但插件处于半挂载状态，只有再次成功重声明或重载插件才恢复。当前安装的活体状态是成功路径（两处都在），本轮 3+ 次启停/切换未触发该分支。

本地合约复现（基于仓库 `scripts/smoke-client.mjs` 的假 Slot 运行时，复制到 `/tmp/repro-late-leading.mjs`，不替换安装包；运行命令 `node /tmp/repro-late-leading.mjs`）：

```
REPRO1 mainLive=true capsuleLive=false errors=1   # 晚到声明 + 竞争占用
REPRO2 mainLive=true capsuleLive=false errors=1   # 独立重声明 + 竞争占用
```

建议后续修复方向（由主会话安排）：胶囊注册失败/缺席时同步撤回已注册的 main 条目；或在座位可用后重试并恢复，而不是只在首次建立链时检查。本会话未修改固定包。

## 7. 状态恢复与合规

- **插件**：保持「已安装、已启用」（按用户授权保留）；tarball 未被替换/重打包；未卸载宿主核心插件。
- **用户设置**：验证期间临时改过宿主字号（14→20）与主题（浅色→深色），结束时均已通过真实 Settings UI 恢复：字号 14（AX 胶囊尺寸回到 `89×31`）、浅色主题；窗口尺寸恢复 1470×862（位置未变）。
- **会话/草稿**：测试草稿已清空，输入框为空；测试只发生在输入框草稿与插件面板，未发送消息、未改会话内容；未改模型、权限、preset。
- **剪贴板**：测试前备份、结束后恢复。
- **仓库**：仅新增本记录、任务记录与 `docs/research/evidence/P0-003/` 去标识截图；未 push；固定包与功能代码未改。
- **应用**：未重启；插件安装与启用未再要求 restart。

## 8. 真实产物路径（本地，不入库）

- 完整窗口截图（可能含用户会话列表，不共享/不入库）：`/tmp/live-region.png`、`/tmp/stepC-3-normal.png`、`/tmp/stepC-4-video.png`、`/tmp/stepC-5-back-normal.png`、`/tmp/stepD-*.png`、`/tmp/stepE-*.png`、`/tmp/stepF-*.png`、`/tmp/stepG-*.png`、`/tmp/stepH-*.png`、`/tmp/stepI-*.png`、`/tmp/final-normal.png`。
- 动画录屏：`/tmp/anim-roundtrip.mov`（6s、60fps、2940×1724）；抽帧 `/tmp/animf/f*.png`；动效测量脚本为会话内联 Python（PIL 白底片中心检测）。
- AX/输入辅助工具（临时）：`/tmp/ax`、`/tmp/click`、`/tmp/keys`、`/tmp/scroll`、`/tmp/setsize`、`/tmp/dsh-activate.scpt`。
- 入库的去标识证据（已裁掉侧栏/会话列表，仅保留测试内容）：`docs/research/evidence/P0-003/01–08`。

## 9. 当前结论

固定包在真实 Host 上安装、启用与页面渲染成立；P0-003 的核心交互/视觉验收项（胶囊、切换、动效、停用回退、草稿保留、字号、深色、窄窗、键盘激活）已在真实页面通过；引用 chip、阅读位置、减少动态效果、冷启动首帧、no-drag 拖动、console 诊断等仍为未测/未确证（见 §4）。D-P0-003-1 边界缺陷仍交主会话决定修复与重新打包，本轮不改固定包。建议主会话基于本记录做 P0 验收并决定 D-1 的修复排期。
