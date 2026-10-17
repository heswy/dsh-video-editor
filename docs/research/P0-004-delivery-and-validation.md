# P0-004 生命周期修复、0.1.1 固定包与补验记录

日期：2026-10-17（Asia/Shanghai）。
执行：原 DSH 会话，原 worktree `dsh/p0-mode-shell`；base `12708cc`。
授权：用户要求修复 leading 晚到/重声明缺陷、加正式回归测试、打新的 `0.1.1` 固定包交回复审，并补引用/文件草稿、静态阅读位置与键盘等验证；**先不替换当前已安装包、不 push**。
结论：**D-P0-003-1 已按原子对生命周期修复并有正式合约回归（静态 20/20、smoke 30/30）；`0.1.1` 固定包已产出并校验，等待主会话代码/包复审；当前已安装的 `0.1.0` 未被替换。** 补验在专用空白静态会话中完成引用 chip、普通文件附件、往返保留、键盘 Tab/焦点/方向键/Space 与插件内简化效果；静态阅读位置因无法建立「有历史的静态会话」而阻塞；冷启动、系统 reduce-motion、console 仍未测。测试期间发生一次焦点误落飞书的事故，已记录并停止该类操作（见 §7）。

## 1. 缺陷与修复（D-P0-003-1）

原实现把视频面板注册在 leading 胶囊之前：当 leading 座位晚到、或独立重声明时被其它条目占用/注册失败，`main` 面板已经注册而胶囊缺席 → 不可达视频面板（本地合约复现已于 P0-003 记录：`mainLive=true capsuleLive=false`）。

修复采用**原子对**语义（`client.js` `registerMainAndEntry`）：

- `main` 声明回调只建立链，不直接注册面板。
- 链内对每个 `conversation.header.leading` 声明生命周期执行一次获取：
  1. 检查 leading 占用；冲突/枚举不可用 → 报诊断并放弃本次获取（两侧都不注册）；
  2. **先注册胶囊**；失败 → 报 `leading-register-failed` / `leading-entry-unavailable`，不注册面板；
  3. 重新检查 `main` key（防竞争）后**再注册视频面板**；失败 → 立即 dispose 已注册胶囊，不留半对；
  4. 成功则记录本对的 disposal 句柄；该 leading 声明折叠/销毁时**先撤面板、再撤胶囊**，并检查 `panelInfo.activePanelId`，若仍为 `dsh-video` 则兜底 `selectPanel(null)` 安全回普通模式。
- leading 后续声明会重试整对；`main` 声明折叠时关闭整条链（含 pending leading inject），重新声明后重建。
- 每对只释放一次（`disposed` 标志 + 句柄置空）：不递归 dispose、不重复注册；所有失败保留 `dsh-video:` 前缀诊断。

顺序上「先胶囊后面板」确保任何时刻都不会出现「有面板、无入口」的可达性缺口；短暂「有入口、后面板尚未注册」窗口内点击视频也不会留下死面板（导航失败被包含并清除提示）。

## 2. 正式回归测试

`scripts/smoke-client.mjs` 新增/强化 D-P0-003-1 合约测试（真实声明生命周期语义，未改桩规避真实等待）：

- 晚到 leading 且无占用：声明前零注册；声明时**成对**出现，且注册顺序为「胶囊先于面板」；导航可用。
- 晚到 leading 且有竞争占用：零注册（无面板）、报告 `leading-seat-conflict`；清除竞争并重新声明后成对恢复，且 main/leading 各恰一个。
- 已挂载的对因 leading 独立重声明失败：整对撤回；若此时视频为选中态，回退 `selectPanel(null)`；清除竞争后重新声明恢复，导航可用。
- 连续 3 轮 leading 折叠/重声明：每轮 0/2，无重复注册、无 `cleanup-failed`。
- `main` 折叠（视频选中态）释放整对并回普通模式，重新声明恢复。
- 未成对（晚到等待中）与被拒状态下卸载：零残留。
- 原有 R1/R2/持久化/卸载测试全部保留。

同时强化 `scripts/check.mjs` 的 R1 静态契约：断言胶囊注册调用先于面板注册、存在成对释放/回退路径与失败诊断。

本地结果（本轮实跑）：

