# P0-003 受控安装与真实页面验证记录

日期：2026-10-17（Asia/Shanghai）。
执行：原 DSH 会话（P0 worktree，分支 `dsh/p0-mode-shell`，HEAD `e087455`）。
授权：用户在 DSH 会话明确授权安装/启用 `P0-002-review-02.md` 指定的固定 tarball 并执行真实页面验证。
结论：**固定包安装并启用成功，宿主侧与 Client 侧注册证据成立；停用/重新启用可清理并恢复。** 但本会话环境**没有页面控制或截图权限**，所以交互/视觉/草稿保留等项只能标记未测，提供用户最短步骤。另按 review-02 要求本地复现了「晚到 leading 注册失败留下不可达视频面板」边界缺陷（见 §7），交主会话安排修复；未替换固定包。

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

## 2. 激活证据（活体）

- `plugin_manager list_plugins`：`include:dsh-video`，`moduleName: dsh-video`，`enabled: true`，`fiberPhase: active`。
- `plugin_manager list_bundles`：bundle `dsh-video` `version: 0.1.0`，`installed: true`，`enabled: true`，行 `{rowId: "dsh-video", entryId: "include:dsh-video"}`。
- Host `Config.listConfigs`：存在 `include:dsh-video` 条目，`status: "absent"`（本插件未导出 Config schema，符合包内容，不是激活失败）。
- **Client live Slots（`cordis_inspect_query` Client `Slots.listSubTree`）**：
  - `main`（keyed/root）occupants 含 `{ key: "dsh-video", priority: 0, active: true }`（与 conversation/plugins/schedules/dsh-context 并列）。
  - `conversation.header.leading`（single/root）occupants 含 `{ priority: 0, active: true }`。
- **注册归属判定**：该 leading occupant 只在 bundle 启用时出现、停用时消失（见 §3 矩阵）；检索随应用 client bundle 未发现其他条目注册该座位（仅 `ui-conversation` 的声明/渲染与 contract 文档数据），因此它是本插件的普通模式胶囊。注意：它的 `registrant` 字段在活体页面上显示为 `mf`（另一次启用周期里 `main` 的 registrant 也曾显示 `dsh-video`、后续周期显示 `mf`），说明该诊断字段取决于注册时的宿主上下文而不是稳定包身份；本记录以**启用/停用相关性**而非 registrant 判定归属。
- 无 `restart-required` 或 warning；宿主主进程 PID 3630 启动于 12:31:26，安装发生于约 13:27，说明插件在**未重启应用**的情况下应用成功；当前会话未中断（本对话继续）。
- 未获得浏览器 console 输出（见 §5），因此不能排除渲染期警告；occupant 未被 abdicate、仍为 active winner，说明胶囊组件至少未在渲染时崩溃（若 Slot 组件抛错，renderer 会 report/abdicate）。

## 3. 停用 / 重新启用矩阵（活体）

经 `plugin_manager set_bundle` 切换（每次返回 `application: "applied"`、`warnings: []`，无 restart 要求）：

| 状态 | `main` 中 `dsh-video` | `conversation.header.leading` | 说明 |
|---|---|---|---|
| 安装前（P0-A 记录） | 无 | 空 | 基线 |
| 启用（安装后） | 有，active | 1 个 occupant，active | 两处注册均出现 |
| 停用 | 无 | 空 | 两处注册都被清理；会话/宿主其它条目不变 |
| 重新启用（第 2 次） | 有，active | 1 个 occupant，active | 恢复且无重复 |
| 再次停用→启用（第 3 次） | 有，active | 1 个 occupant，active | 重复切换稳定 |

结论：停用清理与重新启用在本机宿主上可复现地工作；**未能在视频模式内停用**（无法进入视频模式，见 §5），该子项未测。

## 4. 本会话无法执行的验证及原因

本会话是 DSH 内的 Agent 会话，不是浏览器控制会话：

- `osascript` 访问 `System Events` 报 `-1719: "osascript"不允许辅助访问` → 不能点击、键盘输入或读取 AX UI。
- `screencapture -x` 报 `could not create image from display`；`CGWindowListCreateImage` 在 macOS 15 已废弃，无法替代 → 不能截图/录屏。
- `http://127.0.0.1:19387/` 返回 `401 dsh web authentication required`，本 shell 拿不到 Desktop 的进程 token，无法在受控 Chrome 中复核页面。

因此以下项目**未测（不是通过）**，不使用 mock/React 模拟替代：

