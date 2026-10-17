# P0-003：固定包安装与真实页面验证

状态：准备完毕，等待用户在 DSH 会话明确授权安装/启用；本指南本身不是安装授权。
执行：原 DSH 会话，原 `dsh/p0-mode-shell` worktree。主会话复核证据并决定 P0 验收。

## 固定对象

只安装 `docs/reviews/P0-002-review-02.md` 中指定的 `a31ee51` tarball，先核对 SHA-256。不要安装移动中的工作目录；不接入/安装引擎 worktree，不改宿主文件、不手改 profile、不 push。

## 获授权后的步骤

1. 经 DSH Plugins 页面或该实例受支持的 plugin_manager 安装并启用此 tarball。检查 application/激活状态；不把包管理器成功等同于 UI 成功。
2. 检查真实 leading 胶囊、视频面板、正确选中与返回入口，保留失败原因及控制台 Slot crash。若出现 pending/restart-required，准确报告，不自行重启用户应用。
3. 按 P0-002 安装后清单逐项验证，先做模式切换及停用回退，再做主题、字号、窄窗和动效。
4. 仅在用户授权的专用测试会话和自有素材测试多行中文、引用、图片和文件草稿，不发送真实模型请求或借用私人会话。任何内容丢失停止相关测试，记录复现；不通过直接操作编辑器内部数据修补。
5. 验证回到普通的焦点落点、阅读位置；确认未更改模型、权限、preset 或当前 Session。切换期间已有后台任务不要主动中断。
6. 检查 main/leading 声明晚到及独立重挂失败的合约边界，能本地证明的用最小合约补验；不得卸载宿主核心 UI 插件来制造故障。
7. 真实截图/短录屏只含测试内容；用户主题/字号/窗口布局因测试变更后恢复。安装包按用户授权保留，若失败按支持的方式停用/移除新插件，不能破坏原状态。

## 记录与返回

写 `docs/research/P0-003-live-validation.md`，包含包摘要、Host 版本、安装实际结果、逐项通过/失败/未测、控制台诊断、真实图片/录屏的本地路径和缺陷复现。只做本地文档提交，交回主会话。

无浏览器控制时明确标记相应项未测，提供用户可执行的最短步骤；不模拟 React/DOM 或截图代替真实页面。发现代码问题后先交回具体复现，由主会话安排后续修复与重新打包；不静默替换当前固定包。

## 开发记录

- 用户授权与安装结果：用户在 DSH 会话明确授权通过受支持的插件管理方式安装/启用 review-02 指定的固定 tarball，并执行真实页面验证。已用 `plugin_manager install_bundle` 安装：`stage: "enable"`，`changed: true`，`application: "applied"`，`warnings: []`，无需重启；`list_plugins` 行 `include:dsh-video` `enabled: true` `fiberPhase: active`。Plugin Manager 写入 profile 依赖与 bundle 列表，未手改 profile。当前插件保持「已安装、已启用」。
- Host / tarball hash：Host Desktop `0.2.0-rc.2`（PID 3630 启动于 12:31:26，安装约 13:27，未重启）。tarball `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/a31ee51/dsh-video-0.1.0.tgz`，安装前 SHA-256 实算 `c0257548cad4f6f737d90eee3eb7b73ac823a946732d37710ff58cbb4490bbc4` 与 review-02 一致；tarball 解包 9 文件与 profile 安装目录逐字节一致。
- 实测矩阵与真实产物：详见 `docs/research/P0-003-live-validation.md`。活体证据：Client Slots `main` occupant `dsh-video` active；`conversation.header.leading` occupant 仅在启用时出现（停用后为空），注册归属以启用/停用相关性判定；停用→重启用 3 轮均 `application: applied`、无重复、无 restart。**没有真实页面截图/录屏**：本会话无辅助访问（-1719）、无屏幕录制（screencapture 失败）、Web 端点 401 无 token，不能点击/输入/截图；交互、玻璃动效、字号、草稿/引用/附件保留、焦点与 vid 模式内停用均标记未测，已在记录中给出用户最短验证步骤。
- 失败 / 未测 / 恢复状态：未触发安装失败；当前插件已安装并启用，未卸载、固定包未替换。按 review-02 要求的边界已本地复现：`leading` 晚到声明或独立重声明时被其它条目占用，会留下「main 已注册、胶囊缺席」的不可达视频面板（`/tmp/repro-late-leading.mjs`：`REPRO1/REPRO2 mainLive=true capsuleLive=false`），交主会话安排修复，本轮未改固定包/未改功能代码。未改主题/字号/窗口布局；未 push；未改仓库代码（本轮仅本地文档提交）。

## 验收记录（主会话）

待真实证据；当前未安装，P0 未验收。