```
node --check index.js && node --check client.js   → ok
node scripts/check.mjs                            → 20 passed, 0 failed
node scripts/smoke-client.mjs                     → 30 passed, 0 failed
npm pack --dry-run --offline                      → dsh-video-0.1.1.tgz, 9 files
```

## 3. 版本与固定包

| 项 | 值 |
|---|---|
| 修复提交 | `ab4bc68`（`fix: register video panel and normal entry as one lifecycle pair`） |
| 包版本 | `0.1.1`（`package.json`） |
| 包路径 | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/ab4bc68/dsh-video-0.1.1.tgz` |
| 大小 | 16,983 bytes |
| SHA-256 | `4cb0a4b947b94468be2b5bd065d03ba5198ce8e8331c9d6f7b29216d132f676f` |
| 文件数 | 9（LICENSE、README.md、client.js、cordis.patch.yml、icon.svg、index.js、locale/en.json、locale/zh.json、package.json） |
| 新 `client.js` SHA-256 | `ed5591d04414ba5a3634a56651550378fa297d936f88c7e0156899bb9aab0f44` |
| 与工作树一致性 | 解包 9/9 文件与 `ab4bc68` 工作树逐字节一致（本轮实测） |

已安装包保持原状：profile 依赖仍为 `…/a31ee51/dsh-video-0.1.0.tgz`；`~/.dsh/profiles/desktop/node_modules/dsh-video/client.js` SHA-256 仍为 `07f1ff2a…c2c46b`。**未替换、未重装、未重启应用。**

## 4. 补验范围与结果（安装在跑的是 0.1.0）

专用测试会话：用真实鼠标点击侧栏「新会话」创建空白会话（无历史、无后台 Agent 输出；AXPress 该按钮此前不生效，真实点击可用）。以下结果属于已安装 `0.1.0` 的 UI/宿主行为；`0.1.1` 只改了插件注册链，不改变这些交互。

| 项 | 方法 | 结果 |
|---|---|---|
| 专用静态测试会话 | 真实点击「新会话」；确认空白 hero、无 Agent 输出 | PASS（PASS 范围为「空白静态会话」；会话留在侧栏，未删除） |
| 多行中文草稿 | 粘贴 3 行中文（含标点/日期） | PASS |
| 真实引用 chip | 在**新行**输入 `@` 触发 mention 菜单（截图确认「文件与文件夹」列表后）→ Down×5 选 `README.md` → Enter | PASS（先确认菜单再按 Enter；未发送；在专用会话内操作） |
| 普通文件附件 | 「+」→「文件 file」→ 系统文件选择器选 `p0-004-file-test.md` | PASS；文件 chip 出现，点击 chip 可在右侧预览真实文件内容（附件语义仍可用） |
| 切换前后保留 | 普通 → 视频 → 普通（真实点击胶囊） | PASS：多行文字、引用 chip `README.md`、文件附件 chip 均保留；截图为证（`evidence/P0-004/02`） |
| 键盘 Tab/焦点 | 空白会话中点击空白处后连续 Tab | PASS：第 21 次 Tab 聚焦胶囊「普通」；焦点环可见（`evidence/P0-004/04`）；Tab 顺序可达侧栏/胶囊 |
| 键盘激活/方向键 | 聚焦胶囊后按 ArrowRight → 进入视频；Tab 后聚焦「普通」→ Space → 回普通 | PASS（真实键盘事件；模式切换与会话内容正常） |
| 插件内「简化界面效果」 | 视频页开关置 ON → 录制普通/视频往返 → 帧对比 → 置回 OFF | PASS（范围：插件开关；ON 时切换后的首帧底片已在目标段，无中间滑动帧，见 `evidence/P0-004/06`；系统 reduce-motion 未测） |
| no-drag 拖动与按钮可点击 | 拖动标题行空白区 (1100,60)+ (60,24) | PASS：窗口从 (0,33) 移到 (60,57)，随后用 AX 精确还原 (0,33)；胶囊按钮在拖动前后均可点击 |
| 静态阅读位置 | 需要「有历史、无新输出」的专用会话 | **阻塞**：空白专用会话无历史；未改用活跃任务会话来凑证据，也未通过发送模型请求制造历史；该项留待后续可用分支/静态历史会话时补测 |
| reduce-motion 系统偏好 | 需改 macOS「减少动态效果」 | 未测（未获准改系统设置） |
| 冷启动/首次加载与首帧 | 需刷新或重启 | 未测（未获准重启/刷新；本分析不会自行重启用户应用） |
| console / renderer 日志 | 无浏览器 console 通道 | 未测；可见页面在多次切换/启停后保持完整可交互，无可见白屏或组件缺失 |

## 5. 补验中的安全规则执行

- 引用 chip 只在**截图确认 mention 菜单已打开**后才按 Enter 选择；未在活跃任务会话用 Enter 试选。
- 测试草稿全程未发送、未触发真实模型请求；空白测试会话最后清空草稿。
- 测试文件 `p0-004-file-test.md` 放在 `/tmp` 与 `~/Downloads`（选择器可达），测试后已删除 `~/Downloads` 副本；`/tmp` 副本保留为本地证据。
- 测试设置恢复：窗口尺寸/位置 (0,33,1470×861)、简化效果开关 OFF、右侧预览面板已关闭、草稿清空、剪贴板从上轮备份恢复（见 §7 关于事故的说明）。

## 6. 证据

入库（已裁掉侧栏会话列表）：`docs/research/evidence/P0-004/`

- `01-mention-menu.png`：真实 mention 菜单（文件与文件夹列表）与草稿；
- `02-draft-reference-file-retained.png`：普通↔视频往返后，多行文字 + `README.md` 引用 chip + 文件附件 chip 仍在；
- `03-file-attachment-preview.png`：点击文件附件 chip 后右侧预览真实文件内容（附件语义可用）；
- `04-keyboard-focus-capsule.png`：Tab 聚焦「普通」的键盘焦点环（视频页）；
- `05-simplified-toggle-on.png`：「简化界面效果」ON；
- `06-simplified-frames.png`：简化效果 ON 时往返录屏的过渡帧拼图（切换后首帧已到目标段，无中间滑动位）。

本地未入库原始件：`/tmp/supp2-*.png`、`/tmp/supp3-*.png`、`/tmp/supp4-*.png`、`/tmp/supp5-*.png`、`/tmp/supp7-*.png`、`/tmp/simplified-roundtrip.mov`、`/tmp/simpf/`。

## 7. 事故与偏差记录（必须交代）

1. **焦点误落飞书（Feishu）**：补验开始时，一次「给 DSH 测试会话输入草稿并打开附件菜单」的命令中，`open -a 'DeepSeek Harness'` 后实际前台已切到飞书（用户正并行使用）。随后的点击 (870,496)、写入剪贴板的 3 行测试草稿 + Cmd+V、点击 (464,572) 可能落在飞书窗口/文档上。发现后立刻停止输入；随后命令都先校验前台进程并确认是 DSH 才继续，用户也确认「焦点还给你」。**无法确认**飞书文档是否被插入测试文字；未替用户撤销（避免误撤用户自己的编辑）。请在飞书文档中检查是否出现「P0-004 草稿补验…」文本，若有请自行 Cmd+Z 撤销。该事故不涉及 DSH 会话内容、模型请求或插件安装。
2. **剪贴板**：事故前未备份当时剪贴板；测试写入的测试草稿/文件 URL 覆盖后，已用本轮早先备份恢复（可能不是事故瞬间内容）。
3. **空白测试会话**：用真实点击创建，留在侧栏（未删除）；草稿已清空、未发送。
4. 曾尝试用 AXPress「新建会话」与 AXPress 关闭预览标签，均不生效或不可靠；改用真实鼠标点击/AX 定位坐标完成。真实页面操作因此仍以「屏幕坐标 + 焦点校验」为主。

## 8. 状态与交接

- 修复+测试+版本提交：`ab4bc68`；本记录与证据为随后本地文档提交（未 push）。
- 新固定包路径/摘要见 §3；**未安装**，当前运行仍是 `0.1.0`。
- 用户设置/窗口/草稿/预览面板已恢复；应用未重启。
- 交主会话：复审 `ab4bc68` 与 `dsh-video-0.1.1.tgz`；若通过并授权，再按 Plugin Manager 受支持路径替换安装并核对摘要；随后可补静态阅读位置、冷启动、系统 reduce-motion 与 console。