- 普通/视频胶囊的真实位置、尺寸、玻璃材质、选中态与 no-drag；
- 模式切换（普通→视频→普通）、快速反向、首次进入动效与 220ms 底片滑动真实播放；
- 明暗主题、字号放大、窄窗/高度不足时的真实排版；
- 键盘焦点落点、焦点可见性；
- 草稿中的多行中文、引用 chip、待发送图片/文件在切换后的保留；返回后的阅读位置；
- 视频模式中停用是否安全回普通；
- 浏览器 console 的 Slot crash / 诊断日志。

## 5. 用户最短验证步骤（建议在真实窗口完成）

1. 打开任意测试会话/空白会话，确认主内容区顶部左侧出现玻璃胶囊「普通｜视频」；检查它不遮挡窗口红绿灯/侧栏按钮，侧栏折叠/展开各看一次。
2. 点击「视频」→ 应进入空工作区（标题/说明/返回入口/简化界面效果）；再点「普通」→ 回到原会话，确认 Session、模型、权限、preset 未变。
3. 快速连续点「视频/普通」5 次：最后一次选择生效，不出现空白面板；观察底片滑动是否连续、无重播积压。系统「减少动态效果」开启时再看一次（应直接到位）。
4. 在输入框输入多行中文并插入一个文件引用 chip（`@` 选择文件）和一个待发送图片（粘贴/附件），**不发送**；切到视频再返回，检查文字、引用、附件都还在。再上滚阅读一段后切换，返回时阅读位置应合理恢复、不强制滚底。
5. 切到视频模式后，在 Plugins 页/管理方式里停用 `dsh-video`：应安全回到普通；重新启用后胶囊恢复，控制台无 `dsh-video:` 报错。
6. 切到深色主题、调大宿主字号、把窗口收窄：文本不溢出、焦点可见、玻璃可读；结束后恢复你的主题/字号/窗口。

发现异常时记录：操作步骤、时间、截图/录屏（只含测试内容）、浏览器控制台 `dsh-video:` 行。

## 6. 缺陷与边界（交主会话）

**D-P0-003-1（来自 review-02 的边界，本轮本地复现，非当前安装触发）**：`leading` 座位在 `main` 面板就绪之后才被晚到声明（或独立重声明），且声明时该 single 座位已被其它条目占用 / 本插件注册失败时，插件保持视频主面板已注册而普通模式胶囊缺席 → 产生「不可达的视频面板」；用户界面没有可点击死按钮，但插件处于半挂载状态，只有再次成功重声明或重载插件才恢复。当前安装的活体状态是成功路径（两处都在），未触发该分支。

本地合约复现（基于仓库 `scripts/smoke-client.mjs` 的假 Slot 运行时，复制到 `/tmp/repro-late-leading.mjs`，不替换安装包；运行命令 `node /tmp/repro-late-leading.mjs`）：

```
REPRO1 mainLive=true capsuleLive=false errors=1   # 晚到声明 + 竞争占用
REPRO2 mainLive=true capsuleLive=false errors=1   # 独立重声明 + 竞争占用
```

建议后续修复方向（由主会话安排）：胶囊注册失败/缺席时同步撤回已注册的 main 条目；或在座位可用后重试并恢复，而不是只在首次建立链时检查。本会话未修改固定包。

## 7. 安装后的宿主状态与恢复

- 插件当前状态：**已安装、已启用**（按用户授权保留）；未卸载；tarball 未被替换或重打包。
- 应用未重启；当前会话/模型/权限/preset 未被本验证修改；未在插件外写入任何工程/媒体/草稿内容。
- 用户设置影响：仅安装插件与 bundle 启停（Plugin Manager 写入 profile 的依赖与 bundle 列表）；未改主题/字号/窗口布局；未改 `cordis.patch.yml`。
- 未 push、未改仓库代码；本轮只提交本记录与任务记录。

## 8. 证据清单

- 安装：`plugin_manager install_bundle` 返回（application applied / warnings []），pnpm 日志路径见 §1。
- 激活：`plugin_manager list_plugins` / `list_bundles`；`cordis_inspect_query` Client `Slots.listSubTree` root=`main`、`conversation.header.leading`（启用/停用/重启用多次）。
- 完整性：tarball SHA-256；tarball 解包 vs 安装目录逐字节比较（9/9）。
- 限制：`osascript` 辅助访问错误、`screencapture` 失败、HTTP 401；无截图/录屏产物（不伪造）。
- 缺陷复现：`/tmp/repro-late-leading.mjs`（临时文件，不入库）与输出；仓库测试 `npm run check` 仍通过（20 static / 24 smoke）。
